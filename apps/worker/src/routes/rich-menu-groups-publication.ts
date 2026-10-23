import { logger } from '@line-crm/shared/server';
import { inputError, readBoundedBytes } from '../lib/input-errors.js';

import { getRichMenuGroupById, getRichMenuGroupWithPages, setRichMenuPageImage, pageBelongsToGroup, acquirePublishLease, releasePublishLease, renewPublishLease, markRichMenuGroupUnpublished, getLineAccountById, clearRichMenuAssignmentsForGroup, getRichMenuManualPublishRequestById, getRichMenuManualPublishShells, listRichMenuManualPublishRequests, getLatestRichMenuVersion, recordRichMenuDeviceConfirmation, findRichMenuDeviceConfirmation, ensureRichMenuPublishRun, markRichMenuPublishRun, getLatestRichMenuPublishRun, listRichMenuPublishRunPages, recordAuditEvent, maskAuditIp, auditDeviceFamily, jstNow } from '@line-crm/db';
import { RICH_MENU_MAX_PAGES } from '@line-crm/shared';
import type { Env } from '../worker-env.js';

import { canAccessAllLineAccounts } from '../services/account-access.js';
import { validateRichMenuImage } from '../lib/image-validator.js';
import { computeRichMenuDiffs, applyRichMenuDiffs } from '../lib/rich-menu-reconcile.js';
import { resolveSwitcherActions, validateRichMenuGroupForPublish, validateRichMenuPagesWithLine, unpublishRichMenuGroup, PublishLeaseLostError, type GroupInput } from '../lib/rich-menu-publisher.js';
import { handleManualPublish, manualPublishFingerprint, buildPublishGroupInput, createLineClient, PUBLISH_PROGRESS_STEPS, publishRunMessage, fingerprintFromSnapshot } from './rich-menu-groups-definition.js';
import type { Context } from 'hono';

export const post__api_rich_menu_groups_groupId_pages_pageId_image_1 = async (c: Context<Env, "/api/rich-menu-groups/:groupId/pages/:pageId/image">) => {
  const { groupId, pageId } = c.req.param();
  const group = await getRichMenuGroupById(c.env.DB, groupId);
  if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
    return c.json({ success: false, error: 'group not found' }, 404);
  }
  // #827 (N-158): ページ画像も公開中の定義の一部。LINE上の表示とずれるだけなので、
  // 本文を読む前・R2へ書く前に断る。
  if (group.status === 'published') {
    return c.json(
      {
        success: false,
        error: '公開中のメニューは直接変更できません。LINEから取り下げて下書きに戻してから編集してください',
      },
      409,
    );
  }
  const contentType = c.req.header('content-type') ?? '';
  if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
    return inputError(c, { success: false, error: 'content-type must be image/png or image/jpeg' }, 400, []);
  }

  const exists = await pageBelongsToGroup(c.env.DB, groupId, pageId);
  if (!exists) return c.json({ success: false, error: 'page not found in group' }, 404);

  // 巨大ファイルは全量読む前に断る（上限1MBは image-validator と同じ）。
  const declaredBytes = Number.parseInt(c.req.header('content-length') ?? '', 10);
  if (Number.isFinite(declaredBytes) && declaredBytes > 1024 * 1024) {
    return c.json({ success: false, error: '画像が大きすぎます。1MB以下の画像を選んでください' }, 413);
  }

  const buf = await readBoundedBytes(c.req.raw, 1024 * 1024);
  if (buf === null) return c.json({ success: false, error: '画像が大きすぎます。1MB以下の画像を選んでください' }, 413);
  const validation = validateRichMenuImage(buf, buf.byteLength);
  if (!validation.ok) return inputError(c, { success: false, error: validation.error }, 400, ["pages"]);

  // group.size と画像サイズが一致してないと publish 時に LINE API でコンテンツアップロードが
  // 弾かれる (richmenu の宣言サイズと content の dimensions は一致必須)。事前に拒否する。
  if (validation.size !== group.size) {
    return inputError(c, {
        success: false,
        error: `image size '${validation.size}' does not match group size '${group.size}'`,
      }, 400, ["imageR2Key"]);
  }

  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  const key = `rich-menus/${group.account_id}/${groupId}/${pageId}/${Date.now()}.${ext}`;
  await c.env.IMAGES.put(key, buf, { httpMetadata: { contentType } });
  try {
    await setRichMenuPageImage(c.env.DB, pageId, key, contentType);
  } catch (error) {
    // M954: DB への記録に失敗したら、上げた画像を片付ける。
    // 置きっぱなしにすると再試行のたびに孤児が溜まる。
    try {
      await c.env.IMAGES.delete(key);
    } catch {
      // 片付けの失敗は元の失敗に付けない。ログだけ残す。
      logger.error("rich_menu_groups.rich_menu_groups_group_id_pages_page_id_image_post_failed");
    }
    throw error;
  }

  return c.json({
    success: true,
    data: { imageR2Key: key, imageContentType: contentType, size: validation.size },
  });
};

export const get__api_rich_menu_images_key__2 = async (c: Context<Env, "/api/rich-menu-images/:key{.+}">) => {
  const key = c.req.param('key');
  const [root, accountId] = key.split('/');
  if (
    root !== 'rich-menus'
    || !accountId
    || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])
  ) {
    return c.notFound();
  }
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=60',
    },
  });
};

export const post__api_rich_menu_groups_groupId_publish_3 = async (c: Context<Env, "/api/rich-menu-groups/:groupId/publish">) => {
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
  if (!idempotencyKey) {
    return inputError(c, { success: false, error: 'Idempotency-Key header required' }, 400, []);
  }
  return handleManualPublish(c, c.req.param('groupId'), idempotencyKey);
};

export const get__api_rich_menu_groups_groupId_prepublish_check_4 = async (c: Context<Env, "/api/rich-menu-groups/:groupId/prepublish-check">) => {
    const groupId = c.req.param('groupId');
    const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const fingerprint = manualPublishFingerprint(group);
    let selfCheck: { ok: boolean; message: string };
    try {
      validateRichMenuGroupForPublish({
        id: group.id,
        size: group.size,
        chatBarText: group.chat_bar_text,
        isDefaultForAll: group.is_default_for_all === 1,
        pages: resolveSwitcherActions(group.pages.map((p) => ({
          id: p.id, orderIndex: p.order_index, name: p.name,
          imageR2Key: p.image_r2_key, imageContentType: p.image_content_type, lineRichMenuId: p.line_richmenu_id,
          areas: p.areas.map((a) => ({
            id: a.id,
            bounds: { x: a.bounds_x, y: a.bounds_y, width: a.bounds_width, height: a.bounds_height },
            actionType: a.action_type, actionData: a.actionData, intent: a.intent, label: a.label,
            tagIds: a.tagIds, scoreChange: a.score_change, templateId: a.template_id, formId: a.form_id,
            trackedLinkUrl: null,
          })),
        })), group.id),
      });
      selfCheck = { ok: true, message: '自前の検査を通りました。' };
    } catch (e) {
      selfCheck = { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    const device = await findRichMenuDeviceConfirmation(c.env.DB, groupId, fingerprint);
    const version = await getLatestRichMenuVersion(c.env.DB, groupId);
    return c.json({
      success: true,
      data: {
        fingerprint,
        pageCount: group.pages.length,
        maxPages: RICH_MENU_MAX_PAGES,
        selfCheck,
        deviceConfirmed: device !== null,
        deviceConfirmedAt: device?.confirmed_at ?? null,
        versionNumber: version?.version_number ?? null,
      },
    });
  };

export const post__api_rich_menu_groups_groupId_validate_5 = async (c: Context<Env, "/api/rich-menu-groups/:groupId/validate">) => {
    const groupId = c.req.param('groupId');
    const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const account = await getLineAccountById(c.env.DB, group.account_id);
    if (!account) return c.json({ success: false, error: 'line account not found' }, 500);
    const groupInput = await buildPublishGroupInput(c, group, account);
    const checks: Array<{ key: 'self' | 'line'; ok: boolean; message: string }> = [];
    try {
      validateRichMenuGroupForPublish({
        ...groupInput,
        pages: resolveSwitcherActions(groupInput.pages, groupInput.id),
      });
      checks.push({ key: 'self', ok: true, message: '自前の検査を通りました。' });
    } catch (e) {
      checks.push({ key: 'self', ok: false, message: e instanceof Error ? e.message : String(e) });
      return c.json({ success: true, data: { checks } });
    }
    const line = createLineClient(account.channel_access_token);
    try {
      await validateRichMenuPagesWithLine(groupInput, line);
      checks.push({ key: 'line', ok: true, message: 'LINEの検査を通りました。' });
    } catch (e) {
      checks.push({ key: 'line', ok: false, message: e instanceof Error ? e.message : String(e) });
    }
    return c.json({ success: true, data: { checks } });
  };

export const post__api_rich_menu_groups_groupId_device_confirm_6 = async (c: Context<Env, "/api/rich-menu-groups/:groupId/device-confirm">) => {
    const groupId = c.req.param('groupId');
    const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const fingerprint = manualPublishFingerprint(group);
    const version = await getLatestRichMenuVersion(c.env.DB, groupId);
    const row = await recordRichMenuDeviceConfirmation(c.env.DB, {
      id: crypto.randomUUID(),
      groupId,
      fingerprint,
      versionId: version && version.definition_fingerprint === fingerprint ? version.id : null,
      staffId: c.get('staff').id,
    });
    return c.json({
      success: true,
      data: { confirmedAt: row.confirmed_at, fingerprint },
    });
  };

export const get__api_rich_menu_groups_groupId_publish_progress_7 = async (c: Context<Env, "/api/rich-menu-groups/:groupId/publish-progress">) => {
    const groupId = c.req.param('groupId');
    const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const run = await getLatestRichMenuPublishRun(c.env.DB, groupId);
    if (!run) {
      return c.json({
        success: true,
        data: {
          run: null,
          steps: PUBLISH_PROGRESS_STEPS.map((step) => ({ ...step, status: 'pending' as const })),
          message: 'まだ公開していません。',
        },
      });
    }
    const pages = await listRichMenuPublishRunPages(c.env.DB, run.id);
    const columns = ['image_status', 'create_status', 'alias_status', 'cleanup_status'] as const;
    const steps = PUBLISH_PROGRESS_STEPS.map((step, index) => {
      const column = columns[index];
      const statuses = pages.map((page) => page[column]);
      let status: 'done' | 'failed' | 'running' | 'pending' | 'skipped';
      if (statuses.length > 0 && statuses.every((s) => s === 'succeeded' || (column === 'cleanup_status' && s === 'skipped'))) {
        status = statuses.every((s) => s === 'succeeded') ? 'done' : 'skipped';
      } else if (statuses.some((s) => s === 'failed')) {
        status = 'failed';
      } else if (run.status === 'running') {
        status = statuses.some((s) => s === 'succeeded') ? 'done' : 'running';
      } else if (statuses.some((s) => s === 'succeeded')) {
        status = 'done';
      } else {
        status = 'pending';
      }
      return { ...step, status };
    });
    const message = run.status === 'failed'
      ? publishRunMessage(run.last_error_code)
      : run.status === 'running'
        ? '公開しています。そのままお待ちください。'
        : null;
    return c.json({
      success: true,
      data: {
        run: {
          id: run.id,
          mode: run.mode,
          status: run.status,
          startedAt: run.started_at,
          completedAt: run.completed_at,
        },
        steps,
        message,
      },
    });
  };

export const get__api_rich_menu_groups_groupId_publish_runs_8 = async (c: Context<Env, "/api/rich-menu-groups/:groupId/publish-runs">) => {
    const group = await getRichMenuGroupWithPages(c.env.DB, c.req.param('groupId'));
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const requests = await listRichMenuManualPublishRequests(c.env.DB, group.id, 50);
    const runs = [];
    for (const request of requests) {
      const shells = await getRichMenuManualPublishShells(c.env.DB, request.id);
      // 版の要約。スナップショットが読めなくても一覧自体は返す。
      let version: {
        name: string | null;
        chatBarText: string | null;
        pageCount: number | null;
        // その版が「誰に出る版」だったか。対象者に見える版を説明するために返す。
        isDefaultForAll: boolean | null;
        targetingEnabled: boolean | null;
      } = {
        name: null, chatBarText: null, pageCount: null,
        isDefaultForAll: null, targetingEnabled: null,
      };
      try {
        const snapshot = JSON.parse(request.definition_snapshot) as {
          name?: string; chatBarText?: string; pages?: unknown[];
          isDefaultForAll?: unknown; targetingEnabled?: unknown;
        };
        version = {
          name: typeof snapshot.name === 'string' ? snapshot.name : null,
          chatBarText: typeof snapshot.chatBarText === 'string' ? snapshot.chatBarText : null,
          pageCount: Array.isArray(snapshot.pages) ? snapshot.pages.length : null,
          isDefaultForAll: typeof snapshot.isDefaultForAll === 'boolean' ? snapshot.isDefaultForAll : null,
          targetingEnabled: typeof snapshot.targetingEnabled === 'boolean' ? snapshot.targetingEnabled : null,
        };
      } catch {
        // 壊れたスナップショットは要約なしで返す。
      }
      runs.push({
        id: request.id,
        versionNumber: request.version_number ?? null,
        status: request.status,
        lastErrorCode: request.last_error_code,
        idempotencyKey: request.idempotency_key,
        requestedByStaffId: request.requested_by_staff_id,
        createdAt: request.created_at,
        updatedAt: request.updated_at,
        version,
        pages: shells.map((shell) => ({
          pageId: shell.page_id,
          orderIndex: shell.order_index,
          newRichMenuId: shell.new_richmenu_id,
          oldRichMenuId: shell.old_richmenu_id,
        })),
      });
    }

    // いま対象へ出ている版 = 直近で成功したrun（created_at 降順の先頭から拾う）。
    const latestSucceeded = requests.find((request) => request.status === 'succeeded') ?? null;
    const published = latestSucceeded
      ? (runs.find((run) => run.id === latestSucceeded.id) ?? null)
      : null;

    // 編集中の下書きが公開版と違うか。スナップショットが読めないときは null
    // （不明）として、画面は「違う」と断定しない。
    let draftDiffersFromPublished: boolean | null = null;
    if (latestSucceeded) {
      try {
        const snapshot = JSON.parse(latestSucceeded.definition_snapshot) as unknown;
        const snapshotFingerprint = fingerprintFromSnapshot(snapshot);
        draftDiffersFromPublished =
          snapshotFingerprint === null
            ? null
            : snapshotFingerprint !== manualPublishFingerprint(group);
      } catch {
        draftDiffersFromPublished = null;
      }
    }

    return c.json({ success: true, data: { runs, published, draftDiffersFromPublished } });
  };

export const post__api_rich_menu_groups_groupId_publish_runs_requestId_retry_9 = async (c: Context<Env, "/api/rich-menu-groups/:groupId/publish-runs/:requestId/retry">) => {
    const groupId = c.req.param('groupId');
    const requestId = c.req.param('requestId');
    const group = await getRichMenuGroupById(c.env.DB, groupId);
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    const request = await getRichMenuManualPublishRequestById(c.env.DB, requestId);
    if (!request || request.group_id !== groupId || request.account_id !== group.account_id) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    if (request.status === 'running') {
      return c.json({ success: false, error: 'この公開はまだ実行中です', status: 'running' }, 409);
    }
    if (request.status === 'succeeded') {
      try {
        return c.json(
          { success: true, data: JSON.parse(request.result_json ?? '') },
          200,
          { 'Idempotency-Replayed': 'true' },
        );
      } catch {
        return c.json({ success: false, error: '公開結果を再取得できません。最新状態を確認してください。' }, 500);
      }
    }
    return handleManualPublish(c, groupId, request.idempotency_key);
  };

export const post__api_rich_menu_groups_groupId_reconcile_10 = async (c: Context<Env, "/api/rich-menu-groups/:groupId/reconcile">) => {
    const groupId = c.req.param('groupId');
    const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
    if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    let body: { dryRun?: unknown } = {};
    try {
      body = await c.req.json<{ dryRun?: unknown }>();
    } catch {
      // 本文なし = dryRun。
    }
    const dryRun = body.dryRun !== false;

    const account = await getLineAccountById(c.env.DB, group.account_id);
    if (!account) return c.json({ success: false, error: 'line account not found' }, 500);
    const line = createLineClient(account.channel_access_token);

    // K-2: ずれの列挙は lib へ。dryRun（見るだけ）と修復で同じ目線にする。
    // LINE が読めないときは 502（下書きは悪くない）。
    let computed;
    try {
      computed = await computeRichMenuDiffs(c.env.DB, line, group);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: `LINEの状態を確認できませんでした: ${message}` }, 502);
    }
    const { diffs } = computed;

    if (dryRun) {
      return c.json({ success: true, data: { dryRun: true, diffs } });
    }

    // --- 修復（自動で直せるずれだけ）。取り込み候補は運用者が画面で直す。 ---
    const { applied, failed, unapplied } = await applyRichMenuDiffs(
      c.env.DB,
      line,
      groupId,
      computed,
      jstNow(),
    );

    // K: 直したことも台帳に残す。ずれを直すと記録が残る。
    const staff = c.get('staff');
    const reconcileRun = await ensureRichMenuPublishRun(c.env.DB, {
      id: crypto.randomUUID(),
      groupId,
      versionId: null,
      idempotencyKey: `reconcile-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      mode: 'reconcile',
      staffId: staff?.id ?? null,
      now: jstNow(),
    });
    await markRichMenuPublishRun(c.env.DB, reconcileRun.id, {
      status: failed.length > 0 ? 'failed' : 'succeeded',
      diffsJson: JSON.stringify(diffs.map((d) => d.kind)),
    });

    c.set('auditRecorded', true);
    try {
      await recordAuditEvent(c.env.DB, {
        tenantId: staff?.tenantId,
        lineAccountId: group.account_id,
        category: 'business',
        actorPrincipalId: staff?.id,
        actorRole: staff?.role,
        action: 'rich_menu.reconcile',
        targetKind: 'rich_menu_group',
        targetId: groupId,
        result: failed.length > 0 ? 'failed' : 'success',
        after: {
          diffCount: diffs.length,
          applied: applied.map((d) => d.kind),
          failed: failed.map((f) => f.diff.kind),
        },
        requestTraceId: c.req.header('cf-ray') ?? c.req.header('x-request-id') ?? null,
        ipPrefix: maskAuditIp(c.req.header('cf-connecting-ip')),
        deviceFamily: auditDeviceFamily(c.req.header('user-agent')),
      });
    } catch (auditError) {
      logger.error("rich_menu_groups.rich_menu_groups_group_id_reconcile_post_failed");
    }

    return c.json({
      success: failed.length === 0,
      data: { dryRun: false, diffs, applied: applied.length, failed, unapplied, runId: reconcileRun.id },
    });
  };

export const post__api_rich_menu_groups_groupId_unpublish_11 = async (c: Context<Env, "/api/rich-menu-groups/:groupId/unpublish">) => {
  const groupId = c.req.param('groupId');
  const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
  if (!group || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [group.account_id])) {
    return c.json({ success: false, error: 'not found' }, 404);
  }

  const account = await getLineAccountById(c.env.DB, group.account_id);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 500);

  // 停止も group の状態を変える経路なので、公開と同じ lease 契約で行う。
  // lease なしで畳むと、同じ group を公開中の実行の owner と期限を消してしまう。
  const unpublishOwner = `unpublish-${crypto.randomUUID()}`;
  const unpublishGeneration = await acquirePublishLease(
    c.env.DB, groupId, unpublishOwner, new Date().toISOString(),
  );
  if (unpublishGeneration === null) {
    return c.json({ success: false, error: 'already publishing' }, 409);
  }
  const unpublishFence = { owner: unpublishOwner, generation: unpublishGeneration };

  // K: 取り下げも台帳に残す。
  const unpublishRun = await ensureRichMenuPublishRun(c.env.DB, {
    id: crypto.randomUUID(),
    groupId,
    versionId: null,
    idempotencyKey: `unpublish-${unpublishOwner}`,
    mode: 'unpublish',
    staffId: c.get('staff')?.id ?? null,
    now: jstNow(),
  });

  const line = createLineClient(account.channel_access_token);
  const groupInput: GroupInput = {
    id: group.id,
    size: group.size,
    chatBarText: group.chat_bar_text,
    isDefaultForAll: group.is_default_for_all === 1,
    pages: group.pages.map((p) => ({
      id: p.id,
      orderIndex: p.order_index,
      name: p.name,
      imageR2Key: p.image_r2_key,
      imageContentType: p.image_content_type,
      lineRichMenuId: p.line_richmenu_id,
      areas: [],
    })),
  };
  try {
    // ページ数ぶんの削除で時間がかかる。外部呼び出しの直前ごとに実時刻で延ばす。
    const heartbeat = async () => {
      const alive = await renewPublishLease(
        c.env.DB, groupId, unpublishFence, new Date().toISOString(),
      );
      if (!alive) throw new PublishLeaseLostError();
    };
    const result = await unpublishRichMenuGroup(groupInput, line, heartbeat);
    // false は失権。書けていないのに成功と返さない。
    if (!(await markRichMenuGroupUnpublished(c.env.DB, groupId, unpublishFence))) {
      throw new PublishLeaseLostError();
    }
    await clearRichMenuAssignmentsForGroup(c.env.DB, groupId);
    await markRichMenuPublishRun(c.env.DB, unpublishRun.id, { status: 'succeeded' });
    // 確定と解放は別。ここまで来て初めて lease を手放す。
    await releasePublishLease(c.env.DB, groupId, unpublishFence);
    return c.json({ success: true, data: result });
  } catch (e) {
    await markRichMenuPublishRun(c.env.DB, unpublishRun.id, {
      status: 'failed',
      errorCode: e instanceof PublishLeaseLostError ? 'lease_lost' : 'unpublish_failed',
    });
    await releasePublishLease(c.env.DB, groupId, unpublishFence);
    if (e instanceof PublishLeaseLostError) {
      return c.json(
        { success: false, error: '公開の担当が別の処理へ移りました。最新の状態を確認して、もう一度お試しください。' },
        409,
      );
    }
    const message = e instanceof Error ? e.message : String(e);
    throw e;
  }
};
