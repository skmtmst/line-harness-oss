export type OperationIdempotencyAction = 'stop' | 'restore';

export type OperationIdempotencyReservation =
  | { kind: 'inserted' }
  | { kind: 'cached'; status: number; body: unknown }
  | { kind: 'in_progress' }
  | { kind: 'conflict' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidOperationIdempotencyKey(value: string | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

export async function hashOperationRequest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function reserveOperationIdempotency(
  db: D1Database,
  input: {
    key: string;
    action: OperationIdempotencyAction;
    actorId: string;
    scopeKey: string;
    requestHash: string;
    now: Date;
    ttlMinutes?: number;
  },
): Promise<OperationIdempotencyReservation> {
  const expiresAt = new Date(input.now.getTime() + (input.ttlMinutes ?? 24 * 60) * 60_000).toISOString();
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO operation_idempotency_keys
       (key, action, actor_id, scope_key, request_hash, response_status, response_body, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, '', ?, ?)`,
  ).bind(
    input.key, input.action, input.actorId, input.scopeKey, input.requestHash,
    expiresAt, input.now.toISOString(),
  ).run();
  if ((inserted.meta?.changes ?? 0) === 1) return { kind: 'inserted' };

  const row = await db.prepare(
    `SELECT action, actor_id, scope_key, request_hash, response_status, response_body, expires_at
       FROM operation_idempotency_keys WHERE key = ?`,
  ).bind(input.key).first<{
    action: string;
    actor_id: string;
    scope_key: string;
    request_hash: string;
    response_status: number;
    response_body: string;
    expires_at: string;
  }>();
  if (!row || Date.parse(row.expires_at) <= input.now.getTime()) return { kind: 'conflict' };
  if (
    row.action !== input.action
    || row.actor_id !== input.actorId
    || row.scope_key !== input.scopeKey
    || row.request_hash !== input.requestHash
  ) return { kind: 'conflict' };
  if (row.response_status === 0) return { kind: 'in_progress' };
  return {
    kind: 'cached',
    status: row.response_status,
    body: row.response_body ? JSON.parse(row.response_body) : null,
  };
}

export async function finalizeOperationIdempotency(
  db: D1Database,
  input: { key: string; status: number; body: unknown },
): Promise<void> {
  await db.prepare(
    `UPDATE operation_idempotency_keys
        SET response_status = ?, response_body = ?
      WHERE key = ? AND response_status = 0`,
  ).bind(input.status, JSON.stringify(input.body), input.key).run();
}

export async function purgeExpiredOperationIdempotency(db: D1Database, now: Date): Promise<number> {
  const result = await db.prepare(
    'DELETE FROM operation_idempotency_keys WHERE expires_at <= ?',
  ).bind(now.toISOString()).run();
  return result.meta?.changes ?? 0;
}
