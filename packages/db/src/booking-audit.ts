/**
 * 予約の変更履歴（booking_audit_logs）。
 *
 * いつ・誰が・何を変えたかを追記型で残す。ここには読み書きだけを置き、
 * 更新・削除の口は作らない（監査記録を後から直せないようにする）。
 */

import { jstNow } from './utils.js';

export type BookingAuditActorType = 'customer' | 'staff' | 'system';

export interface BookingAuditLogRow {
  id: string;
  booking_id: string;
  line_account_id: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  actor_type: BookingAuditActorType;
  actor_id: string | null;
  actor_name: string | null;
  occurred_at: string;
  request_id: string | null;
  created_at: string;
}

export interface BookingAuditLog {
  id: string;
  bookingId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  actorType: BookingAuditActorType;
  actorId: string | null;
  actorName: string | null;
  occurredAt: string;
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function toAuditLog(row: BookingAuditLogRow): BookingAuditLog {
  return {
    id: row.id,
    bookingId: row.booking_id,
    action: row.action,
    before: parseJsonObject(row.before_json),
    after: parseJsonObject(row.after_json),
    reason: row.reason,
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorName: row.actor_name,
    occurredAt: row.occurred_at,
  };
}

/**
 * 監査行を1件追加する。呼び出し側の業務 UPDATE と同じ batch に入れられるよう
 * D1PreparedStatement を返す。直接実行したいときは run() するだけでよい。
 */
export function bookingAuditInsert(
  db: D1Database,
  input: {
    bookingId: string;
    lineAccountId: string;
    action: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    reason?: string | null;
    actorType: BookingAuditActorType;
    actorId?: string | null;
    actorName?: string | null;
    occurredAt: string;          // UTC ISO8601
    requestId?: string | null;
  },
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO booking_audit_logs
      (id, booking_id, line_account_id, action, before_json, after_json,
       reason, actor_type, actor_id, actor_name, occurred_at, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.bookingId,
    input.lineAccountId,
    input.action,
    input.before ? JSON.stringify(input.before) : null,
    input.after ? JSON.stringify(input.after) : null,
    input.reason ?? null,
    input.actorType,
    input.actorId ?? null,
    input.actorName ?? null,
    input.occurredAt,
    input.requestId ?? null,
    jstNow(),
  );
}

export async function recordBookingAudit(
  db: D1Database,
  input: Parameters<typeof bookingAuditInsert>[1],
): Promise<void> {
  await bookingAuditInsert(db, input).run();
}

export async function listBookingAuditLogs(
  db: D1Database,
  input: { bookingId: string; lineAccountId: string; limit?: number },
): Promise<BookingAuditLog[]> {
  const rows = await db.prepare(
    `SELECT id, booking_id, line_account_id, action, before_json, after_json,
            reason, actor_type, actor_id, actor_name, occurred_at, request_id, created_at
       FROM booking_audit_logs
      WHERE booking_id = ? AND line_account_id = ?
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?`,
  ).bind(input.bookingId, input.lineAccountId, Math.min(200, Math.max(1, input.limit ?? 50)))
    .all<BookingAuditLogRow>();
  return (rows.results ?? []).map(toAuditLog);
}
