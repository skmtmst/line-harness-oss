// Idempotency-Key store for booking request POSTs.
// Returns same response for repeated submissions within the TTL window.

export interface SaveIdempotencyParams {
  key: string;
  lineAccountId: string;
  friendId: string;
  status: number;
  body: unknown;
  ttlMinutes: number;
  now: Date;
}

export async function saveIdempotencyResponse(
  db: D1Database,
  params: SaveIdempotencyParams,
): Promise<void> {
  const expires = new Date(params.now.getTime() + params.ttlMinutes * 60_000).toISOString();
  await db
    .prepare(
      `INSERT INTO booking_idempotency_keys
         (key, line_account_id, friend_id, response_status, response_body, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO NOTHING`,
    )
    .bind(
      params.key,
      params.lineAccountId,
      params.friendId,
      params.status,
      JSON.stringify(params.body),
      expires,
    )
    .run();
}

export interface FindIdempotencyParams {
  key: string;
  lineAccountId: string;
  friendId: string;
  now: Date;
}

export interface ReserveIdempotencyParams {
  key: string;
  lineAccountId: string;
  friendId: string;
  body: unknown;
  ttlMinutes: number;
  now: Date;
}

/**
 * 副作用を始める前にキーを確保する。
 *
 * 完了後だけ保存する方式では、同時に届いた2リクエストがどちらも未保存と判断し、
 * 定員2以上の枠へ同じ予約を2件作れてしまう。先に202の仮応答を1行だけ入れ、
 * INSERTできた呼び出しだけが予約作成へ進む。
 */
export async function reserveIdempotencyResponse(
  db: D1Database,
  params: ReserveIdempotencyParams,
): Promise<boolean> {
  const expires = new Date(params.now.getTime() + params.ttlMinutes * 60_000).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO booking_idempotency_keys
         (key, line_account_id, friend_id, response_status, response_body, expires_at)
       VALUES (?, ?, ?, 202, ?, ?)
       ON CONFLICT(key) DO NOTHING`,
    )
    .bind(
      params.key,
      params.lineAccountId,
      params.friendId,
      JSON.stringify(params.body),
      expires,
    )
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function completeIdempotencyResponse(
  db: D1Database,
  params: Omit<SaveIdempotencyParams, 'ttlMinutes' | 'now'>,
): Promise<void> {
  await db
    .prepare(
      `UPDATE booking_idempotency_keys
          SET response_status = ?, response_body = ?
        WHERE key = ? AND line_account_id = ? AND friend_id = ?`,
    )
    .bind(
      params.status,
      JSON.stringify(params.body),
      params.key,
      params.lineAccountId,
      params.friendId,
    )
    .run();
}

// caller(account+friend) と一致した行のみを返す。同じ key を別 caller が使った場合は
// nothing-cached 扱いとし、そちらは新規 INSERT で衝突 (PK重複) して別の handling 経路に流れる。
// global lookup にすると tenant 越しに booking_id が漏れるので必須。
export async function findIdempotencyResponse(
  db: D1Database,
  params: FindIdempotencyParams,
): Promise<{ status: number; body: unknown } | null> {
  const row = await db
    .prepare(
      `SELECT response_status, response_body, expires_at
         FROM booking_idempotency_keys
        WHERE key = ? AND line_account_id = ? AND friend_id = ?`,
    )
    .bind(params.key, params.lineAccountId, params.friendId)
    .first<{ response_status: number; response_body: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at) <= params.now) return null;
  return { status: row.response_status, body: JSON.parse(row.response_body) };
}

export async function purgeExpiredIdempotency(db: D1Database, now: Date): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM booking_idempotency_keys WHERE expires_at <= ?`)
    .bind(now.toISOString())
    .run();
  return result.meta?.changes ?? 0;
}
