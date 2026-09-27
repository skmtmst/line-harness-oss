// U: イベントの状態・変更確認・開催回変更の土台。
//
// v6-29 §10（開催変更・中止）・§11-2（イベント状態）と確定文書 U の決めごと。
// 状態を変える操作は「誰が・いつ・何を・理由」を event_change_logs に残す。
// 記録は消さない。取り消しは逆向きの記録を足す。
//
// D1 に複文トランザクションが無いため、適用は条件付き更新で直列化する
// （版の一致で更新し、0 件なら 409 で最新を取り直させる）。

import {
  cancelPendingRemindersFor,
  computeRemindersForBooking,
  insertRemindersForBooking,
} from './event-booking-reminders.js';
import { getEventOccurrenceUsedSeats } from './event-waitlist.js';
import {
  reconcileV6ToStartsAt,
  rescheduleByTrigger,
} from './reminder-trigger.js';

/** v6-29 §11-2 の保存する状態。「満席」「申込が少ない」は保存しない。 */
export type EventLifecycleStatus =
  | 'draft'
  | 'published'
  | 'paused'
  | 'ended'
  | 'cancelled';

const LIFECYCLE_VALUES: EventLifecycleStatus[] = [
  'draft',
  'published',
  'paused',
  'ended',
  'cancelled',
];

export function isLifecycleStatus(value: unknown): value is EventLifecycleStatus {
  return typeof value === 'string'
    && (LIFECYCLE_VALUES as string[]).includes(value);
}

/** 許す遷移だけを列挙する。ended / cancelled は終端（戻さない）。 */
const LIFECYCLE_TRANSITIONS: Record<EventLifecycleStatus, EventLifecycleStatus[]> = {
  draft: ['published', 'cancelled'],
  published: ['paused', 'ended', 'cancelled'],
  paused: ['published', 'ended', 'cancelled'],
  ended: [],
  cancelled: [],
};

export function canTransitionLifecycle(
  from: EventLifecycleStatus,
  to: EventLifecycleStatus,
): boolean {
  return LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** 一時停止と中止は理由が必須（運用者が後から「なぜ」を追えるようにする）。 */
export function lifecycleReasonRequired(to: EventLifecycleStatus): boolean {
  return to === 'paused' || to === 'cancelled';
}

/**
 * 旧来の is_published 列への両書き。published のときだけ 1。
 * 一時停止・終了・中止は客画面から消える（0）。下書きも 0。
 */
export function lifecycleToPublishedFlag(status: EventLifecycleStatus): number {
  return status === 'published' ? 1 : 0;
}

// ----------------------------------------------------------------
// 変更の記録
// ----------------------------------------------------------------

export type EventChangeAction =
  | 'lifecycle'
  | 'change_review_apply'
  | 'waitlist_promote'
  | 'waitlist_reorder'
  | 'waitlist_skip'
  | 'booking_change';

export interface EventChangeLogEntry {
  lineAccountId: string;
  eventId: string;
  slotId?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  action: EventChangeAction;
  reason?: string | null;
  beforeJson?: string | null;
  afterJson?: string | null;
  affectedConfirmed?: number;
  affectedWaiting?: number;
  affectedReminders?: number;
  notifyPlanned?: number;
  notifySent?: number;
  idempotencyKey?: string | null;
  nowIso?: string;
}

export async function writeEventChangeLog(
  db: D1Database,
  entry: EventChangeLogEntry,
): Promise<{ id: string; createdAt: string }> {
  const id = crypto.randomUUID();
  const createdAt = entry.nowIso ?? new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO event_change_logs
         (id, line_account_id, event_id, slot_id, actor_id, actor_role,
          action, reason, before_json, after_json,
          affected_confirmed, affected_waiting, affected_reminders,
          notify_planned, notify_sent, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      entry.lineAccountId,
      entry.eventId,
      entry.slotId ?? null,
      entry.actorId ?? null,
      entry.actorRole ?? null,
      entry.action,
      entry.reason ?? null,
      entry.beforeJson ?? null,
      entry.afterJson ?? null,
      entry.affectedConfirmed ?? 0,
      entry.affectedWaiting ?? 0,
      entry.affectedReminders ?? 0,
      entry.notifyPlanned ?? 0,
      entry.notifySent ?? 0,
      entry.idempotencyKey ?? null,
      createdAt,
    )
    .run();
  return { id, createdAt };
}

export async function findChangeLogByIdempotency(
  db: D1Database,
  lineAccountId: string,
  idempotencyKey: string,
): Promise<{ id: string; action: string } | null> {
  const row = await db
    .prepare(
      `SELECT id, action FROM event_change_logs
        WHERE line_account_id = ? AND idempotency_key = ?
        LIMIT 1`,
    )
    .bind(lineAccountId, idempotencyKey)
    .first<{ id: string; action: string }>();
  return row ?? null;
}

export async function markChangeLogNotified(
  db: D1Database,
  logId: string,
  sent: number,
): Promise<void> {
  await db
    .prepare(`UPDATE event_change_logs SET notify_sent = ? WHERE id = ?`)
    .bind(sent, logId)
    .run();
}

// ----------------------------------------------------------------
// 変更確認の事前表示（読み取り専用・書き込まない）
// ----------------------------------------------------------------

export interface SlotChangeInput {
  slot_id: string;
  starts_at?: string;
  ends_at?: string;
  capacity?: number | null;
  is_active?: number;
}

export interface EventChangeInput {
  venue_name?: string | null;
  venue_url?: string | null;
}

export interface SlotChangeImpact {
  slot_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  confirmed_seats: number;
  waiting_seats: number;
  pending_reminders: number;
  /** 適用を止める理由（定員割れ・前後逆転など）。空なら適用できる。 */
  errors: string[];
  /** 適用はできるが運用者に知らせること（日時移動・定員減など）。 */
  notices: string[];
}

export interface EventChangePreview {
  event_id: string;
  impacts: SlotChangeImpact[];
  event_notices: string[];
  /** どれか1件でも errors があれば true。適用口は 409 で止める。 */
  blocked: boolean;
  total_confirmed: number;
  total_waiting: number;
  total_pending_reminders: number;
}

interface SlotRow {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
}

async function countPendingReminders(db: D1Database, slotId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM event_booking_reminders
        WHERE booking_id IN (
          SELECT id FROM event_bookings
           WHERE slot_id = ? AND status = 'confirmed'
        ) AND sent_at IS NULL AND status = 'pending'`,
    )
    .bind(slotId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function countSeats(
  db: D1Database,
  slotId: string,
): Promise<{ confirmed: number; waiting: number }> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE((SELECT SUM(party_size) FROM event_bookings
                    WHERE slot_id = ? AND status IN ('requested', 'confirmed')), 0) AS confirmed,
         COALESCE((SELECT SUM(party_size) FROM event_waitlist
                    WHERE slot_id = ? AND status IN ('waiting', 'offered', 'accepted')), 0) AS waiting`,
    )
    .bind(slotId, slotId)
    .first<{ confirmed: number; waiting: number }>();
  return { confirmed: row?.confirmed ?? 0, waiting: row?.waiting ?? 0 };
}

export async function previewEventChange(
  db: D1Database,
  params: {
    eventId: string;
    lineAccountId: string;
    slotChanges: SlotChangeInput[];
    eventChanges?: EventChangeInput;
  },
): Promise<EventChangePreview | { kind: 'not_found' }> {
  const event = await db
    .prepare(
      `SELECT id FROM events
        WHERE id = ? AND deleted_at IS NULL AND (
          (target_type = 'single' AND line_account_id = ?)
          OR (target_type = 'multi-account-dedup'
              AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
        )`,
    )
    .bind(params.eventId, params.lineAccountId, params.lineAccountId)
    .first<{ id: string }>();
  if (!event) return { kind: 'not_found' };

  const impacts: SlotChangeImpact[] = [];
  for (const change of params.slotChanges) {
    const slot = await db
      .prepare(
        `SELECT id, starts_at, ends_at, capacity, is_active FROM event_slots
          WHERE id = ? AND event_id = ? AND deleted_at IS NULL`,
      )
      .bind(change.slot_id, params.eventId)
      .first<SlotRow>();
    if (!slot) {
      impacts.push({
        slot_id: change.slot_id,
        starts_at: '',
        ends_at: '',
        capacity: null,
        confirmed_seats: 0,
        waiting_seats: 0,
        pending_reminders: 0,
        errors: ['slot_not_found'],
        notices: [],
      });
      continue;
    }
    const seats = await countSeats(db, slot.id);
    const pendingReminders = await countPendingReminders(db, slot.id);
    const errors: string[] = [];
    const notices: string[] = [];
    const nextCapacity = change.capacity === undefined ? slot.capacity : change.capacity;
    if (nextCapacity != null) {
      const used = await getEventOccurrenceUsedSeats(db, slot.id);
      if (nextCapacity < used) errors.push('slot_capacity_below_bookings');
      else if (slot.capacity != null && nextCapacity < slot.capacity
        && seats.confirmed + seats.waiting > 0) {
        notices.push('capacity_reduced');
      }
    }
    const nextStarts = change.starts_at ?? slot.starts_at;
    const nextEnds = change.ends_at ?? slot.ends_at;
    if (Number.isNaN(Date.parse(nextStarts)) || Number.isNaN(Date.parse(nextEnds))) {
      errors.push('invalid_datetime');
    } else if (Date.parse(nextStarts) >= Date.parse(nextEnds)) {
      errors.push('invalid_range');
    } else if (nextStarts !== slot.starts_at && seats.confirmed > 0) {
      notices.push('datetime_moved_with_bookings');
    }
    if (change.is_active === 0 && (seats.confirmed > 0 || seats.waiting > 0)) {
      notices.push('slot_deactivated_with_applicants');
    }
    impacts.push({
      slot_id: slot.id,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      capacity: slot.capacity,
      confirmed_seats: seats.confirmed,
      waiting_seats: seats.waiting,
      pending_reminders: pendingReminders,
      errors,
      notices,
    });
  }

  const eventNotices: string[] = [];
  if (params.eventChanges
    && (params.eventChanges.venue_name !== undefined
      || params.eventChanges.venue_url !== undefined)) {
    const hasApplicants = impacts.some((i) => i.confirmed_seats > 0 || i.waiting_seats > 0);
    if (hasApplicants) eventNotices.push('venue_changed_with_applicants');
  }
  const blocked = impacts.some((i) => i.errors.length > 0);
  return {
    event_id: params.eventId,
    impacts,
    event_notices: eventNotices,
    blocked,
    total_confirmed: impacts.reduce((n, i) => n + i.confirmed_seats, 0),
    total_waiting: impacts.reduce((n, i) => n + i.waiting_seats, 0),
    total_pending_reminders: impacts.reduce((n, i) => n + i.pending_reminders, 0),
  };
}

// ----------------------------------------------------------------
// 変更確認の適用（条件付き更新・記録つき）
// ----------------------------------------------------------------

export type ApplyEventChangeResult =
  | {
    kind: 'applied';
    version: number;
    logId: string;
    affectedConfirmed: number;
    affectedWaiting: number;
    /** LINE 通知の送り先（route 側が best-effort で送る）。 */
    notifyTargets: Array<{
      bookingId: string;
      friendId: string;
      lineUserId: string;
      slotId: string;
    }>;
    changeSummary: string;
  }
  | { kind: 'not_found' }
  | { kind: 'conflict' }
  | { kind: 'invalid'; error: string }
  | { kind: 'duplicate'; logId: string };

async function rebuildSlotReminders(
  db: D1Database,
  slotId: string,
  startsAt: string,
): Promise<number> {
  const event = await db
    .prepare(
      `SELECT reminder_day_before_enabled, reminder_hours_before
         FROM events WHERE id = (SELECT event_id FROM event_slots WHERE id = ?)`,
    )
    .bind(slotId)
    .first<{ reminder_day_before_enabled: number; reminder_hours_before: number | null }>();
  if (!event) return 0;
  const rows = await db
    .prepare(`SELECT id FROM event_bookings WHERE slot_id = ? AND status = 'confirmed'`)
    .bind(slotId)
    .all<{ id: string }>();
  let count = 0;
  for (const row of rows.results ?? []) {
    await cancelPendingRemindersFor(db, row.id);
    const reminders = computeRemindersForBooking({
      starts_at_utc: startsAt,
      reminder_day_before_enabled: event.reminder_day_before_enabled === 1,
      reminder_hours_before: event.reminder_hours_before,
    });
    await insertRemindersForBooking(db, row.id, reminders);
    count += reminders.length;
  }
  return count;
}

export async function applyEventChange(
  db: D1Database,
  params: {
    eventId: string;
    lineAccountId: string;
    actorId?: string | null;
    actorRole?: string | null;
    expectedVersion: number;
    /** 公開後の変更は理由が必須（版と一緒に残す）。 */
    changeReason?: string | null;
    idempotencyKey: string;
    slotChanges: SlotChangeInput[];
    eventChanges?: EventChangeInput;
    now?: Date;
  },
): Promise<ApplyEventChangeResult> {
  const nowIso = (params.now ?? new Date()).toISOString();
  const existing = await findChangeLogByIdempotency(
    db,
    params.lineAccountId,
    params.idempotencyKey,
  );
  if (existing) return { kind: 'duplicate', logId: existing.id };

  const event = await db
    .prepare(`SELECT * FROM events WHERE id = ? AND deleted_at IS NULL`)
    .bind(params.eventId)
    .first<Record<string, unknown>>();
  if (!event) return { kind: 'not_found' };
  const scoped = (event.target_type === 'single' && event.line_account_id === params.lineAccountId)
    || (event.target_type === 'multi-account-dedup'
      && (() => {
        try {
          return (JSON.parse((event.account_ids as string) ?? '[]') as string[])
            .includes(params.lineAccountId);
        } catch {
          return false;
        }
      })());
  if (!scoped) return { kind: 'not_found' };
  if (event.version !== params.expectedVersion) return { kind: 'conflict' };

  const isPublished = Number(event.is_published) === 1;
  const reason = (params.changeReason ?? '').trim();
  if (isPublished && reason.length === 0) {
    return { kind: 'invalid', error: 'change_reason_required' };
  }
  if (params.slotChanges.length === 0
    && (!params.eventChanges
      || (params.eventChanges.venue_name === undefined
        && params.eventChanges.venue_url === undefined))) {
    return { kind: 'invalid', error: 'no_changes' };
  }

  // 事前表示と同じ検査を適用側でも行う（画面と裏側で判定を分けない）。
  const preview = await previewEventChange(db, {
    eventId: params.eventId,
    lineAccountId: params.lineAccountId,
    slotChanges: params.slotChanges,
    eventChanges: params.eventChanges,
  });
  if ('kind' in preview) return { kind: 'not_found' };
  if (preview.blocked) {
    const firstError = preview.impacts.flatMap((i) => i.errors)[0] ?? 'invalid_changes';
    return { kind: 'invalid', error: firstError };
  }

  const beforeJson = JSON.stringify({
    venue_name: event.venue_name,
    venue_url: event.venue_url,
    slots: preview.impacts.map((i) => ({
      slot_id: i.slot_id,
      starts_at: i.starts_at,
      ends_at: i.ends_at,
      capacity: i.capacity,
    })),
  });

  let affectedReminders = 0;
  const movedSlots: Array<{ slotId: string; oldStartsAt: string; newStartsAt: string }> = [];
  for (const change of params.slotChanges) {
    const slot = await db
      .prepare(`SELECT * FROM event_slots WHERE id = ? AND event_id = ? AND deleted_at IS NULL`)
      .bind(change.slot_id, params.eventId)
      .first<Record<string, unknown>>();
    if (!slot) return { kind: 'invalid', error: 'slot_not_found' };
    const nextStarts = (change.starts_at ?? slot.starts_at) as string;
    const nextEnds = (change.ends_at ?? slot.ends_at) as string;
    // 日時が動く回は、V6 の未送信予定を旧起点へ戻してから新起点へ移す
    // （枠更新より前。失敗時は枠 untouched のまま 500 にし、再送で回復する）。
    if (nextStarts !== slot.starts_at) {
      const confirmed = await db
        .prepare(`SELECT id, friend_id, line_account_id FROM event_bookings
                   WHERE slot_id = ? AND status = 'confirmed'`)
        .bind(change.slot_id)
        .all<{ id: string; friend_id: string; line_account_id: string }>();
      for (const bookingRow of confirmed.results ?? []) {
        const base = {
          triggerType: 'event' as const,
          sourceId: bookingRow.id,
          sourceEventId: bookingRow.id,
          friendId: bookingRow.friend_id,
          lineAccountId: bookingRow.line_account_id,
        };
        await reconcileV6ToStartsAt(db, { ...base, startsAtIso: slot.starts_at as string });
        await rescheduleByTrigger(db, {
          ...base,
          oldStartsAtIso: slot.starts_at as string,
          newStartsAtIso: nextStarts,
        });
        await reconcileV6ToStartsAt(db, { ...base, startsAtIso: nextStarts });
      }
      movedSlots.push({
        slotId: change.slot_id,
        oldStartsAt: slot.starts_at as string,
        newStartsAt: nextStarts,
      });
    }
    const sets: string[] = [];
    const values: unknown[] = [];
    if (change.starts_at !== undefined) { sets.push('starts_at = ?'); values.push(change.starts_at); }
    if (change.ends_at !== undefined) { sets.push('ends_at = ?'); values.push(change.ends_at); }
    if (change.capacity !== undefined) { sets.push('capacity = ?'); values.push(change.capacity); }
    if (change.is_active !== undefined) { sets.push('is_active = ?'); values.push(change.is_active); }
    if (sets.length > 0) {
      sets.push(`updated_at = ?`);
      values.push(nowIso, change.slot_id);
      await db
        .prepare(`UPDATE event_slots SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...values)
        .run();
    }
    if (nextStarts !== slot.starts_at || nextEnds !== (slot.ends_at as string)) {
      affectedReminders += await rebuildSlotReminders(db, change.slot_id, nextStarts);
    }
  }

  // イベント本体の会場だけをここで変える（名前・条件は編集画面の PUT の役目）。
  const eventSets: string[] = [];
  const eventValues: unknown[] = [];
  if (params.eventChanges?.venue_name !== undefined) {
    eventSets.push('venue_name = ?');
    eventValues.push(params.eventChanges.venue_name);
  }
  if (params.eventChanges?.venue_url !== undefined) {
    eventSets.push('venue_url = ?');
    eventValues.push(params.eventChanges.venue_url);
  }
  const nextVersion = (event.version as number) + 1;
  eventSets.push('version = version + 1');
  eventSets.push(`updated_at = ?`);
  eventValues.push(nowIso, params.eventId, event.version);
  const updated = await db
    .prepare(`UPDATE events SET ${eventSets.join(', ')} WHERE id = ? AND version = ?`)
    .bind(...eventValues)
    .run();
  if ((updated.meta?.changes ?? 0) === 0) return { kind: 'conflict' };

  const afterJson = JSON.stringify({
    venue_name: params.eventChanges?.venue_name ?? event.venue_name,
    venue_url: params.eventChanges?.venue_url ?? event.venue_url,
    slots: params.slotChanges.map((c) => ({
      slot_id: c.slot_id,
      starts_at: c.starts_at,
      ends_at: c.ends_at,
      capacity: c.capacity,
      is_active: c.is_active,
    })),
  });

  // 通知の送り先は日時が動いた回の確定申込。会場が動いたときは
  // 全部の回の確定申込（会場は回をまたいで同じなため）。
  const changedSlotIds = new Set(params.slotChanges.map((c) => c.slot_id));
  const venueTouched = params.eventChanges?.venue_name !== undefined
    || params.eventChanges?.venue_url !== undefined;
  let notifyTargets: Array<{
    bookingId: string;
    friendId: string;
    lineUserId: string;
    slotId: string;
  }> = [];
  if (changedSlotIds.size > 0 || venueTouched) {
    const placeholders = [...changedSlotIds].map(() => '?').join(',');
    const targetRows = venueTouched
      ? await db
        .prepare(
          `SELECT b.id AS booking_id, b.friend_id, b.slot_id, f.line_user_id
             FROM event_bookings b
             JOIN friends f ON f.id = b.friend_id
            WHERE b.event_id = ? AND b.status = 'confirmed'`,
        )
        .bind(params.eventId)
        .all<{ booking_id: string; friend_id: string; slot_id: string; line_user_id: string }>()
      : await db
        .prepare(
          `SELECT b.id AS booking_id, b.friend_id, b.slot_id, f.line_user_id
             FROM event_bookings b
             JOIN friends f ON f.id = b.friend_id
            WHERE b.event_id = ? AND b.status = 'confirmed'
              AND b.slot_id IN (${placeholders})`,
        )
        .bind(params.eventId, ...changedSlotIds)
        .all<{ booking_id: string; friend_id: string; slot_id: string; line_user_id: string }>();
    notifyTargets = (targetRows.results ?? [])
      .filter((r) => r.line_user_id)
      .map((r) => ({
        bookingId: r.booking_id,
        friendId: r.friend_id,
        lineUserId: r.line_user_id,
        slotId: r.slot_id,
      }));
  }

  const summaryParts: string[] = [];
  for (const moved of movedSlots) {
    summaryParts.push(`${moved.oldStartsAt} → ${moved.newStartsAt}`);
  }
  if (venueTouched && params.eventChanges?.venue_name !== undefined
    && params.eventChanges.venue_name !== event.venue_name) {
    summaryParts.push(`会場: ${String(event.venue_name ?? '未設定')} → ${String(params.eventChanges.venue_name ?? '未設定')}`);
  }
  const changeSummary = summaryParts.join(' / ');

  const log = await writeEventChangeLog(db, {
    lineAccountId: params.lineAccountId,
    eventId: params.eventId,
    actorId: params.actorId ?? null,
    actorRole: params.actorRole ?? null,
    action: 'change_review_apply',
    reason: reason.length > 0 ? reason : null,
    beforeJson,
    afterJson,
    affectedConfirmed: preview.total_confirmed,
    affectedWaiting: preview.total_waiting,
    affectedReminders,
    notifyPlanned: notifyTargets.length,
    notifySent: 0,
    idempotencyKey: params.idempotencyKey,
    nowIso,
  });

  return {
    kind: 'applied',
    version: nextVersion,
    logId: log.id,
    affectedConfirmed: preview.total_confirmed,
    affectedWaiting: preview.total_waiting,
    notifyTargets,
    changeSummary,
  };
}
