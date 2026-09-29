import { getLineAccountById, type Broadcast } from '@line-crm/db';

import { computeDedupBroadcastPreview } from './dedup-broadcast.js';
import { buildSegmentQuery } from './segment-query.js';

export type BroadcastAudiencePreview = {
  /** 条件を安全に読み取れない場合は0へ潰さずnull。 */
  count: number | null;
  perAccount?: Array<{ accountId: string; sendCount: number }>;
};

function parseJsonStringArray(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === 'string') ? value : null;
  }
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function broadcastAccountId(broadcast: Broadcast, requestedAccountId?: string | null): string | null {
  if (requestedAccountId) return requestedAccountId;
  return broadcast.line_account_id ?? null;
}

/**
 * 緊急停止の直前に、現在の配信条件から宛先数を再計算する。
 * 読めない条件を「0人」と扱うと危険なため、その場合はnullを返す。
 */
export async function getBroadcastAudiencePreview(
  db: D1Database,
  broadcast: Broadcast,
  requestedAccountId?: string | null,
): Promise<BroadcastAudiencePreview> {
  const raw = broadcast as unknown as Record<string, unknown>;

  if (broadcast.target_type === 'multi-account-dedup') {
    const accountIds = parseJsonStringArray(raw.account_ids);
    const dedupPriority = raw.dedup_priority == null
      ? []
      : parseJsonStringArray(raw.dedup_priority);
    if (!accountIds || !dedupPriority) return { count: null };

    const preview = await computeDedupBroadcastPreview(
      db,
      accountIds,
      dedupPriority,
      broadcast.target_tag_id ?? null,
    );
    const accountRows = await Promise.all(preview.perAccount.map(async (row) => ({
      row,
      account: await getLineAccountById(db, row.accountId),
    })));
    const perAccount = accountRows
      .filter(({ row, account }) =>
        Boolean(account?.is_active) && (!requestedAccountId || row.accountId === requestedAccountId))
      .map(({ row }) => ({ accountId: row.accountId, sendCount: row.recipients.length }));
    return {
      count: perAccount.reduce((sum, row) => sum + row.sendCount, 0),
      perAccount,
    };
  }

  const accountId = broadcastAccountId(broadcast, requestedAccountId);

  if (broadcast.target_type === 'tag') {
    if (!broadcast.target_tag_id) return { count: null };
    const sql = accountId
      ? `SELECT COUNT(*) AS count
           FROM friends f
           JOIN friend_tags ft ON ft.friend_id = f.id
          WHERE ft.tag_id = ? AND f.is_following = 1 AND f.line_account_id = ?`
      : `SELECT COUNT(*) AS count
           FROM friends f
           JOIN friend_tags ft ON ft.friend_id = f.id
          WHERE ft.tag_id = ? AND f.is_following = 1`;
    const row = accountId
      ? await db.prepare(sql).bind(broadcast.target_tag_id, accountId).first<{ count: number }>()
      : await db.prepare(sql).bind(broadcast.target_tag_id).first<{ count: number }>();
    return { count: Number(row?.count ?? 0) };
  }

  if (broadcast.target_type === 'segment') {
    if (typeof broadcast.segment_conditions !== 'string' || !broadcast.segment_conditions.trim()) {
      return { count: null };
    }
    try {
      const conditions = JSON.parse(broadcast.segment_conditions) as { rules?: unknown };
      if (!Array.isArray(conditions.rules)) return { count: null };
      const { sql, bindings } = buildSegmentQuery(
        conditions as Parameters<typeof buildSegmentQuery>[0],
      );
      const scopedSql = accountId
        ? sql.replace('WHERE', 'WHERE f.line_account_id = ? AND')
        : sql;
      const scopedBindings = accountId ? [accountId, ...bindings] : bindings;
      const row = await db.prepare(`SELECT COUNT(*) AS count FROM (${scopedSql}) q`)
        .bind(...scopedBindings).first<{ count: number }>();
      return { count: Number(row?.count ?? 0) };
    } catch {
      return { count: null };
    }
  }

  if (broadcast.target_type === 'all') {
    const sql = accountId
      ? 'SELECT COUNT(*) AS count FROM friends WHERE is_following = 1 AND line_account_id = ?'
      : 'SELECT COUNT(*) AS count FROM friends WHERE is_following = 1';
    const row = accountId
      ? await db.prepare(sql).bind(accountId).first<{ count: number }>()
      : await db.prepare(sql).first<{ count: number }>();
    return { count: Number(row?.count ?? 0) };
  }

  return { count: null };
}
