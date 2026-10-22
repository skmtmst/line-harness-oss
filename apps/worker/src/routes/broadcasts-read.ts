import { listQueryNumber } from '../lib/list-paging.js';
import { logger } from '@line-crm/shared/server';
import { simulationContext } from '../features/broadcasts/broadcast-simulation/index.js';
import { broadcastSendPreview } from '../services/gap-send-preview.js';
import { parseJsonArray, parseJsonObject } from './broadcast-json.js';
import { sqlIdSet } from '@line-crm/db/id-queries';
import { inputError } from '../lib/input-errors.js';
import { parseExecutionDateRange } from '@line-crm/shared';

import { getBroadcastListPage, getBroadcastById, getVersionedAccountSetting, saveVersionedAccountSetting, countBroadcastLedger, classifyBroadcastRecipient, deriveBroadcastDisplayStatus, listBroadcastActivity, BROADCAST_DISPLAY_STATUS_LABELS } from '@line-crm/db';
import type { BroadcastDisplayStatus } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { listResponse } from '../lib/list-etag.js';
import { computeDedupBroadcastPreview } from '../services/dedup-broadcast.js';
import { getLineAccountById } from '@line-crm/db';
import type { Env } from '../worker-env.js';

import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { ACCOUNT_ACCESS_ERROR, ledgerCountsForBroadcasts, serializeBroadcast, BroadcastNotificationSettings, BROADCAST_NOTIFICATION_KEY, DEFAULT_BROADCAST_NOTIFICATIONS, notificationSentence, canAccessBroadcast, broadcastStatusView, recipientResultFilter, failedBreakdown } from './broadcasts-definition.js';
import type { Context, Next } from 'hono';

export const use__api_broadcasts_id__1 = async (c: Context<Env, "/api/broadcasts/:id/*">, next: Next) => {if(c.req.method!=='GET'&&/\/(test-send|send-segment|resume|retry-failed)$/.test(c.req.path)&&await simulationContext(c.env.DB,c.req.param('id')!))return c.json({success:false,error:'simulation_transport_only'},409);await next();};

export const get__api_broadcasts_2 = async (c: Context<Env, "/api/broadcasts">) => {
  const lineAccountId = c.req.query('lineAccountId');
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (lineAccountId && !scope.allowedAccountIds.includes(lineAccountId)) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  // 並び順は一覧画面の選択と連動する。知らない値は新しい順に倒す。
  let range;
  try { range = parseExecutionDateRange({ from: c.req.query('from'), to: c.req.query('to') }); }
  catch (error) { return c.json({ success: false, error: (error as Error).message }, 400); }
  const sort = c.req.query('sort') === 'oldest' ? 'asc' as const : 'desc' as const;
  const status = c.req.query('status');
  const folderId = c.req.query('folderId');
  const displayStatusParam = c.req.query('displayStatus');
  const cursor = Math.max(0, listQueryNumber(c.req.query('cursor'), '0', { format: 'integer-prefix' }) || 0);
  const limit = Math.min(100, Math.max(1, listQueryNumber(c.req.query('limit'), 20, { format: 'integer-prefix' }) || 20));
  const page = await getBroadcastListPage(c.env.DB, lineAccountId || undefined, scope, {
    order: sort, ...range, folderId, status,
    displayStatuses: displayStatusParam ? displayStatusParam.split(',').map(value => value.trim()).filter(Boolean) : undefined,
    limit, offset: cursor,
  });
  const pageItems = page.items;
  const statusCounts = page.statusCounts;
  const ledgerMap = await ledgerCountsForBroadcasts(c.env.DB, pageItems.map(item => item.id));
  const displayStatusOf = (item: unknown): BroadcastDisplayStatus => {
    const raw = item as Record<string, unknown>;
    const counts = ledgerMap.get(String(raw.id)) ?? { sent: 0, failed: 0, unknown: 0, claimed: 0 };
    return deriveBroadcastDisplayStatus({status:String(raw.status??'draft'),
      approvalStatus:(raw.approval_status as string|null|undefined)??'none',
      scheduledAt:(raw.scheduled_at as string|null|undefined)??null,stopped:!!raw.stopped_at,
      sent:counts.sent,failed:counts.failed,unknown:counts.unknown,
      ledgerRows:counts.sent+counts.failed+counts.unknown+counts.claimed});
  };
  const { getBroadcastStats } = await import('@line-crm/db');
  const stats = await getBroadcastStats(c.env.DB, lineAccountId || undefined, scope);
  const data = pageItems.map((item) => {
    const displayStatus = displayStatusOf(item);
    return {
      ...serializeBroadcast(item),
      displayStatus,
      displayStatusLabel: (item as unknown as Record<string,unknown>).execution_mode==='simulation'&&item.status==='sent'?'模擬で確認済み':BROADCAST_DISPLAY_STATUS_LABELS[displayStatus],
    };
  });
  // 同じ中身なら304（list-etag）。
  return listResponse(c, {
    success: true,
    data,
    kpis: {
      scheduled: stats.scheduled,
      drafts: page.drafts,
      thisMonth: stats.thisMonth,
      delivered: stats.delivered,
      openRate: stats.openRate,
    },
    statusCounts,
    pagination: {
      total: page.total,
      limit,
      cursor,
      nextCursor: cursor + limit < page.total ? String(cursor + limit) : null,
    },
  });
};

export const get__api_broadcasts_stats_3 = async (c: Context<Env, "/api/broadcasts/stats">) => {
  const lineAccountId = c.req.query('lineAccountId');
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (lineAccountId && !scope.allowedAccountIds.includes(lineAccountId)) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  const { getBroadcastStats } = await import('@line-crm/db');
  return c.json({
    success: true as const,
    data: await getBroadcastStats(c.env.DB, lineAccountId || undefined, scope),
  });
};

export const get__api_broadcasts_notification_settings_4 = async (c: Context<Env, "/api/broadcasts/notification-settings">) => {
  const lineAccountId = c.req.query('lineAccountId')?.trim();
  if (!lineAccountId) return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  const stored = await getVersionedAccountSetting<BroadcastNotificationSettings>(
    c.env.DB, lineAccountId, BROADCAST_NOTIFICATION_KEY,
  );
  const settings = stored?.data ?? DEFAULT_BROADCAST_NOTIFICATIONS;
  return c.json({ success: true, data: { version: stored?.version ?? 0, ...settings, displayText: notificationSentence(settings) } });
};

export const put__api_broadcasts_notification_settings_5 = async (c: Context<Env, "/api/broadcasts/notification-settings">) => {
  const lineAccountId = c.req.query('lineAccountId')?.trim();
  if (!lineAccountId) return inputError(c, { success: false, error: 'LINE公式アカウントを選んでください' }, 400, ["lineAccountId"]);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  const body: Record<string, unknown> = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({} as Record<string, unknown>));
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0
    || ['started', 'completed', 'failed'].some((key) => typeof body[key] !== 'boolean')) {
    return inputError(c, { success: false, error: '通知設定と現在の版を確認してください' }, 400, ["expectedVersion"]);
  }
  const data: BroadcastNotificationSettings = {
    started: body.started === true, completed: body.completed === true, failed: body.failed === true,
  };
  const result = await saveVersionedAccountSetting(c.env.DB, {
    accountId: lineAccountId, key: BROADCAST_NOTIFICATION_KEY, expectedVersion, data,
  });
  if (result.status === 'conflict') {
    return c.json({ success: false, code: 'version_conflict', error: '通知設定が更新されています。読み直してください' }, 409);
  }
  return c.json({ success: true, data: { version: result.setting.version, ...data, displayText: notificationSentence(data) } });
};

export const get__api_broadcasts_saved_views_6 = async (c: Context<Env, "/api/broadcasts/saved-views">) => {
  const lineAccountId = c.req.query('lineAccountId');
  if (!lineAccountId) return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, name, filters_json, sort_key, page_size, created_by, created_at, updated_at, version
         FROM broadcast_saved_views WHERE line_account_id = ?
        ORDER BY updated_at DESC, id`,
  ).bind(lineAccountId).all<Record<string, unknown>>();
  return c.json({
    success: true,
    data: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      filters: parseJsonObject(row.filters_json) ?? {},
      sortKey: row.sort_key,
      pageSize: Number(row.page_size),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: Number(row.version),
    })),
  });
};

export const post__api_broadcasts_saved_views_7 = async (c: Context<Env, "/api/broadcasts/saved-views">) => {
  const lineAccountId = c.req.query('lineAccountId');
  if (!lineAccountId) return inputError(c, { success: false, error: 'LINE公式アカウントを選んでください' }, 400, ["lineAccountId"]);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  const body: { name?: unknown; filters?: unknown; sortKey?: unknown; pageSize?: unknown } = await c.req
    .json<{ name?: unknown; filters?: unknown; sortKey?: unknown; pageSize?: unknown }>()
    .catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 60) return inputError(c, { success: false, error: '名前は1〜60文字で入力してください' }, 400, ["name"]);
  if (!body.filters || typeof body.filters !== 'object' || Array.isArray(body.filters)) {
    return inputError(c, { success: false, error: 'filters must be an object' }, 400, ["filters"]);
  }
  const sortKey = typeof body.sortKey === 'string' ? body.sortKey : 'newest';
  if (!['newest', 'oldest', 'title', 'scheduled'].includes(sortKey)) {
    return inputError(c, { success: false, error: 'sortKey is invalid' }, 400, ["sortKey"]);
  }
  const pageSize = body.pageSize === undefined ? 20 : Number(body.pageSize);
  if (![20, 50, 100].includes(pageSize)) return inputError(c, { success: false, error: 'pageSize is invalid' }, 400, ["pageSize"]);
  const duplicate = await c.env.DB.prepare(
    'SELECT id FROM broadcast_saved_views WHERE line_account_id = ? AND name = ?',
  ).bind(lineAccountId, name).first<{ id: string }>();
  if (duplicate) return c.json({ success: false, error: '同じ名前の保存した検索があります' }, 409);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO broadcast_saved_views
         (id, line_account_id, name, filters_json, sort_key, page_size, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, lineAccountId, name, JSON.stringify(body.filters), sortKey, pageSize, c.get('staff')!.id, now, now).run();
  return c.json({
    success: true,
    data: { id, name, filters: body.filters, sortKey, pageSize, createdBy: c.get('staff')!.id, createdAt: now, updatedAt: now, version: 1 },
  }, 201);
};

export const get__api_broadcasts_id_8 = async (c: Context<Env, "/api/broadcasts/:id">) => {
  const id = c.req.param('id');
  const broadcast = await getBroadcastById(c.env.DB, id);

  if (!broadcast) {
    return c.json({ success: false, error: 'Broadcast not found' }, 404);
  }
  if (!await canAccessBroadcast(c.env.DB, c.get('staff'), broadcast)) {
    return c.json({ success: false, error: 'Broadcast not found' }, 404);
  }

  const view = await broadcastStatusView(c.env.DB, broadcast as unknown as Record<string, unknown>);
  return c.json({
    success: true,
    data: {
      ...serializeBroadcast(broadcast),
      displayStatus: view.displayStatus,
      displayStatusLabel: view.displayStatusLabel,
      ledger: view.ledger,
    },
  });
};

export const get__api_broadcasts_id_recipients_9 = async (c: Context<Env, "/api/broadcasts/:id/recipients">) => {
  const id = c.req.param('id');
  const broadcast = await getBroadcastById(c.env.DB, id);
  if (!broadcast || !await canAccessBroadcast(c.env.DB, c.get('staff'), broadcast)) {
    return c.json({ success: false, error: 'Broadcast not found' }, 404);
  }
  const raw = broadcast as unknown as Record<string, unknown>;
  const result = c.req.query('result') ?? 'all';
  if (!['all', 'delivered', 'temporary', 'permanent', 'unknown', 'inflight'].includes(result)) {
    return c.json({ success: false, error: 'result が正しくありません' }, 400);
  }
  const cursor = Math.max(0, listQueryNumber(c.req.query('cursor'), '0', { format: 'integer-prefix' }) || 0);
  const limit = Math.min(100, Math.max(1, listQueryNumber(c.req.query('limit'), 50, { format: 'integer-prefix' }) || 50));
  const filter = recipientResultFilter(result);

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM broadcast_send_claims c WHERE c.broadcast_id = ?${filter}`,
  ).bind(id).first<{ cnt: number }>();
  const total = Number(totalRow?.cnt ?? 0);

  // 全員配信は宛先の一覧を持たない。旧配信（送り終えているのに行が無い）は
  // 集約だけを返し、宛先の行を作らない。
  const isAll = broadcast.target_type === 'all';
  const aggregateOnly = isAll || (broadcast.status === 'sent' && total === 0);
  interface RecipientRow {
    friend_id: string; line_account_id: string | null; state: string;
    error_code: string | null; line_request_id: string | null;
    dispatched_at: string | null; settled_at: string | null; display_name: string | null;
  }
  const queryResult = aggregateOnly
    ? { results: [] as RecipientRow[] }
    : await c.env.DB.prepare(
      `SELECT c.friend_id, c.line_account_id, c.state, c.error_code,
                c.line_request_id, c.dispatched_at, c.settled_at,
                f.display_name
           FROM broadcast_send_claims c
           LEFT JOIN friends f ON f.id = c.friend_id
          WHERE c.broadcast_id = ?${filter}
          ORDER BY COALESCE(f.display_name, ''), c.friend_id
          LIMIT ? OFFSET ?`,
    ).bind(id, limit + 1, cursor).all<RecipientRow>();
  const allRows = queryResult.results ?? [];
  const page = allRows.slice(0, limit);
  const [counts, breakdown] = await Promise.all([
    countBroadcastLedger(c.env.DB, id),
    failedBreakdown(c.env.DB, id),
  ]);
  const ledgerRows = counts.sent + counts.failed + counts.unknown + counts.claimed;
  const totalCount = raw.total_count as number | null | undefined;
  const summary = {
    sent: counts.sent,
    failedTemporary: breakdown.temporary,
    failedPermanent: breakdown.permanent,
    unknown: counts.unknown,
    inFlight: counts.claimed,
    pending: totalCount == null ? null : Math.max(0, Number(totalCount) - ledgerRows),
    total: totalCount == null ? ledgerRows : Number(totalCount),
    retryableCount: breakdown.temporary,
  };
  return c.json({
    success: true,
    data: {
      rows: page.map((row) => {
        const view = classifyBroadcastRecipient(row.state, row.error_code);
        return {
          friendId: row.friend_id,
          displayName: row.display_name || '名前がありません',
          lineAccountId: row.line_account_id,
          group: view.group,
          label: view.label,
          detail: view.detail,
          retryable: view.retryable,
          lineRequestId: row.line_request_id,
          errorCode: row.error_code,
          dispatchedAt: row.dispatched_at,
          settledAt: row.settled_at,
        };
      }),
      summary,
      aggregateOnly,
      aggregateReason: aggregateOnly ? (isAll ? 'all' : 'legacy') : null,
      // 旧配信は集約（成功数）だけ分かっているので返す。捏造はしない。
      legacySuccessCount: aggregateOnly && !isAll
        ? Number(raw.success_count ?? 0)
        : null,
    },
    pagination: {
      total,
      limit,
      cursor,
      nextCursor: allRows.length > limit ? String(cursor + limit) : null,
    },
  });
};

export const get__api_broadcasts_id_activity_10 = async (c: Context<Env, "/api/broadcasts/:id/activity">) => {
  const id = c.req.param('id');
  const broadcast = await getBroadcastById(c.env.DB, id);
  if (!broadcast || !await canAccessBroadcast(c.env.DB, c.get('staff'), broadcast)) {
    return c.json({ success: false, error: 'Broadcast not found' }, 404);
  }
  const cursor = Math.max(0, listQueryNumber(c.req.query('cursor'), '0', { format: 'integer-prefix' }) || 0);
  const limit = Math.min(100, Math.max(1, listQueryNumber(c.req.query('limit'), 50, { format: 'integer-prefix' }) || 50));
  const { entries, nextCursor } = await listBroadcastActivity(c.env.DB, id, { limit, cursor });
  return c.json({
    success: true,
    data: entries,
    pagination: { limit, cursor, nextCursor },
  });
};

export const get__api_broadcasts_id_send_preview_11 = async (c: Context<Env, "/api/broadcasts/:id/send-preview">) => {
  const b=await getBroadcastById(c.env.DB,c.req.param('id'));
  if(!b || !await canAccessBroadcast(c.env.DB,c.get('staff'),b)) return c.json({success:false,error:'not_found'},404);
  try { return c.json({success:true,data:await broadcastSendPreview(c.env.DB,b)}); }
  catch { return c.json({success:false,error:'send_preview_unavailable'},503); }
};

export const get__api_broadcasts_id_preview_count_12 = async (c: Context<Env, "/api/broadcasts/:id/preview-count">) => {
  const id = c.req.param('id');
  const broadcast = await getBroadcastById(c.env.DB, id);
  if (!broadcast) {
    return c.json({ success: false, error: 'Broadcast not found' }, 404);
  }
  if (!await canAccessBroadcast(c.env.DB, c.get('staff'), broadcast)) {
    return c.json({ success: false, error: 'Broadcast not found' }, 404);
  }

  const raw = broadcast as unknown as Record<string, unknown>;
  let count = 0;
  let perAccount: Array<{ accountId: string; sendCount: number }> | undefined;

  if (broadcast.target_type === 'multi-account-dedup') {
    const accountIds = parseJsonArray(raw.account_ids) ?? [];
    const dedupPriority = parseJsonArray(raw.dedup_priority) ?? [];
    const preview = await computeDedupBroadcastPreview(
      c.env.DB,
      accountIds,
      dedupPriority,
      broadcast.target_tag_id ?? null,
    );
    // /send パスと同じく inactive/missing アカウントを除外して、実送信数の見積りを返す。
    // 同時に per-account breakdown も返して confirm modal に表示できるようにする。
    const { getLineAccountById } = await import('@line-crm/db');
    let active = 0;
    const breakdown: Array<{ accountId: string; sendCount: number }> = [];
    for (const a of preview.perAccount) {
      const account = await getLineAccountById(c.env.DB, a.accountId);
      if (account && account.is_active) {
        active += a.recipients.length;
        breakdown.push({ accountId: a.accountId, sendCount: a.recipients.length });
      }
    }
    count = active;
    perAccount = breakdown;
  } else if (broadcast.target_type === 'tag' && broadcast.target_tag_id) {
    // 実送信は getFriendsByTag(db, tagId, line_account_id) で要求アカウントに
    // 絞る (services/broadcast.ts)。プレビューも同じ境界で数え、他アカウント
    // の人数・存在を応答へ漏らさない (N-060)。
    const tagAccountId = (raw.line_account_id as string | null) || null;
    const tagSql = tagAccountId
      ? `SELECT COUNT(*) AS cnt FROM friends f
           INNER JOIN friend_tags ft ON ft.friend_id = f.id
           WHERE ft.tag_id = ? AND f.is_following = 1 AND f.line_account_id = ?`
      : `SELECT COUNT(*) AS cnt FROM friends f
           INNER JOIN friend_tags ft ON ft.friend_id = f.id
           WHERE ft.tag_id = ? AND f.is_following = 1`;
    const tagBinds: unknown[] = tagAccountId
      ? [broadcast.target_tag_id, tagAccountId]
      : [broadcast.target_tag_id];
    const row = await c.env.DB.prepare(tagSql).bind(...tagBinds).first<{ cnt: number }>();
    count = row?.cnt ?? 0;
  } else if (broadcast.target_type === 'segment') {
    // 絞り込み配信。条件は下書きに入っている。作った条件と、送る前に出す
    // 人数がずれないよう、送信と同じ組み立てを使う。
    const rawConditions = raw.segment_conditions as string | null;
    try {
      const conditions = rawConditions ? JSON.parse(rawConditions) : null;
      if (conditions && Array.isArray(conditions.rules)) {
        const { buildSegmentQuery } = await import('../services/segment-query.js');
        const { sql, bindings } = buildSegmentQuery(conditions);
        const accountId = (raw.line_account_id as string | null) || null;
        const countSql = accountId
          ? `SELECT COUNT(*) AS cnt FROM (${sql.replace('WHERE', 'WHERE f.line_account_id = ? AND')}) q`
          : `SELECT COUNT(*) AS cnt FROM (${sql}) q`;
        const binds = accountId ? [accountId, ...bindings] : bindings;
        const row = await c.env.DB.prepare(countSql).bind(...binds).first<{ cnt: number }>();
        count = row?.cnt ?? 0;
      }
    } catch (segmentError) {
      // 条件が壊れているときは 0 を返す。ここで500にすると、下書きの一覧
      // そのものが開かなくなる。送信を押した時点で理由付きで止まる。
      logger.error("broadcasts.broadcasts_id_preview_count_get_failed");
    }
  } else if (broadcast.target_type === 'all') {
    const accountId = (raw.line_account_id as string | null) || null;
    const sql = accountId
      ? `SELECT COUNT(*) AS cnt FROM friends WHERE is_following = 1 AND line_account_id = ?`
      : `SELECT COUNT(*) AS cnt FROM friends WHERE is_following = 1`;
    const binds: unknown[] = accountId ? [accountId] : [];
    const row = await c.env.DB.prepare(sql).bind(...binds).first<{ cnt: number }>();
    count = row?.cnt ?? 0;
  }

  return c.json({ success: true, data: { count, perAccount } });
};

export const get__api_broadcasts_id_per_account_stats_13 = async (c: Context<Env, "/api/broadcasts/:id/per-account-stats">) => {
  const id = c.req.param('id');
  const broadcast = await getBroadcastById(c.env.DB, id);
  if (!broadcast) {
    return c.json({ success: false, error: 'Broadcast not found' }, 404);
  }
  if (!await canAccessBroadcast(c.env.DB, c.get('staff'), broadcast)) {
    return c.json({ success: false, error: 'Broadcast not found' }, 404);
  }

  const raw = broadcast as unknown as Record<string, unknown>;
  const aggregationUnit = (raw.aggregation_unit as string | null) || null;

  // 対象アカウントリスト: dedup なら account_ids JSON、それ以外なら line_account_id 単独
  let accountIds: string[];
  if (broadcast.target_type === 'multi-account-dedup') {
    accountIds = parseJsonArray(raw.account_ids) ?? [];
  } else {
    const single = (raw.line_account_id as string | null) || null;
    accountIds = single ? [single] : [];
  }

  if (accountIds.length === 0) {
    return c.json({ success: true, data: [] });
  }

  // sent 数: messages_log の line_account_id (送信時固定) で GROUP BY する。
  // 旧データ (032 migration 前) は ml.line_account_id=NULL なので、その場合だけ
  // friends.line_account_id にフォールバックする (best-effort、現在のアカウント帰属で集計)。
  const placeholders = sqlIdSet(accountIds).sql;
  const sentRes = await c.env.DB.prepare(
    `SELECT COALESCE(ml.line_account_id, f.line_account_id) AS account_id, COUNT(*) AS sent
       FROM messages_log ml
       INNER JOIN friends f ON f.id = ml.friend_id
       WHERE ml.broadcast_id = ? AND ml.direction = 'outgoing'
         AND COALESCE(ml.line_account_id, f.line_account_id) IN (${placeholders})
       GROUP BY COALESCE(ml.line_account_id, f.line_account_id)`,
  ).bind(id, ...(accountIds.length ? sqlIdSet(accountIds).binds : [])).all<{ account_id: string; sent: number }>();
  const sentMap = new Map<string, number>();
  for (const r of sentRes.results ?? []) sentMap.set(r.account_id, r.sent);

  // アカウント名
  const metaRes = await c.env.DB.prepare(
    `SELECT id, name FROM line_accounts WHERE id IN (${placeholders})`,
  ).bind(...(accountIds.length ? sqlIdSet(accountIds).binds : [])).all<{ id: string; name: string }>();
  const nameMap = new Map<string, string>();
  for (const r of metaRes.results ?? []) nameMap.set(r.id, r.name);

  // insight: status='sent' かつ aggregation_unit がある場合だけ live fetch する。
  // 各アカウントの LINE API call は 3-5 秒かかるので、Promise.all で並列化して
  // 4 アカ夢中なら ~5 秒、シリアルだと ~20 秒の差。Worker / browser timeout 回避用。
  const insightMap = new Map<string, { uniqueImpression: number | null; uniqueClick: number | null }>();
  if (broadcast.status === 'sent' && aggregationUnit && broadcast.sent_at) {
    const sentDate = broadcast.sent_at.slice(0, 10).replace(/-/g, '');
    const { getLineAccountById } = await import('@line-crm/db');
    await Promise.all(
      accountIds.map(async (aid) => {
        const account = await getLineAccountById(c.env.DB, aid);
        if (!account) return;
        try {
          const client = new LineClient(account.channel_access_token);
          const response = await client.getUnitInsight(aggregationUnit, sentDate, sentDate) as Record<string, unknown>;
          const messages = response.messages as Array<Record<string, unknown>> | undefined;
          const overview = messages?.[0] || {};
          insightMap.set(aid, {
            uniqueImpression: (overview.uniqueImpression as number) ?? null,
            uniqueClick: (overview.uniqueClick as number) ?? null,
          });
        } catch (err) {
          logger.error("broadcasts.broadcasts_id_per_account_stats_get_failed");
        }
      }),
    );
  }

  const result = accountIds.map((aid) => ({
    accountId: aid,
    accountName: nameMap.get(aid) ?? aid,
    sent: sentMap.get(aid) ?? 0,
    uniqueImpression: insightMap.get(aid)?.uniqueImpression ?? null,
    uniqueClick: insightMap.get(aid)?.uniqueClick ?? null,
  }));

  return c.json({ success: true, data: result });
};
