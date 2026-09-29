import type { EventOccurrenceApplicants } from './event-waitlist.js';

export const EVENT_APPLICANT_SNAPSHOT_TTL_MS = 15 * 60 * 1_000;

export type EventApplicantSnapshotPayload = Pick<EventOccurrenceApplicants, 'occurrence' | 'summary' | 'applicants'>;

export type EventApplicantSnapshot = {
  id: string;
  data: EventApplicantSnapshotPayload;
  expiresAt: string;
};

type StoredSnapshotRow = {
  id: string;
  payload_json: string;
  expires_at: string;
};

function isSnapshotPayload(value: unknown): value is EventApplicantSnapshotPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return !!record.occurrence && typeof record.occurrence === 'object'
    && !!record.summary && typeof record.summary === 'object'
    && Array.isArray(record.applicants);
}

export async function createEventApplicantSnapshot(
  db: D1Database,
  params: {
    lineAccountId: string;
    occurrenceId: string;
    staffId: string;
    data: EventApplicantSnapshotPayload;
    now?: Date;
  },
): Promise<EventApplicantSnapshot> {
  const now = params.now ?? new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + EVENT_APPLICANT_SNAPSHOT_TTL_MS).toISOString();
  const id = crypto.randomUUID();
  // 期限切れの閲覧用データを残し続けない。対象accountとは無関係な古い行だけを消す。
  await db.prepare('DELETE FROM event_occurrence_applicant_snapshots WHERE expires_at <= ?').bind(createdAt).run();
  await db.prepare(
    `INSERT INTO event_occurrence_applicant_snapshots
       (id, line_account_id, occurrence_id, staff_id, payload_json, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, params.lineAccountId, params.occurrenceId, params.staffId, JSON.stringify(params.data), expiresAt, createdAt).run();
  return { id, data: params.data, expiresAt };
}

export async function getEventApplicantSnapshot(
  db: D1Database,
  params: { id: string; lineAccountId: string; occurrenceId: string; staffId: string; now?: Date },
): Promise<{ kind: 'found'; snapshot: EventApplicantSnapshot } | { kind: 'not_found' } | { kind: 'expired' } | { kind: 'invalid' }> {
  const row = await db.prepare(
    `SELECT id, payload_json, expires_at
       FROM event_occurrence_applicant_snapshots
      WHERE id = ? AND line_account_id = ? AND occurrence_id = ? AND staff_id = ?`,
  ).bind(params.id, params.lineAccountId, params.occurrenceId, params.staffId).first<StoredSnapshotRow>();
  if (!row) return { kind: 'not_found' };
  if (row.expires_at <= (params.now ?? new Date()).toISOString()) return { kind: 'expired' };
  try {
    const data = JSON.parse(row.payload_json) as unknown;
    if (!isSnapshotPayload(data)) return { kind: 'invalid' };
    return { kind: 'found', snapshot: { id: row.id, data, expiresAt: row.expires_at } };
  } catch {
    return { kind: 'invalid' };
  }
}
