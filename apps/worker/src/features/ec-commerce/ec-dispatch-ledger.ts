import type { EcDispatchSubscriber } from './dispatch-types.js';


export async function getEcDispatchStatus(
  db: D1Database, eventId: string, subscriber: EcDispatchSubscriber,
): Promise<string | null> {
  const row = await db.prepare(
    `SELECT status FROM ec_v6_dispatches WHERE event_id = ? AND subscriber = ?`,
  ).bind(eventId, subscriber).first<{ status: string }>();
  return row?.status ?? null;
}


export async function markEcDispatch(
  db: D1Database,
  input: {
    eventId: string; subscriber: EcDispatchSubscriber; status: 'pending' | 'sent' | 'failed';
    error?: string | null; idempotencyKey: string; now: string;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO ec_v6_dispatches
       (event_id, subscriber, status, attempt_count, last_error, idempotency_key, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(event_id, subscriber) DO UPDATE SET
       status = excluded.status,
       attempt_count = ec_v6_dispatches.attempt_count + 1,
       last_error = excluded.last_error,
       idempotency_key = excluded.idempotency_key,
       updated_at = excluded.updated_at`,
  ).bind(
    input.eventId, input.subscriber, input.status,
    input.error ?? null, input.idempotencyKey, input.now,
  ).run();
}
