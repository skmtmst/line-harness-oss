import { jstNow } from './utils.js';
import { type IncomingWebhookUnmatchedKind, type IncomingWebhookUnmatchedEventRow, type IncomingWebhookUnmatchedStatus } from './webhooks-types.js';


export async function recordIncomingWebhookUnmatched(
  db: D1Database,
  input: {
    webhookId: string;
    lineAccountId: string;
    sourceEventId: string;
    kind: IncomingWebhookUnmatchedKind;
    identityAttempts: Array<{ kind: string; path: string; value: string }>;
    maskedShape?: unknown;
    /** kind='ambiguous' のとき、一致した友だちIDの並び(人が選ぶ元)。 */
    candidateFriendIds?: string[];
    receivedAt?: string;
  },
): Promise<IncomingWebhookUnmatchedEventRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  /*
   * S: candidate_friend_ids_json は入れ替えた表(migration 489)にだけある。
   * 値を渡されたときだけ列名をSQLに含める。移行前の旧表でも unmatched /
   * candidate の記録は動き続ける。
   */
  const candidateColumn = input.candidateFriendIds === undefined
    ? ''
    : ', candidate_friend_ids_json';
  const candidateValue = input.candidateFriendIds === undefined ? '' : ', ?';
  const binds: unknown[] = [
    id,
    input.webhookId,
    input.lineAccountId,
    input.sourceEventId,
    input.kind,
    JSON.stringify(input.identityAttempts),
    input.maskedShape === undefined ? null : JSON.stringify(input.maskedShape),
  ];
  if (input.candidateFriendIds !== undefined) binds.push(JSON.stringify(input.candidateFriendIds));
  binds.push(input.receivedAt ?? now, now, now);
  await db.prepare(`INSERT OR IGNORE INTO incoming_webhook_unmatched_events
      (id, webhook_id, line_account_id, source_event_id, kind, status,
       identity_attempts_json, masked_shape_json${candidateColumn}, received_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?${candidateValue}, ?, ?, ?)`)
    .bind(...binds)
    .run();
  return (await db.prepare(`SELECT * FROM incoming_webhook_unmatched_events
      WHERE webhook_id = ? AND source_event_id = ?`)
    .bind(input.webhookId, input.sourceEventId)
    .first<IncomingWebhookUnmatchedEventRow>())!;
}

export async function listIncomingWebhookUnmatched(
  db: D1Database,
  webhookId: string,
  lineAccountId: string,
  status: IncomingWebhookUnmatchedStatus = 'pending',
  limit = 50,
  offset = 0,
): Promise<IncomingWebhookUnmatchedEventRow[]> {
  const result = await db.prepare(`SELECT * FROM incoming_webhook_unmatched_events
      WHERE webhook_id = ? AND line_account_id = ? AND status = ?
      ORDER BY received_at DESC LIMIT ? OFFSET ?`)
    .bind(webhookId, lineAccountId, status, Math.min(100, Math.max(1, limit)), Math.max(0, offset))
    .all<IncomingWebhookUnmatchedEventRow>();
  return result.results ?? [];
}

export async function countIncomingWebhookUnmatched(
  db: D1Database,
  webhookId: string,
  lineAccountId: string,
  status: IncomingWebhookUnmatchedStatus = 'pending',
): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM incoming_webhook_unmatched_events
      WHERE webhook_id = ? AND line_account_id = ? AND status = ?`)
    .bind(webhookId, lineAccountId, status)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getIncomingWebhookUnmatchedById(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<IncomingWebhookUnmatchedEventRow | null> {
  return db.prepare(`SELECT * FROM incoming_webhook_unmatched_events
      WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .first<IncomingWebhookUnmatchedEventRow>();
}

/**
 * 箱の中の届物を「処理済み」にする。
 * dismiss … 何もしないで閉じる / link … 指定の友だちに結び付けて閉じる。
 * 返り値は状態を動かせたか（pending の行だけが動く）。
 */
export async function resolveIncomingWebhookUnmatched(
  db: D1Database,
  id: string,
  lineAccountId: string,
  resolution: { action: 'dismiss' } | { action: 'link'; friendId: string },
  resolvedBy?: string,
): Promise<boolean> {
  const now = jstNow();
  const result = await db.prepare(`UPDATE incoming_webhook_unmatched_events
      SET status = ?, resolved_friend_id = ?, resolved_by = ?, resolved_at = ?, updated_at = ?
      WHERE id = ? AND line_account_id = ? AND status = 'pending'`)
    .bind(
      resolution.action === 'link' ? 'resolved' : 'dismissed',
      resolution.action === 'link' ? resolution.friendId : null,
      resolvedBy ?? null,
      now,
      now,
      id,
      lineAccountId,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}
