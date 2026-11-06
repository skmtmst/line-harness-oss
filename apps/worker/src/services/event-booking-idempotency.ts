// 同時の二重押下を防ぐため、要求開始時にキーを確保する。新規だけが進み、処理中は429、完了済みは保存応答を返す。成功・終端エラーのいずれも最後に実応答で確定する。

export interface SaveEventIdempotencyParams {
  key: string;
  lineAccountId: string;
  friendId: string;
  status: number;
  body: unknown;
  ttlMinutes: number;
  now: Date;
}

export async function saveEventIdempotencyResponse(
  db: D1Database,
  params: SaveEventIdempotencyParams,
): Promise<void> {
  const expires = new Date(params.now.getTime() + params.ttlMinutes * 60_000).toISOString();
  await db
    .prepare(
      `INSERT INTO event_booking_idempotency_keys
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

export interface FindEventIdempotencyParams {
  key: string;
  lineAccountId: string;
  friendId: string;
  now: Date;
}

// caller(account+friend) と一致した行のみ返す。tenant 越え露出を防ぐため必須。
export async function findEventIdempotencyResponse(
  db: D1Database,
  params: FindEventIdempotencyParams,
): Promise<{ status: number; body: unknown } | null> {
  const row = await db
    .prepare(
      `SELECT response_status, response_body, expires_at
         FROM event_booking_idempotency_keys
        WHERE key = ? AND line_account_id = ? AND friend_id = ?`,
    )
    .bind(params.key, params.lineAccountId, params.friendId)
    .first<{ response_status: number; response_body: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at) <= params.now) return null;
  return { status: row.response_status, body: JSON.parse(row.response_body) };
}

export type ReservationOutcome =
  | { kind: 'inserted' }
  | { kind: 'cached'; status: number; body: unknown }
  | { kind: 'in_progress' };

// status=0/body空は処理中の印とする。キー・アカウント・友だちの INSERT OR IGNORE で実行者を1人に絞り、後続は保存行の状態で分岐する。
export async function reserveEventIdempotency(
  db: D1Database,
  args: { key: string; lineAccountId: string; friendId: string; ttlMinutes: number; now: Date },
): Promise<ReservationOutcome> {
  const expires = new Date(args.now.getTime() + args.ttlMinutes * 60_000).toISOString();
  const ins = await db
    .prepare(
      `INSERT OR IGNORE INTO event_booking_idempotency_keys
         (key, line_account_id, friend_id, response_status, response_body, expires_at)
       VALUES (?, ?, ?, 0, '', ?)`,
    )
    .bind(args.key, args.lineAccountId, args.friendId, expires)
    .run();
  if ((ins.meta?.changes ?? 0) === 1) return { kind: 'inserted' };

  const row = await db
    .prepare(
      `SELECT response_status, response_body, expires_at
         FROM event_booking_idempotency_keys
        WHERE key = ? AND line_account_id = ? AND friend_id = ?`,
    )
    .bind(args.key, args.lineAccountId, args.friendId)
    .first<{ response_status: number; response_body: string; expires_at: string }>();
  if (!row || new Date(row.expires_at) <= args.now) return { kind: 'inserted' };
  if (row.response_status === 0) return { kind: 'in_progress' };
  return {
    kind: 'cached',
    status: row.response_status,
    body: row.response_body ? JSON.parse(row.response_body) : null,
  };
}

export async function finalizeEventIdempotencyResponse(
  db: D1Database,
  args: { key: string; lineAccountId: string; friendId: string; status: number; body: unknown },
): Promise<void> {
  await db
    .prepare(
      `UPDATE event_booking_idempotency_keys
          SET response_status = ?, response_body = ?
        WHERE key = ? AND line_account_id = ? AND friend_id = ?`,
    )
    .bind(args.status, JSON.stringify(args.body), args.key, args.lineAccountId, args.friendId)
    .run();
}

export async function purgeExpiredEventIdempotency(db: D1Database, now: Date): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM event_booking_idempotency_keys WHERE expires_at <= ?`)
    .bind(now.toISOString())
    .run();
  return result.meta?.changes ?? 0;
}
