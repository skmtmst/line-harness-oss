import { logger } from '@line-crm/shared/server';
import { inputError } from '../lib/input-errors.js';

import { getRichMenuGroupWithPages, getLineAccountById, getActiveRichMenuTestApply, getRichMenuTestApplyById, beginRichMenuTestApplyRevert, markRichMenuTestApplyReverted, markRichMenuTestApplyRevertFailed, recordAuditEvent, maskAuditIp, auditDeviceFamily } from '@line-crm/db';
import type { Env } from '../worker-env.js';

import { canAccessAllLineAccounts } from '../services/account-access.js';
import { deleteRichMenuShells } from '../lib/rich-menu-publisher.js';
import { serializeTestApply, createLineClient } from './rich-menu-groups-definition.js';
import type { Context } from 'hono';

export const post__api_rich_menu_groups_groupId_test_apply_revert_1 = async (c: Context<Env, "/api/rich-menu-groups/:groupId/test-apply/revert">) => {
    const groupId = c.req.param('groupId');
    // pages まで読む。公開済みメニューの「適用に使ったID」を確定し、
    // 本人の今の表示がテスト適用で出したものかを照合するために使う。
    const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!idempotencyKey) {
      return inputError(c, { success: false, error: 'Idempotency-Key header required' }, 400, []);
    }
    let body: { confirm?: unknown; applyId?: unknown } = {};
    try {
      body = await c.req.json<{ confirm?: unknown; applyId?: unknown }>();
    } catch {
      return inputError(c, { success: false, error: 'invalid JSON body' }, 400, []);
    }
    if (body.confirm !== true) {
      return inputError(c, { success: false, error: '取り消しには確認（confirm: true）が必要です' }, 400, ["confirm"]);
    }

    const staff = c.get('staff');
    const apply = typeof body.applyId === 'string' && body.applyId
      ? await getRichMenuTestApplyById(c.env.DB, body.applyId)
      : await getActiveRichMenuTestApply(c.env.DB, group.id, staff.id);
    if (!apply || apply.group_id !== group.id || apply.staff_id !== staff.id) {
      return c.json({ success: false, error: '取り消せるテスト適用がありません' }, 404);
    }

    const claim = await beginRichMenuTestApplyRevert(c.env.DB, apply.id, idempotencyKey);
    if (claim === 'already') {
      const done = await getRichMenuTestApplyById(c.env.DB, apply.id);
      return c.json(
        { success: true, data: serializeTestApply(done ?? apply) },
        200,
        { 'Idempotency-Replayed': 'true' },
      );
    }
    if (claim === 'conflict' || claim === 'missing') {
      return c.json({ success: false, error: '取り消し処理が別の操作と重なりました。最新の状態を確認してください。' }, 409);
    }

    const account = await getLineAccountById(c.env.DB, group.account_id);
    if (!account) return c.json({ success: false, error: 'line account not found' }, 500);
    const line = createLineClient(account.channel_access_token);
    if (!line.linkRichMenuToUser || !line.unlinkRichMenuFromUser) {
      return c.json({ success: false, error: 'LINE client does not support per-user rich menu operations' }, 500);
    }

    // テスト適用が本人へ出した可能性のあるメニューの集合。revert で上書き
    // してよいのは、本人の表示が今もこの集合の中にあるときだけ。適用後に
    // 本人や別経路で表示が変わっていたら、それを無言で戻さない。
    let testShellIds: string[] = [];
    try {
      testShellIds = JSON.parse(apply.test_shell_ids ?? '[]') as string[];
    } catch {
      testShellIds = [];
    }
    const ourMenuIds = new Set<string>(testShellIds);
    if (apply.applied_richmenu_id) ourMenuIds.add(apply.applied_richmenu_id);
    if (group.status === 'published') {
      const targetPage =
        group.pages.find((p) => p.id === group.default_page_id)
        ?? [...group.pages].sort((a, b) => a.order_index - b.order_index)[0];
      // published の適用は LINE 側の既存メニューをリンクしただけ。適用後・
      // markApplied 前に止まった failed 行でもこのIDで拾える。
      if (targetPage?.line_richmenu_id) ourMenuIds.add(targetPage.line_richmenu_id);
    }

    try {
      /*
       * 1) 本人の表示の扱いを決める。
       *    restored:         まだテストメニューが出ている → 適用前へ戻した
       *    already_restored: すでに適用前の表示に戻っている → 何もしない
       *    left_as_is:       適用後に別の表示へ変わっていた → 上書きしない
       *    untouched:        適用前の記録が無い（一度も変えていない）→ 触らない
       */
      let userMenuAction: 'restored' | 'already_restored' | 'left_as_is' | 'untouched';
      if (apply.previous_captured === 1) {
        if (!line.getRichMenuIdOfUser) {
          throw new Error('LINE client does not support reading per-user rich menu');
        }
        const current = await line.getRichMenuIdOfUser(apply.line_user_id);
        if (current !== null && ourMenuIds.has(current)) {
          // いまもテストで出したメニューが出ているので適用前へ戻す。
          if (apply.previous_richmenu_id) {
            await line.linkRichMenuToUser(apply.line_user_id, apply.previous_richmenu_id);
          } else {
            await line.unlinkRichMenuFromUser(apply.line_user_id);
          }
          userMenuAction = 'restored';
        } else if (current === apply.previous_richmenu_id) {
          // すでに適用前の表示（適用前が「個別メニューなし」なら null 同士）。
          userMenuAction = 'already_restored';
        } else {
          // 適用後に表示が変わっていた。正当な変更を無言で上書きしない。
          userMenuAction = 'left_as_is';
        }
      } else {
        // previous_captured=0 は適用前の表示を記録する前に止まった apply。
        // 本人のメニューは一度も変えていないので絶対に触らない。
        userMenuAction = 'untouched';
      }

      // 2) 下書きテストで作ったメニューと、それを指している alias を掃除する。
      if (testShellIds.length > 0 && line.listRichMenuAliases) {
        const shellSet = new Set(testShellIds);
        try {
          const aliases = await line.listRichMenuAliases();
          for (const alias of aliases) {
            // 公開済みへ張り替わった alias（別のIDを指す）は消さない。
            if (shellSet.has(alias.richMenuId) && alias.richMenuAliasId.startsWith(`lhx-${group.id.slice(0, 8)}-`)) {
              await line.deleteRichMenuAlias(alias.richMenuAliasId);
            }
          }
        } catch (aliasError) {
          logger.warn("routes_rich_menu_groups_warn");
        }
      }
      await deleteRichMenuShells(line, testShellIds);

      await markRichMenuTestApplyReverted(c.env.DB, apply.id);

      const staffForAudit = c.get('staff');
      c.set('auditRecorded', true);
      try {
        await recordAuditEvent(c.env.DB, {
          tenantId: staffForAudit?.tenantId,
          lineAccountId: group.account_id,
          category: 'business',
          actorPrincipalId: staffForAudit?.id,
          actorRole: staffForAudit?.role,
          action: 'rich_menu.test_apply_revert',
          targetKind: 'rich_menu_group',
          targetId: group.id,
          result: 'success',
          after: {
            applyId: apply.id,
            userMenuAction,
            restoredRichMenuId: userMenuAction === 'restored' ? apply.previous_richmenu_id : null,
          },
          requestTraceId: c.req.header('cf-ray') ?? c.req.header('x-request-id') ?? null,
          ipPrefix: maskAuditIp(c.req.header('cf-connecting-ip')),
          deviceFamily: auditDeviceFamily(c.req.header('user-agent')),
        });
      } catch (auditError) {
        logger.error("rich_menu_groups.rich_menu_groups_group_id_test_apply_revert_post_failed");
      }

      const updated = await getRichMenuTestApplyById(c.env.DB, apply.id);
      return c.json({
        success: true,
        data: { ...serializeTestApply(updated ?? apply), userMenuAction },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await markRichMenuTestApplyRevertFailed(c.env.DB, apply.id, message);
      return c.json({ success: false, error: message, data: { applyId: apply.id } }, 500);
    }
  };
