export const INBOX_STATUSES = ['unread', 'in_progress', 'on_hold', 'resolved'] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];
export type InboxEventType = 'assignment' | 'status' | 'note' | 'read' | 'send' | 'conflict' | 'unsend';

export function isInboxStatus(value: unknown): value is InboxStatus {
  return typeof value === 'string' && (INBOX_STATUSES as readonly string[]).includes(value);
}

export function inboxEventStatement(
  db: D1Database,
  input: {
    channel: 'line' | 'email';
    conversationId: string;
    eventType: InboxEventType;
    before: unknown;
    after: unknown;
    actorStaffId: string | null;
    reason?: string | null;
    correlationId: string;
    createdAt: string;
    guard?: { table: 'chats' | 'support_email_threads'; id: string; revision: number; updatedAt: string };
  },
): D1PreparedStatement {
  const guardSql = input.guard
    ? ` WHERE EXISTS (
        SELECT 1 FROM ${input.guard.table}
        WHERE id = ? AND revision = ? AND updated_at = ?
      )`
    : '';
  const bindings: unknown[] = [
    crypto.randomUUID(),
    input.channel,
    input.conversationId,
    input.eventType,
    input.before === undefined ? null : JSON.stringify(input.before),
    input.after === undefined ? null : JSON.stringify(input.after),
    input.actorStaffId,
    input.reason?.trim().slice(0, 500) || null,
    input.correlationId,
    input.createdAt,
  ];
  if (input.guard) bindings.push(input.guard.id, input.guard.revision, input.guard.updatedAt);
  return db.prepare(
    `INSERT INTO inbox_conversation_events
       (id, channel, conversation_id, event_type, before_json, after_json,
        actor_staff_id, reason, correlation_id, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${guardSql}`,
  ).bind(...bindings);
}

export function inboxNoteStatement(
  db: D1Database,
  input: {
    channel: 'line' | 'email';
    conversationId: string;
    body: string;
    actorStaffId: string | null;
    createdAt: string;
    guard?: { table: 'chats' | 'support_email_threads'; id: string; revision: number; updatedAt: string };
  },
): D1PreparedStatement {
  const guardSql = input.guard
    ? ` WHERE EXISTS (
        SELECT 1 FROM ${input.guard.table}
        WHERE id = ? AND revision = ? AND updated_at = ?
      )`
    : '';
  const bindings: unknown[] = [
    crypto.randomUUID(),
    input.channel,
    input.conversationId,
    input.body,
    input.actorStaffId,
    input.createdAt,
  ];
  if (input.guard) bindings.push(input.guard.id, input.guard.revision, input.guard.updatedAt);
  return db.prepare(
    `INSERT INTO inbox_notes
       (id, channel, conversation_id, body, created_by_staff_id, created_at)
     SELECT ?, ?, ?, ?, ?, ?${guardSql}`,
  ).bind(...bindings);
}

/** 同じ会話へ複数の担当者が同時返信するのを、外部送信の前に止める。 */
export async function acquireInboxReplyLease(
  db: D1Database,
  input: {
    channel: 'line' | 'email';
    conversationId: string;
    staffId: string;
    conversationRevision: number;
    now: string;
    expiresAt: string;
  },
): Promise<{ acquired: true } | { acquired: false; staffId: string; expiresAt: string }> {
  const result = await db.prepare(
    `INSERT INTO inbox_reply_leases
       (channel, conversation_id, staff_id, acquired_at, expires_at, conversation_revision)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel, conversation_id) DO UPDATE SET
       staff_id = excluded.staff_id,
       acquired_at = excluded.acquired_at,
       expires_at = excluded.expires_at,
       conversation_revision = excluded.conversation_revision
     WHERE inbox_reply_leases.expires_at <= excluded.acquired_at
        OR inbox_reply_leases.staff_id = excluded.staff_id`,
  ).bind(
    input.channel,
    input.conversationId,
    input.staffId,
    input.now,
    input.expiresAt,
    input.conversationRevision,
  ).run();
  if ((result.meta?.changes ?? 0) === 1) return { acquired: true };
  const current = await db.prepare(
    `SELECT staff_id, expires_at FROM inbox_reply_leases
     WHERE channel = ? AND conversation_id = ?`,
  ).bind(input.channel, input.conversationId).first<{ staff_id: string; expires_at: string }>();
  return {
    acquired: false,
    staffId: current?.staff_id ?? '',
    expiresAt: current?.expires_at ?? input.expiresAt,
  };
}

export async function releaseInboxReplyLease(
  db: D1Database,
  input: { channel: 'line' | 'email'; conversationId: string; staffId: string },
): Promise<void> {
  await db.prepare(
    `DELETE FROM inbox_reply_leases
     WHERE channel = ? AND conversation_id = ? AND staff_id = ?`,
  ).bind(input.channel, input.conversationId, input.staffId).run();
}
