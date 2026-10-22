import { jstDate as japanDate } from '@line-crm/shared';
import { createMileageRuleIdempotent, serializeMileageRule } from './mileage-rule-create.js';
import { inputError } from '../lib/input-errors.js';

import { getFriendScore, getFriendScoreHistory, addScore, getMileageRules, getMileageRuleById, createMileageRule, updateMileageRule, deleteMileageRule, getMileageEarningRulesV6, applyMileageRulesForEvent, getMileageAdjustmentNotificationRecord, getActionScoreOverview, getActionScoreBands, testMileageEarningRuleDraft, validateMileageEarningRuleDraft } from '@line-crm/db';
import type { ActionScoreFilter, ActionScoreSort } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { auditLog } from '../lib/audit-log.js';

import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { resolveRequestBoundary } from '../services/request-boundary.js';
import { isValidIdempotencyKey } from '../services/outbound-idempotency.js';
import { mileageAdjustmentMessage, sendMileageAdjustmentNotification } from '../features/mileage/mileage-adjustment-notification/index.js';
import { canUseMileageAccount, mileageV6Error, mileageRuleEventLabel, mileageCsvCell, ACTION_SCORE_FILTERS, ACTION_SCORE_SORTS } from './scoring-definition.js';
import type { Context } from 'hono';

export const post__api_mileage_entries_id_notification_retry_1 = async (c: Context<Env, "/api/mileage/entries/:id/notification-retry">) => {
    try {
      const body = await c.req.json<{ accountId?: unknown }>()
        .catch(() => ({} as { accountId?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return inputError(c, { success: false, error: 'LINE account not found' }, accountId ? 404 : 400, []);
      }
      const entryId = c.req.param('id');
      const entry = await c.env.DB.prepare(
        `SELECT id, beneficiary_friend_id, idempotency_key, amount, metadata
           FROM mileage_ledger
          WHERE id = ? AND program_id = 'default' AND entry_type = 'adjustment'
            AND json_extract(metadata, '$.lineAccountId') = ?`,
      ).bind(entryId, accountId).first<{
        id: string; beneficiary_friend_id: string | null; idempotency_key: string;
        amount: number; metadata: string | null;
      }>();
      if (!entry || !entry.beneficiary_friend_id) {
        return c.json({ success: false, error: 'Notification target not found' }, 404);
      }
      const record = await getMileageAdjustmentNotificationRecord(c.env.DB, {
        lineAccountId: accountId,
        ledgerEntryId: entry.id,
      });
      const metadata = entry.metadata ? JSON.parse(entry.metadata) as {
        notifyFriend?: boolean;
        adjustmentFingerprint?: string;
        balanceAfter?: number;
        expiresAt?: string | null;
      } : {};
      /*
       * 通知記録が無い＝依頼時に記録の作成自体が失敗した場合。古い台帳には
       * notifyFriend がないので、指紋の中の notifyFriend でも確かめる。
       */
      const fingerprintRequested = (() => {
        try {
          return JSON.parse(metadata.adjustmentFingerprint ?? '{}')?.notifyFriend === true;
        } catch {
          return false;
        }
      })();
      if (!record && metadata.notifyFriend !== true && !fingerprintRequested) {
        return c.json({ success: false, error: 'この調整に通知の依頼はありません' }, 404);
      }
      const notification = await sendMileageAdjustmentNotification(c, {
        lineAccountId: accountId,
        friendId: record?.friendId ?? entry.beneficiary_friend_id,
        ledgerEntryId: entry.id,
        idempotencyKey: record?.idempotencyKey ?? entry.idempotency_key,
        message: record?.messageText ?? mileageAdjustmentMessage({
          direction: entry.amount > 0 ? 'increase' : 'decrease',
          amount: Math.abs(entry.amount),
          balanceAfter: Number(metadata.balanceAfter ?? 0),
          expiresAt: metadata.expiresAt ?? null,
        }),
      });
      auditLog(c, 'mileage.adjustment.notification.retry', {
        kind: 'mileage_adjustment_notifications', id: notification.id ?? entry.id,
      });
      return c.json({ success: true, data: { notification } });
    } catch (error) {
      return mileageV6Error(c, error);
    }
  };

export const post__api_mileage_earning_rules_test_2 = async (c: Context<Env, "/api/mileage/earning-rules/test">) => {
    try {
      const body = await c.req.json<{ accountId?: unknown; draft?: unknown }>()
        .catch(() => ({} as { accountId?: unknown; draft?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return inputError(c, { success: false, error: 'LINE account not found' }, accountId ? 404 : 400, []);
      }
      const draft = validateMileageEarningRuleDraft(body.draft);
      const data = await testMileageEarningRuleDraft(c.env.DB, {
        lineAccountId: accountId,
        draft,
      });
      return c.json({ success: true, data });
    } catch (error) {
      return mileageV6Error(c, error);
    }
  };

export const get__api_mileage_rules_3 = async (c: Context<Env, "/api/mileage/rules">) => {
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const rules = (await getMileageRules(c.env.DB)).filter((rule) => rule.line_account_id == null
      ? scope.canSeeUnassigned
      : scope.allowedAccountIds.includes(rule.line_account_id));
    return c.json({ success: true, data: rules.map(serializeMileageRule) });
  } catch (err) {
    throw err;
  }
};

export const get__api_mileage_rules_export_4 = async (c: Context<Env, "/api/mileage/rules/export">) => {
  try {
    const staff = c.get('staff');
    const accountId = (c.req.query('accountId') ?? '').trim();
    if (!accountId) {
      return c.json({ success: false, error: 'LINE account not found' }, 400);
    }
    const decision = await resolveRequestBoundary(c.env.DB, staff, accountId);
    if (!decision.allowed) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    type RuleItem = Awaited<ReturnType<typeof getMileageEarningRulesV6>>['items'][number];
    const items: RuleItem[] = [];
    let offset = 0;
    for (;;) {
      const data = await getMileageEarningRulesV6(c.env.DB, { lineAccountId: accountId, limit: 100, offset });
      items.push(...data.items);
      if (items.length >= data.pagination.total || data.items.length === 0) break;
      offset += data.items.length;
    }
    const headers = ['決めごと', '対象の行動', 'たまるマイル', 'この30日の付与回数', '失効', '状態'];
    const rows = items.map((item) => [
      item.draft.name,
      mileageRuleEventLabel(item.draft.eventType),
      item.draft.amount,
      item.metrics30d.granted,
      item.draft.expiresAfterDays ?? '失効なし',
      item.published.status === 'published' ? '動いています' : '止めています',
    ]);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(mileageCsvCell).join(',')).join('\r\n')}\r\n`;
    c.set('outputAudit', { count: items.length, accountId });
    auditLog(c, 'mileage.rule.export', { kind: 'mileage_earning_rule_export', id: accountId });
    const day = japanDate();
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="mileage-earning-rules-${day}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    throw err;
  }
};

export const post__api_mileage_events_5 = async (c: Context<Env, "/api/mileage/events">) => {
  auditLog(c, 'mileage.event.create', { kind: 'mileage_event' });
  try {
    const body = await c.req.json<{
      friendId?: unknown;
      eventType?: unknown;
      source?: unknown;
      sourceEventId?: unknown;
      subjectKey?: unknown;
      metadata?: unknown;
      occurredAt?: unknown;
    }>();
    const friendId = typeof body.friendId === 'string' ? body.friendId.trim() : '';
    const eventType = typeof body.eventType === 'string' ? body.eventType.trim() : '';
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const sourceEventId = typeof body.sourceEventId === 'string' ? body.sourceEventId.trim() : '';
    if (!friendId || !eventType || !source || !sourceEventId) {
      return inputError(c, { success: false, error: 'friendId, eventType, source and sourceEventId are required' }, 400, ["friendId","eventType","source","sourceEventId"]);
    }
    if (friendId.length > 128 || eventType.length > 100 || source.length > 100 || sourceEventId.length > 256) {
      return inputError(c, { success: false, error: 'one or more fields are too long' }, 400, ["friendId","eventType","source","sourceEventId"]);
    }
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {};
    if (JSON.stringify(metadata).length > 4096) {
      return c.json({ success: false, error: 'metadata_too_large' }, 413);
    }
    const result = await applyMileageRulesForEvent(c.env.DB, {
      friendId,
      eventType,
      source,
      sourceEventId,
      subjectKey: typeof body.subjectKey === 'string' ? body.subjectKey.slice(0, 256) : null,
      metadata,
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
    });
    return c.json({ success: true, data: { eventId: result.event.id, queued: true } }, 202);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Mileage friend not found:')) {
      return c.json({ success: false, error: 'friend_not_found' }, 404);
    }
    throw err;
  }
};

export const post__api_mileage_rules_6 = async (c: Context<Env, "/api/mileage/rules">) => {
  auditLog(c, 'mileage.rule.create', { kind: 'mileage_rule' });
  try {
    const body = await c.req.json<{
      name?: string;
      eventType?: string;
      source?: string | null;
      amount?: number;
      initialStatus?: 'pending' | 'available';
      conditions?: {
        dailyCapActions?: number;
        uniquePerSubject?: boolean;
        uniquePerSubjectPerDay?: boolean;
        ignoreMultiplier?: boolean;
        beneficiary?: 'actor' | 'referrer';
        uniquePerReferredFriend?: boolean;
        uniquePerReferredFriendPerSubject?: boolean;
      } | null;
      validFrom?: string | null;
      validUntil?: string | null;
      /** 334(#521): 帰属アカウント。 */
      lineAccountId?: string;
      /** DRAFT-01: falseなら停止中で作る。省略は従来どおり稼働。 */
      isActive?: boolean;
    }>();
    if (!body.name?.trim() || !body.eventType?.trim() || !Number.isInteger(body.amount) || (body.amount ?? 0) <= 0) {
      return inputError(c, { success: false, error: 'name, eventType and a positive integer amount are required' }, 400, ["name","eventType","amount"]);
    }
    if (!body.lineAccountId?.trim()) {
      return inputError(c, { success: false, error: 'lineAccountId is required' }, 400, ["lineAccountId"]);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    // N-240: Idempotency-Key 付きの作成は二重作成しない。キーなしは従来通り。
    const requestKey = c.req.header('Idempotency-Key')?.trim();
    if (requestKey !== undefined && requestKey !== '') {
      if (!isValidIdempotencyKey(requestKey)) {
        return inputError(c, { success: false, error: '有効なIdempotency-Keyが必要です' }, 400, ["friendId","rewardId","requestId"]);
      }
      const result = await createMileageRuleIdempotent(c.env.DB, {
        name: body.name.trim(),
        eventType: body.eventType.trim(),
        source: body.source ?? null,
        amount: body.amount!,
        initialStatus: body.initialStatus,
        conditions: body.conditions,
        validFrom: body.validFrom ?? null,
        validUntil: body.validUntil ?? null,
        lineAccountId: body.lineAccountId,
        isActive: body.isActive,
        requestKey,
      });
      return c.json(result.body, result.status);
    }
    const rule = await createMileageRule(c.env.DB, {
      name: body.name.trim(),
      eventType: body.eventType.trim(),
      source: body.source ?? null,
      amount: body.amount!,
      initialStatus: body.initialStatus,
      conditions: body.conditions,
      validFrom: body.validFrom ?? null,
      validUntil: body.validUntil ?? null,
      lineAccountId: body.lineAccountId,
      isActive: body.isActive,
    });
    return c.json({ success: true, data: serializeMileageRule(rule) }, 201);
  } catch (err) {
    throw err;
  }
};

export const put__api_mileage_rules_id_7 = async (c: Context<Env, "/api/mileage/rules/:id">) => {
  auditLog(c, 'mileage.rule.update', { kind: 'mileage_rule', id: c.req.param('id') });
  try {
    const body = await c.req.json<{
      name?: string;
      eventType?: string;
      source?: string | null;
      amount?: number;
      initialStatus?: 'pending' | 'available';
      conditions?: {
        dailyCapActions?: number;
        uniquePerSubject?: boolean;
        uniquePerSubjectPerDay?: boolean;
        ignoreMultiplier?: boolean;
        beneficiary?: 'actor' | 'referrer';
        uniquePerReferredFriend?: boolean;
        uniquePerReferredFriendPerSubject?: boolean;
      } | null;
      isActive?: boolean;
    }>();
    if (body.amount !== undefined && (!Number.isInteger(body.amount) || body.amount <= 0)) {
      return inputError(c, { success: false, error: 'amount must be a positive integer' }, 400, ["amount"]);
    }
    const existing = await getMileageRuleById(c.env.DB, c.req.param('id'));
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing.line_account_id == null) {
      return c.json({ success: false, error: '全店共通の旧ルールは変更できません' }, 409);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [existing.line_account_id])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    // N-231 案1: 公開内容の直接変更は閉じる。下書き→公開の口を使ってください。
    // 停止・再開(isActive)だけは公開内容を変えないため、このまま許可する。
    const directContentKeys = (['name', 'eventType', 'source', 'amount', 'initialStatus', 'conditions'] as const)
      .filter((key) => body[key] !== undefined);
    if (directContentKeys.length > 0) {
      return c.json({
        success: false,
        error: '公開内容は直接変更できません。下書きを保存して「公開して反映」してください',
      }, 409);
    }
    const updated = await updateMileageRule(c.env.DB, existing.id, { isActive: body.isActive });
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeMileageRule(updated) });
  } catch (err) {
    throw err;
  }
};

export const delete__api_mileage_rules_id_8 = async (c: Context<Env, "/api/mileage/rules/:id">) => {
  auditLog(c, 'mileage.rule.delete', { kind: 'mileage_rule', id: c.req.param('id') });
  try {
    const existing = await getMileageRuleById(c.env.DB, c.req.param('id'));
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing.line_account_id == null) {
      return c.json({ success: false, error: '全店共通の旧ルールは削除できません' }, 409);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [existing.line_account_id])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    // N-232: 付与履歴がある決めごとは1文の原子DELETEで守る。SELECTとDELETEを分けると
    // その間に履歴が作られる競合で消せてしまう。0件なら履歴ありとして409で安全拒否し、
    // 停止(PUT isActive=false)へ誘導する。
    const deleted = await deleteMileageRule(c.env.DB, existing.id);
    if (deleted === 0) {
      return c.json({ success: false, error: '付与履歴があるため削除できません。先に停止してください' }, 409);
    }
    return c.json({ success: true, data: null });
  } catch (err) {
    throw err;
  }
};

export const get__api_action_scores_friends_9 = async (c: Context<Env, "/api/action-scores/friends">) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!scope.allowedAccountIds.includes(accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const filterValue = c.req.query('filter') ?? 'all';
    const sortValue = c.req.query('sort') ?? 'score_desc';
    if (!ACTION_SCORE_FILTERS.has(filterValue as ActionScoreFilter)) {
      return c.json({ success: false, error: 'filter is invalid' }, 400);
    }
    if (!ACTION_SCORE_SORTS.has(sortValue as ActionScoreSort)) {
      return c.json({ success: false, error: 'sort is invalid' }, 400);
    }
    const requestedLimit = Number(c.req.query('limit') || 20);
    const requestedOffset = Number(c.req.query('offset') || 0);
    const bands = await getActionScoreBands(c.env.DB, accountId);
    const data = await getActionScoreOverview(c.env.DB, {
      accountId,
      highMin: bands.highMin,
      normalMin: bands.normalMin,
      search: c.req.query('search') || '',
      filter: filterValue as ActionScoreFilter,
      sort: sortValue as ActionScoreSort,
      limit: Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 20,
      offset: Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0,
    });
    return c.json({ success: true, data });
  } catch (err) {
    throw err;
  }
};

export const get__api_friends_id_score_10 = async (c: Context<Env, "/api/friends/:id/score">) => {
  try {
    const friendId = c.req.param('id');
    const [score, history] = await Promise.all([
      getFriendScore(c.env.DB, friendId),
      getFriendScoreHistory(c.env.DB, friendId),
    ]);
    return c.json({
      success: true,
      data: {
        friendId,
        currentScore: score,
        /*
         * IDEA-17: 点数が変わった根拠を明細から辿れるように、発生した出来事・
         * 発生日時・前後の点数・動かした方法まで返す。旧行の NULL は欠損の
         * まま返し、表示側で「未取得」と書き分ける。
         */
        history: history.map((h) => ({
          id: h.id,
          scoringRuleId: h.scoring_rule_id,
          ruleKey: h.rule_key,
          scoreChange: h.score_change,
          scoreBefore: h.score_before,
          scoreAfter: h.score_after,
          reason: h.reason,
          eventType: h.event_type,
          source: h.source,
          occurredAt: h.occurred_at ?? h.created_at,
          createdAt: h.created_at,
          mode: h.executed_by_staff_id || h.executed_by_staff_name ? 'manual' : 'automatic',
          executedByStaffName: h.executed_by_staff_name,
        })),
      },
    });
  } catch (err) {
    throw err;
  }
};

export const post__api_friends_id_score_11 = async (c: Context<Env, "/api/friends/:id/score">) => {
  try {
    const friendId = c.req.param('id');
    const body = await c.req.json<{ scoreChange: number; reason?: string }>();
    if (typeof body.scoreChange !== 'number' || !Number.isFinite(body.scoreChange)) {
      return inputError(c, { success: false, error: 'scoreChange must be a finite number' }, 400, ["scoreChange"]);
    }
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) return inputError(c, { success: false, error: '点数を変更する理由が必要です' }, 400, ['reason']);
    const requestKey = c.req.header('Idempotency-Key');
    if (!requestKey?.trim()) return inputError(c, { success: false, error: 'Idempotency-Key が必要です' }, 400, []);
    if (requestKey !== undefined && (!requestKey.trim() || requestKey.length > 128)) {
      return inputError(c, { success: false, error: 'Invalid Idempotency-Key' }, 400, ["friendId","rewardId","requestId"]);
    }
    const staff = c.get('staff');
    await addScore(c.env.DB, {
      friendId,
      scoreChange: body.scoreChange,
      reason: body.reason,
      // IDEA-17: 手で動かした点数は「だれが」を明細からたどれるようにする。
      executedByStaffId: staff?.id ?? null,
      executedByStaffName: staff?.name ?? null,
      idempotencyKey: requestKey ? JSON.stringify(['manual', staff?.id ?? null, requestKey]) : undefined,
    });
    const newScore = await getFriendScore(c.env.DB, friendId);
    return c.json({ success: true, data: { friendId, currentScore: newScore } }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'score_idempotency_conflict') {
      return c.json({ success: false, error: '同じ操作番号で異なる加点はできません' }, 409);
    }
    throw err;
  }
};
