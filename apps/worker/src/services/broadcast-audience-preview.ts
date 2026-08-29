import { getLineAccountById, type Broadcast } from '@line-crm/db';
import { computeDedupBroadcastPreview } from './dedup-broadcast.js';
import { buildSegmentQuery } from './segment-query.js';

export type BroadcastAudiencePreview = {
  /** 条件を安全に読み取れない場合は0へ潰さずnull。 */
  count: number | null;
  perAccount?: Array<{ accountId: string; sendCount: number }>;
};

function parseJsonArray(value: unknown): string[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : null;
  } catch {
    return null;
  }
}

/**
 * 一斉配信の送信前確認と緊急停止確認で、同じ宛先計算を使う。
 *
 * `total_count` は送信後にしか確定しないため使わない。条件を解釈できない
 * ときは0人ではなくnullを返し、画面側が「未取得」と表示できるようにする。
 */
export async function getBroadcastAudiencePreview(
  db: D1Database,
  broadcast: Broadcast,
  scopeAccountId?: string | null,
): Promise<BroadcastAudiencePreview> {
  const raw = broadcast as unknown as Record<string, unknown>;

  if (broadcast.target_type === 'multi-account-dedup') {
    const accountIds = parseJsonArray(raw.account_ids) ?? [];
    const dedupPriority = parseJsonArray(raw.dedup_priority) ?? [];
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
      .filter(({ row, account }) => account?.is_active && (!scopeAccountId || row.accountId === scopeAccountId))
      .map(({ row }) => ({ accountId: row.accountId, sendCount: row.recipients.length }));
    return {
      count: perAccount.reduce((sum, row) => sum + row.sendCount, 0),
      perAccount,
    };
  }

  if (broadcast.target_type === 'tag' && broadcast.target_tag_id) {
    // 現在の送信処理もタグ対象をアカウントで絞っていない。確認件数だけを
    // 狭めると実送信数と食い違うため、同じ対象を数える。
    const row = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM friends f
         INNER JOIN friend_tags ft ON ft.friend_id = f.id
        WHERE ft.tag_id = ? AND f.is_following = 1`,
    ).bind(broadcast.target_tag_id).first<{ cnt: number }>();
    return { count: Number(row?.cnt ?? 0) };
  }

  if (broadcast.target_type === 'segment') {
    const rawConditions = raw.segment_conditions;
    if (typeof rawConditions !== 'string' || !rawConditions.trim()) return { count: null };
    try {
      const conditions = JSON.parse(rawConditions) as { rules?: unknown };
      if (!Array.isArray(conditions.rules)) return { count: null };
      const { sql, bindings } = buildSegmentQuery(conditions as Parameters<typeof buildSegmentQuery>[0]);
      const accountId = (raw.line_account_id as string | null | undefined) ?? null;
      const countSql = accountId
        ? `SELECT COUNT(*) AS cnt FROM (${sql.replace('WHERE', 'WHERE f.line_account_id = ? AND')}) q`
        : `SELECT COUNT(*) AS cnt FROM (${sql}) q`;
      const binds = accountId ? [accountId, ...bindings] : bindings;
      const row = await db.prepare(countSql).bind(...binds).first<{ cnt: number }>();
      return { count: Number(row?.cnt ?? 0) };
    } catch {
      return { count: null };
    }
  }

  if (broadcast.target_type === 'all') {
    const accountId = (raw.line_account_id as string | null | undefined) ?? null;
    const sql = accountId
      ? `SELECT COUNT(*) AS cnt FROM friends WHERE is_following = 1 AND line_account_id = ?`
      : `SELECT COUNT(*) AS cnt FROM friends WHERE is_following = 1`;
    const row = accountId
      ? await db.prepare(sql).bind(accountId).first<{ cnt: number }>()
      : await db.prepare(sql).first<{ cnt: number }>();
    return { count: Number(row?.cnt ?? 0) };
  }

  return { count: null };
}
