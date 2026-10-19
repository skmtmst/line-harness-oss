import { normalizeEventQuestions } from '../event-input.js';
import type { EventQuestion } from '../event-input.js';
import { type Context } from 'hono';
import type { Env } from '../../worker-env.js';
import { getFolderById } from '@line-crm/db';
import { canAccessAllLineAccounts } from '../../services/account-access.js';

export const ACCOUNT_ACCESS_ERROR = 'このLINEアカウントを操作する権限がありません';

export function optionalExecutionCtx(c: Context<Env>): ExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

// 分類だけの変更も既存の版チェックに従う。folder_id は従来の読み取り名を残す。
export function withFolder(row: Record<string, unknown> | null) {
  return row ? { ...row, folderId: row.folder_id ?? null } : row;
}

export async function validEventFolder(c: Context<Env>, folderId: unknown, accountIds: string[]): Promise<boolean> {
  if (folderId === null) return true;
  if (typeof folderId !== 'string' || !folderId.trim()) return false;
  const folder = await getFolderById(c.env.DB, folderId);
  return !!folder && folder.kind === 'event' && (folder.account_id === null
    || (accountIds.includes(folder.account_id)
      && await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [folder.account_id])));
}

export function getAccountId(c: Context<Env>): string | null {
  return c.req.query('account_id') ?? null;
}

export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  // CSVを開いた表計算ソフトで式として実行させない。
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export const EVENT_PARTY_SIZE_MAX = 20;

export const EVENT_ANSWER_SNAPSHOT_MAX_BYTES = 16_384;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EventApplicantBroadcastDraft = {
  kind: 'event_occurrence_applicant_snapshot';
  snapshotId: string;
  occurrenceId: string;
  recipientIds: string[];
};

export function eventApplicantBroadcastDraft(value: string | null | undefined): EventApplicantBroadcastDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<EventApplicantBroadcastDraft>;
    if (parsed.kind !== 'event_occurrence_applicant_snapshot'
      || typeof parsed.snapshotId !== 'string'
      || typeof parsed.occurrenceId !== 'string'
      || !Array.isArray(parsed.recipientIds)
      || parsed.recipientIds.some((id) => typeof id !== 'string')) return null;
    return parsed as EventApplicantBroadcastDraft;
  } catch {
    return null;
  }
}

export type EventSnapshotSource = {
  name: string;
  image_url?: string | null;
  description?: string | null;
  venue_name?: string | null;
  venue_address?: string | null;
  venue_url?: string | null;
  cancel_deadline_hours_before?: number | null;
  confirmation_message_extra?: string | null;
  approval_deadline_hours?: number | null;
};

export type EventOccurrenceSnapshotSource = {
  starts_at: string;
  ends_at?: string | null;
};

export function eventDefinitionSnapshot(event: EventSnapshotSource): Record<string, unknown> {
  return {
    eventName: event.name,
    eventImageUrl: event.image_url ?? null,
    eventDescription: event.description ?? null,
    venueName: event.venue_name ?? null,
    venueAddress: event.venue_address ?? null,
    venueUrl: event.venue_url ?? null,
    cancelDeadlineHoursBefore: event.cancel_deadline_hours_before ?? null,
    confirmationMessageExtra: event.confirmation_message_extra ?? null,
    approvalDeadlineHours: event.approval_deadline_hours ?? 24,
  };
}

export function eventBookingSnapshot(
  event: EventSnapshotSource,
  slot: EventOccurrenceSnapshotSource,
): string {
  return JSON.stringify({
    ...eventDefinitionSnapshot(event),
    slotStartsAt: slot.starts_at,
    slotEndsAt: slot.ends_at ?? null,
  });
}

export function serializeAnswerSnapshot(value: unknown): { ok: true; json: string | null } | { ok: false } {
  if (value == null) return { ok: true, json: null };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false };
  try {
    const json = JSON.stringify(value);
    if (new TextEncoder().encode(json).byteLength > EVENT_ANSWER_SNAPSHOT_MAX_BYTES) {
      return { ok: false };
    }
    return { ok: true, json };
  } catch {
    return { ok: false };
  }
}

export function parseEventQuestions(json: unknown): EventQuestion[] {
  if (typeof json !== 'string' || !json) return [];
  try {
    const parsed = JSON.parse(json);
    const n = normalizeEventQuestions(parsed);
    return n.ok ? n.questions : [];
  } catch {
    return [];
  }
}

/**
 * 必須質問への回答が揃っているか。回答の形は「質問id → 文字列(単一選択)・
 * 文字列配列(複数選択)」。定義に無い質問idへの回答は保存だけして無視する
 * (公開中に質問を編集された場合のずれを許容するため)。
 */
export function validateEventAnswers(
  questions: EventQuestion[],
  answers: unknown,
): boolean {
  if (questions.length === 0) return true;
  if (answers == null) {
    return questions.every((q) => !q.required);
  }
  if (typeof answers !== 'object' || Array.isArray(answers)) return false;
  const map = answers as Record<string, unknown>;
  for (const q of questions) {
    const a = map[q.id];
    const empty = a == null
      || (typeof a === 'string' && a.trim() === '')
      || (Array.isArray(a) && a.length === 0);
    if (q.required && empty) return false;
    if (empty) continue;
    if (q.type === 'checkbox') {
      if (!Array.isArray(a) || !a.every((x) => typeof x === 'string')) return false;
    } else if (typeof a !== 'string') {
      return false;
    }
  }
  return true;
}

export async function resolveAccountIdFromLiff(c: Context<Env>): Promise<string | null> {
  const liffId = c.req.query('liffId');
  if (!liffId) return null;
  const acc = await c.env.DB
    .prepare(`SELECT id FROM line_accounts WHERE liff_id = ? AND is_active = 1`)
    .bind(liffId)
    .first<{ id: string }>();
  return acc?.id ?? null;
}

export interface EventInput {
  name?: string;
  venue_name?: string | null;
  venue_address?: string | null;
  venue_url?: string | null;
  image_url?: string | null;
  description?: string | null;
  description_centered?: number;
  max_bookings_per_friend?: number | null;
  requires_approval?: number;
  approval_deadline_hours?: number;
  cancel_deadline_hours_before?: number | null;
  reminder_day_before_enabled?: number;
  reminder_hours_before?: number | null;
  is_published?: number;
  sort_order?: number;
  confirmation_message_extra?: string | null;
  reminder_message_extra?: string | null;
}
