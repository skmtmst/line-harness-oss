import { resolveLineCredential } from '@line-crm/db';
import { sendEventBookingNotification } from './event-booking-notifier.js';
import { featureJobCanRun } from './feature-enforcement.js';

const DEFAULT_OFFER_HOURS = 24;
const JOB_RETRY_MAX_MINUTES = 60;

export type EventWaitlistOfferSender = (offer: {
  waitlistId: string;
  lineAccountId: string;
  friendId: string;
  eventName: string;
  startsAt: string;
  venueName: string | null;
  venueUrl: string | null;
  token: string;
  expiresAt: string;
}) => Promise<void>;

interface OccurrenceRow {
  id: string;
  event_id: string;
  event_name: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  version: number;
  venue_name: string | null;
  venue_url: string | null;
}

interface WaitingRow {
  id: string;
  line_account_id: string;
  friend_id: string;
  party_size: number;
  version: number;
  created_at: string;
}

interface BookingApplicantRow {
  id: string;
  friend_id: string;
  status: string;
  party_size: number;
  answer_snapshot_json: string | null;
  first_participation: number | null;
  first_participation_attended_count: number | null;
  first_participation_checked_at: string | null;
  requested_at: string;
  display_name: string | null;
  picture_url: string | null;
}

interface WaitlistApplicantRow {
  id: string;
  friend_id: string;
  status: string;
  party_size: number;
  answer_snapshot_json: string | null;
  first_participation: number | null;
  first_participation_attended_count: number | null;
  first_participation_checked_at: string | null;
  created_at: string;
  display_name: string | null;
  picture_url: string | null;
}

export interface EventOccurrenceApplicants {
  occurrence: {
    id: string;
    eventId: string;
    startsAt: string;
    endsAt: string;
    capacity: number | null;
    activeSeats: number;
    version: number;
  };
  summary: {
    bookingCount: number;
    waitingCount: number;
    activeSeats: number;
  };
  applicants: Array<{
    source: 'booking' | 'waitlist';
    id: string;
    friendId: string;
    displayName: string | null;
    pictureUrl: string | null;
    status: string;
    partySize: number;
    appliedAt: string;
    answers: unknown | null;
    firstParticipation: {
      isFirst: boolean | null;
      attendedCount: number | null;
      checkedAt: string | null;
    };
  }>;
}

export type EventWaitlistPromotionResult =
  | { kind: 'not_found' }
  | { kind: 'conflict'; currentVersion: number }
  | {
      kind: 'noop';
      reason: 'no_waiting' | 'no_capacity' | 'offer_pending' | 'occurrence_started' | 'party_too_large' | 'applicant_ineligible';
      occurrenceVersion: number;
      promoted: null;
    }
  | {
      kind: 'promoted';
      occurrenceVersion: number;
      promoted: {
        waitlistId: string;
        friendId: string;
        partySize: number;
        status: 'offered';
        offeredAt: string;
        expiresAt: string;
      };
    };

export type EventWaitlistAcceptanceResult =
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'unavailable' }
  | {
      kind: 'accepted';
      newlyConverted: boolean;
      bookingId: string;
      lineAccountId: string;
      friendId: string;
      lineUserId: string;
      eventId: string;
      occurrenceId: string;
      eventName: string;
      startsAt: string;
      venueName: string | null;
      venueUrl: string | null;
      confirmationExtra: string | null;
      reminderDayBeforeEnabled: boolean;
      reminderHoursBefore: number | null;
    };

function parseSnapshot(value: string | null): unknown | null {
  if (value == null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function firstParticipation(
  flag: number | null,
  attendedCount: number | null,
  checkedAt: string | null,
): EventOccurrenceApplicants['applicants'][number]['firstParticipation'] {
  if (flag == null || checkedAt == null) {
    return { isFirst: null, attendedCount: null, checkedAt: null };
  }
  return {
    isFirst: flag === 1,
    attendedCount,
    checkedAt,
  };
}

async function loadOccurrence(
  db: D1Database,
  occurrenceId: string,
  lineAccountId: string,
): Promise<OccurrenceRow | null> {
  return db
    .prepare(
      `SELECT s.id, s.event_id, s.starts_at, s.ends_at, s.capacity, s.version,
              e.name AS event_name, e.venue_name, e.venue_url
         FROM event_slots s
         JOIN events e ON e.id = s.event_id
        WHERE s.id = ?
          AND s.deleted_at IS NULL
          AND e.deleted_at IS NULL
          AND (
            (e.target_type = 'single' AND e.line_account_id = ?)
            OR (e.target_type = 'multi-account-dedup'
                AND EXISTS (SELECT 1 FROM json_each(e.account_ids) WHERE value = ?))
          )`,
    )
    .bind(occurrenceId, lineAccountId, lineAccountId)
    .first<OccurrenceRow>();
}

export async function getEventOccurrenceUsedSeats(
  db: D1Database,
  occurrenceId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE((
           SELECT SUM(party_size) FROM event_bookings
            WHERE slot_id = ? AND status IN ('requested', 'confirmed')
         ), 0)
         + COALESCE((
           SELECT SUM(party_size) FROM event_waitlist
            WHERE slot_id = ? AND status IN ('offered', 'accepted')
         ), 0) AS seats`,
    )
    .bind(occurrenceId, occurrenceId)
    .first<{ seats: number }>();
  return row?.seats ?? 0;
}

export async function getEventOccurrenceApplicants(
  db: D1Database,
  params: { occurrenceId: string; lineAccountId: string },
): Promise<EventOccurrenceApplicants | null> {
  const occurrence = await loadOccurrence(db, params.occurrenceId, params.lineAccountId);
  if (!occurrence) return null;

  const [bookings, waitlist, activeSeats] = await Promise.all([
    db
      .prepare(
        `SELECT b.id, b.friend_id, b.status, b.party_size, b.answer_snapshot_json,
                b.first_participation, b.first_participation_attended_count,
                b.first_participation_checked_at, b.requested_at,
                f.display_name, f.picture_url
           FROM event_bookings b
           LEFT JOIN friends f ON f.id = b.friend_id
          WHERE b.slot_id = ?
          ORDER BY b.requested_at ASC, b.id ASC`,
      )
      .bind(params.occurrenceId)
      .all<BookingApplicantRow>(),
    db
      .prepare(
        `SELECT w.id, w.friend_id, w.status, w.party_size, w.answer_snapshot_json,
                w.first_participation, w.first_participation_attended_count,
                w.first_participation_checked_at, w.created_at,
                f.display_name, f.picture_url
           FROM event_waitlist w
           LEFT JOIN friends f ON f.id = w.friend_id
          WHERE w.slot_id = ?
          ORDER BY w.created_at ASC, w.id ASC`,
      )
      .bind(params.occurrenceId)
      .all<WaitlistApplicantRow>(),
    getEventOccurrenceUsedSeats(db, params.occurrenceId),
  ]);

  const bookingApplicants = (bookings.results ?? []).map((row) => ({
    source: 'booking' as const,
    id: row.id,
    friendId: row.friend_id,
    displayName: row.display_name ?? null,
    pictureUrl: row.picture_url ?? null,
    status: row.status,
    partySize: row.party_size,
    appliedAt: row.requested_at,
    answers: parseSnapshot(row.answer_snapshot_json),
    firstParticipation: firstParticipation(
      row.first_participation,
      row.first_participation_attended_count,
      row.first_participation_checked_at,
    ),
  }));
  const waitlistApplicants = (waitlist.results ?? []).map((row) => ({
    source: 'waitlist' as const,
    id: row.id,
    friendId: row.friend_id,
    displayName: row.display_name ?? null,
    pictureUrl: row.picture_url ?? null,
    status: row.status,
    partySize: row.party_size,
    appliedAt: row.created_at,
    answers: parseSnapshot(row.answer_snapshot_json),
    firstParticipation: firstParticipation(
      row.first_participation,
      row.first_participation_attended_count,
      row.first_participation_checked_at,
    ),
  }));
  const applicants = [...bookingApplicants, ...waitlistApplicants]
    .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt) || a.id.localeCompare(b.id));

  return {
    occurrence: {
      id: occurrence.id,
      eventId: occurrence.event_id,
      startsAt: occurrence.starts_at,
      endsAt: occurrence.ends_at,
      capacity: occurrence.capacity,
      activeSeats,
      version: occurrence.version,
    },
    summary: {
      bookingCount: bookingApplicants.length,
      waitingCount: waitlistApplicants.filter((row) => row.status === 'waiting').length,
      activeSeats,
    },
    applicants,
  };
}

export async function enqueueEventWaitlistPromotion(
  db: D1Database,
  params: {
    lineAccountId: string;
    eventId: string;
    occurrenceId: string;
    sourceKey: string;
    now?: Date;
  },
): Promise<boolean> {
  const now = (params.now ?? new Date()).toISOString();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO event_waitlist_promotion_jobs (
         id, line_account_id, event_id, slot_id, source_key,
         status, attempts, available_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      params.lineAccountId,
      params.eventId,
      params.occurrenceId,
      params.sourceKey,
      now,
      now,
      now,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface WaitlistOfferAcceptanceRow {
  id: string;
  line_account_id: string;
  friend_id: string;
  line_user_id: string;
  event_id: string;
  slot_id: string;
  status: string;
  offer_expires_at: string | null;
  event_name: string;
  starts_at: string;
  venue_name: string | null;
  venue_url: string | null;
  confirmation_message_extra: string | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
}

/**
 * 期限付きの繰上げ案内を、本人の明示承諾で確定予約へ変換する。
 * token は保存せずハッシュだけ照合し、同じURLの再送は同じ予約を返す。
 */
export async function acceptEventWaitlistOffer(
  db: D1Database,
  params: { token: string; callerLineUserId: string; now?: Date },
): Promise<EventWaitlistAcceptanceResult> {
  if (params.token.length < 32 || params.token.length > 256) return { kind: 'not_found' };
  const tokenHash = await sha256(params.token);
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const offer = await db
    .prepare(
      `SELECT w.id, w.line_account_id, w.friend_id, f.line_user_id,
              w.event_id, w.slot_id, w.status, w.offer_expires_at,
              e.name AS event_name, s.starts_at, e.venue_name, e.venue_url,
              e.confirmation_message_extra, e.reminder_day_before_enabled,
              e.reminder_hours_before
         FROM event_waitlist w
         JOIN friends f ON f.id = w.friend_id AND f.line_account_id = w.line_account_id
         JOIN events e ON e.id = w.event_id AND e.deleted_at IS NULL
         JOIN event_slots s ON s.id = w.slot_id AND s.deleted_at IS NULL
        WHERE w.offer_token_hash = ? AND f.line_user_id = ?
        LIMIT 1`,
    )
    .bind(tokenHash, params.callerLineUserId)
    .first<WaitlistOfferAcceptanceRow>();
  if (!offer) return { kind: 'not_found' };

  const bookingId = `event-waitlist:${offer.id}`;
  if (offer.status === 'offered' && (!offer.offer_expires_at || offer.offer_expires_at <= nowIso)) {
    const sourceKey = `waitlist:${offer.id}:offer-expired`;
    // 失効と次候補のjobを同じtransactionへ入れる。失効だけ成功すると、
    // 次の待ち人が永久に案内されないため、別々には確定しない。
    await db.batch([
      db.prepare(
        `UPDATE event_waitlist
            SET status = 'expired', version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'offered' AND offer_token_hash = ?
            AND (offer_expires_at IS NULL OR offer_expires_at <= ?)`,
      )
        .bind(nowIso, offer.id, tokenHash, nowIso),
      db.prepare(
        `INSERT OR IGNORE INTO event_waitlist_promotion_jobs (
           id, line_account_id, event_id, slot_id, source_key,
           status, attempts, available_at, created_at, updated_at
         )
         SELECT ?, line_account_id, event_id, slot_id, ?, 'pending', 0, ?, ?, ?
           FROM event_waitlist
          WHERE id = ? AND status = 'expired' AND offer_token_hash = ?`,
      ).bind(crypto.randomUUID(), sourceKey, nowIso, nowIso, nowIso, offer.id, tokenHash),
    ]);
    return { kind: 'expired' };
  }

  if (!['offered', 'accepted', 'converted'].includes(offer.status)) {
    return { kind: 'unavailable' };
  }

  const results = await db.batch([
    db.prepare(
      `UPDATE event_waitlist
          SET status = 'accepted', version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'offered' AND offer_token_hash = ?
          AND offer_expires_at > ?
          AND NOT EXISTS (
            SELECT 1 FROM event_bookings b
             WHERE b.event_id = event_waitlist.event_id
               AND b.slot_id = event_waitlist.slot_id
               AND b.identity_key = event_waitlist.identity_key
               AND b.status IN ('requested','confirmed')
          )
          AND EXISTS (
            SELECT 1 FROM event_slots slot
             WHERE slot.id = event_waitlist.slot_id
               AND (slot.capacity IS NULL OR (
                 COALESCE((SELECT SUM(b.party_size) FROM event_bookings b
                   WHERE b.slot_id = slot.id AND b.status IN ('requested','confirmed')), 0)
                 + COALESCE((SELECT SUM(w.party_size) FROM event_waitlist w
                   WHERE w.slot_id = slot.id AND w.status IN ('offered','accepted')), 0)
               ) <= slot.capacity)
          )
          AND EXISTS (
            SELECT 1 FROM events e WHERE e.id = event_waitlist.event_id
              AND (e.max_bookings_per_friend IS NULL OR (
                (SELECT COUNT(*) FROM event_bookings b
                  WHERE b.event_id = e.id AND b.identity_key = event_waitlist.identity_key
                    AND b.status IN ('requested','confirmed'))
                + (SELECT COUNT(*) FROM event_waitlist held
                    WHERE held.event_id = e.id AND held.identity_key = event_waitlist.identity_key
                      AND held.status IN ('offered','accepted'))
              ) <= e.max_bookings_per_friend)
          )`,
    ).bind(nowIso, offer.id, tokenHash, nowIso),
    db.prepare(
      `INSERT OR IGNORE INTO event_bookings (
         id, line_account_id, event_id, slot_id, friend_id, status, requested_at,
         identity_key, party_size, answer_snapshot_json, first_participation,
         first_participation_attended_count, first_participation_checked_at,
         created_at, updated_at
       )
       SELECT ?, w.line_account_id, w.event_id, w.slot_id, w.friend_id, 'confirmed', ?,
              w.identity_key, w.party_size, w.answer_snapshot_json, w.first_participation,
              w.first_participation_attended_count, w.first_participation_checked_at, ?, ?
         FROM event_waitlist w
         JOIN friends f ON f.id = w.friend_id AND f.line_account_id = w.line_account_id
         JOIN events e ON e.id = w.event_id AND e.deleted_at IS NULL
         JOIN event_slots slot ON slot.id = w.slot_id AND slot.deleted_at IS NULL
        WHERE w.id = ? AND w.status = 'accepted' AND w.offer_token_hash = ?
          AND f.line_user_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM event_bookings same_slot
             WHERE same_slot.event_id = w.event_id AND same_slot.slot_id = w.slot_id
               AND same_slot.identity_key = w.identity_key
               AND same_slot.status IN ('requested','confirmed')
          )
          AND (slot.capacity IS NULL OR (
            COALESCE((SELECT SUM(b.party_size) FROM event_bookings b
              WHERE b.slot_id = slot.id AND b.status IN ('requested','confirmed')), 0)
            + COALESCE((SELECT SUM(held.party_size) FROM event_waitlist held
              WHERE held.slot_id = slot.id AND held.id != w.id
                AND held.status IN ('offered','accepted')), 0)
            + w.party_size
          ) <= slot.capacity)
          AND (e.max_bookings_per_friend IS NULL OR (
            (SELECT COUNT(*) FROM event_bookings b
              WHERE b.event_id = e.id AND b.identity_key = w.identity_key
                AND b.status IN ('requested','confirmed'))
            + (SELECT COUNT(*) FROM event_waitlist held
                WHERE held.event_id = e.id AND held.identity_key = w.identity_key
                  AND held.id != w.id AND held.status IN ('offered','accepted'))
            + 1
          ) <= e.max_bookings_per_friend)`,
    ).bind(bookingId, nowIso, nowIso, nowIso, offer.id, tokenHash, params.callerLineUserId),
    db.prepare(
      `UPDATE event_waitlist
          SET status = 'converted', version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'accepted' AND offer_token_hash = ?
          AND EXISTS (SELECT 1 FROM event_bookings b WHERE b.id = ?)`,
    ).bind(nowIso, offer.id, tokenHash, bookingId),
  ]);

  const converted = await db
    .prepare(
      `SELECT 1 AS found FROM event_waitlist w
        JOIN event_bookings b ON b.id = ? AND b.event_id = w.event_id
          AND b.slot_id = w.slot_id AND b.friend_id = w.friend_id
       WHERE w.id = ? AND w.status = 'converted' AND w.offer_token_hash = ?`,
    )
    .bind(bookingId, offer.id, tokenHash)
    .first<{ found: number }>();
  if (!converted) return { kind: 'unavailable' };

  return {
    kind: 'accepted',
    newlyConverted: (results[2]?.meta?.changes ?? 0) > 0,
    bookingId,
    lineAccountId: offer.line_account_id,
    friendId: offer.friend_id,
    lineUserId: offer.line_user_id,
    eventId: offer.event_id,
    occurrenceId: offer.slot_id,
    eventName: offer.event_name,
    startsAt: offer.starts_at,
    venueName: offer.venue_name,
    venueUrl: offer.venue_url,
    confirmationExtra: offer.confirmation_message_extra,
    reminderDayBeforeEnabled: offer.reminder_day_before_enabled === 1,
    reminderHoursBefore: offer.reminder_hours_before,
  };
}

export async function promoteEventWaitlist(
  db: D1Database,
  params: {
    occurrenceId: string;
    lineAccountId: string;
    expectedVersion?: number;
    now?: Date;
    offerHours?: number;
    sender: EventWaitlistOfferSender;
  },
): Promise<EventWaitlistPromotionResult> {
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const occurrence = await loadOccurrence(db, params.occurrenceId, params.lineAccountId);
  if (!occurrence) return { kind: 'not_found' };
  if (params.expectedVersion != null && params.expectedVersion !== occurrence.version) {
    return { kind: 'conflict', currentVersion: occurrence.version };
  }
  if (new Date(occurrence.starts_at).getTime() <= now.getTime()) {
    return {
      kind: 'noop', reason: 'occurrence_started',
      occurrenceVersion: occurrence.version, promoted: null,
    };
  }

  // 期限切れの保留を履歴として残してから、次の待機者へ進む。
  let occurrenceVersion = occurrence.version;
  const dueOffer = await db
    .prepare(
      `SELECT id, version FROM event_waitlist
        WHERE slot_id = ? AND status = 'offered' AND offer_expires_at <= ?
        ORDER BY offer_expires_at ASC
        LIMIT 1`,
    )
    .bind(occurrence.id, nowIso)
    .first<{ id: string; version: number }>();
  if (dueOffer) {
    const versionUpdate = await db
      .prepare(
        `UPDATE event_slots SET version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?`,
      )
      .bind(nowIso, occurrence.id, occurrenceVersion)
      .run();
    if ((versionUpdate.meta?.changes ?? 0) === 0) {
      const latest = await loadOccurrence(db, occurrence.id, params.lineAccountId);
      return { kind: 'conflict', currentVersion: latest?.version ?? occurrenceVersion };
    }
    occurrenceVersion++;
    await db
      .prepare(
        `UPDATE event_waitlist
            SET status = 'expired', version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'offered' AND version = ?`,
      )
      .bind(nowIso, dueOffer.id, dueOffer.version)
      .run();
  }

  const pendingOffer = await db
    .prepare(
      `SELECT id FROM event_waitlist
        WHERE slot_id = ? AND status = 'offered' AND offer_expires_at > ?
        LIMIT 1`,
    )
    .bind(occurrence.id, nowIso)
    .first<{ id: string }>();
  if (pendingOffer) {
    return { kind: 'noop', reason: 'offer_pending', occurrenceVersion, promoted: null };
  }

  const waiting = await db
    .prepare(
      `SELECT id, line_account_id, friend_id, party_size, version, created_at
         FROM event_waitlist
        WHERE slot_id = ? AND status = 'waiting'
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
    )
    .bind(occurrence.id)
    .first<WaitingRow>();
  if (!waiting) {
    return { kind: 'noop', reason: 'no_waiting', occurrenceVersion, promoted: null };
  }

  if (occurrence.capacity == null) {
    return { kind: 'noop', reason: 'no_capacity', occurrenceVersion, promoted: null };
  }
  const activeSeats = await getEventOccurrenceUsedSeats(db, occurrence.id);
  const remaining = Math.max(0, occurrence.capacity - activeSeats);
  if (waiting.party_size > remaining) {
    return { kind: 'noop', reason: 'party_too_large', occurrenceVersion, promoted: null };
  }

  const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll('-', '')}`;
  const tokenHash = await sha256(token);
  const expiresAt = new Date(
    now.getTime() + (params.offerHours ?? DEFAULT_OFFER_HOURS) * 3600_000,
  ).toISOString();
  // 事前SELECTの空席は他の予約・繰上げで変わる。人数分の容量確認と
  // offered（期限付き席保留）への遷移を、同じSQLの中で確定する。
  // 案内なし判定も再検査し、古い読取結果で次の待ちを追い越さない。
  const claimed = await db
    .prepare(
      `UPDATE event_waitlist
          SET status = 'offered', offered_at = ?, offer_expires_at = ?,
              offer_token_hash = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'waiting' AND version = ?
          AND EXISTS (
            SELECT 1 FROM event_slots slot
             WHERE slot.id = event_waitlist.slot_id AND slot.capacity IS NOT NULL
               AND COALESCE((SELECT SUM(b.party_size) FROM event_bookings b
                     WHERE b.slot_id = slot.id AND b.status IN ('requested','confirmed')), 0)
                 + COALESCE((SELECT SUM(held.party_size) FROM event_waitlist held
                     WHERE held.slot_id = slot.id AND held.status IN ('offered','accepted')), 0)
                 + event_waitlist.party_size <= slot.capacity
          )
          AND NOT EXISTS (
            SELECT 1 FROM event_waitlist pending
             WHERE pending.slot_id = event_waitlist.slot_id
               AND pending.status = 'offered' AND pending.offer_expires_at > ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM event_bookings b
             WHERE b.event_id = event_waitlist.event_id
               AND b.slot_id = event_waitlist.slot_id
               AND b.identity_key = event_waitlist.identity_key
               AND b.status IN ('requested','confirmed')
          )
          AND EXISTS (
            SELECT 1 FROM events e WHERE e.id = event_waitlist.event_id
              AND (e.max_bookings_per_friend IS NULL OR (
                (SELECT COUNT(*) FROM event_bookings b
                  WHERE b.event_id = e.id AND b.identity_key = event_waitlist.identity_key
                    AND b.status IN ('requested','confirmed'))
                + (SELECT COUNT(*) FROM event_waitlist held
                    WHERE held.event_id = e.id AND held.identity_key = event_waitlist.identity_key
                      AND held.id != event_waitlist.id AND held.status IN ('offered','accepted'))
              ) < e.max_bookings_per_friend)
          )`,
    )
    .bind(nowIso, expiresAt, tokenHash, nowIso, waiting.id, waiting.version, nowIso)
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) {
    // 競合負けでは席も通知も確保しない。待ち順・版・申込内容を残す。
    // 以下の再読取は表示理由だけに使い、席の確保判断には使わない。
    const unchanged = await db
      .prepare(`SELECT id FROM event_waitlist WHERE id = ? AND status = 'waiting' AND version = ?`)
      .bind(waiting.id, waiting.version)
      .first<{ id: string }>();
    if (unchanged) {
      const pending = await db
        .prepare(`SELECT id FROM event_waitlist WHERE slot_id = ?
                    AND status = 'offered' AND offer_expires_at > ? LIMIT 1`)
        .bind(occurrence.id, nowIso)
        .first<{ id: string }>();
      if (pending) return { kind: 'noop', reason: 'offer_pending', occurrenceVersion, promoted: null };
      const latest = await loadOccurrence(db, occurrence.id, params.lineAccountId);
      if (latest?.capacity == null) {
        return { kind: 'noop', reason: 'no_capacity', occurrenceVersion, promoted: null };
      }
      if (waiting.party_size > latest.capacity - await getEventOccurrenceUsedSeats(db, occurrence.id)) {
        return { kind: 'noop', reason: 'party_too_large', occurrenceVersion, promoted: null };
      }
      return { kind: 'noop', reason: 'applicant_ineligible', occurrenceVersion, promoted: null };
    }
    const latest = await loadOccurrence(db, occurrence.id, params.lineAccountId);
    return { kind: 'conflict', currentVersion: latest?.version ?? occurrence.version };
  }

  const versionUpdate = await db
    .prepare(
      `UPDATE event_slots
          SET version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`,
    )
    .bind(nowIso, occurrence.id, occurrenceVersion)
    .run();
  if ((versionUpdate.meta?.changes ?? 0) === 0) {
    await db
      .prepare(
        `UPDATE event_waitlist
            SET status = 'waiting', offered_at = NULL, offer_expires_at = NULL,
                offer_token_hash = NULL, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'offered' AND offer_token_hash = ?`,
      )
      .bind(nowIso, waiting.id, tokenHash)
      .run();
    const latest = await loadOccurrence(db, occurrence.id, params.lineAccountId);
    return { kind: 'conflict', currentVersion: latest?.version ?? occurrenceVersion };
  }

  try {
    await params.sender({
      waitlistId: waiting.id,
      lineAccountId: waiting.line_account_id,
      friendId: waiting.friend_id,
      eventName: occurrence.event_name,
      startsAt: occurrence.starts_at,
      venueName: occurrence.venue_name,
      venueUrl: occurrence.venue_url,
      token,
      expiresAt,
    });
  } catch (error) {
    // LINEへ届かなかった保留は成立扱いにしない。待機へ戻してjobを再試行する。
    await db
      .prepare(
        `UPDATE event_waitlist
            SET status = 'waiting', offered_at = NULL, offer_expires_at = NULL,
                offer_token_hash = NULL, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'offered' AND offer_token_hash = ?`,
      )
      .bind(nowIso, waiting.id, tokenHash)
      .run();
    throw error;
  }

  await db
    .prepare(
      `UPDATE event_waitlist SET notified_at = ?, updated_at = ?
        WHERE id = ? AND status = 'offered' AND offer_token_hash = ?`,
    )
    .bind(nowIso, nowIso, waiting.id, tokenHash)
    .run();

  return {
    kind: 'promoted',
    occurrenceVersion: occurrenceVersion + 1,
    promoted: {
      waitlistId: waiting.id,
      friendId: waiting.friend_id,
      partySize: waiting.party_size,
      status: 'offered',
      offeredAt: nowIso,
      expiresAt,
    },
  };
}

interface PromotionJobRow {
  id: string;
  line_account_id: string;
  event_id: string;
  slot_id: string;
  attempts: number;
}

export async function processEventWaitlistPromotionJobs(
  db: D1Database,
  params: {
    now?: Date;
    limit?: number;
    sender: EventWaitlistOfferSender;
  },
): Promise<{ processed: number; promoted: number; retried: number }> {
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));

  // 途中でWorkerが落ちたjobも次回に戻す。
  const staleAt = new Date(now.getTime() - 10 * 60_000).toISOString();
  await db
    .prepare(
      `UPDATE event_waitlist_promotion_jobs
          SET status = 'retryable_failed', available_at = ?, updated_at = ?,
              last_error = 'processing_timeout'
        WHERE status = 'processing' AND updated_at < ?`,
    )
    .bind(nowIso, nowIso, staleAt)
    .run();

  const dueOffers = await db
    .prepare(
      `SELECT id, line_account_id, event_id, slot_id, version
         FROM event_waitlist
        WHERE status = 'offered' AND offer_expires_at <= ?
        ORDER BY offer_expires_at ASC
        LIMIT ?`,
    )
    .bind(nowIso, limit)
    .all<{
      id: string;
      line_account_id: string;
      event_id: string;
      slot_id: string;
      version: number;
    }>();
  for (const offer of dueOffers.results ?? []) {
    const expired = await db
      .prepare(
        `UPDATE event_waitlist
            SET status = 'expired', version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'offered' AND version = ?`,
      )
      .bind(nowIso, offer.id, offer.version)
      .run();
    if ((expired.meta?.changes ?? 0) === 0) continue;
    await db
      .prepare(`UPDATE event_slots SET version = version + 1, updated_at = ? WHERE id = ?`)
      .bind(nowIso, offer.slot_id)
      .run();
    await enqueueEventWaitlistPromotion(db, {
      lineAccountId: offer.line_account_id,
      eventId: offer.event_id,
      occurrenceId: offer.slot_id,
      sourceKey: `offer-expired:${offer.id}:${offer.version}`,
      now,
    });
  }

  const jobs = await db
    .prepare(
      `SELECT id, line_account_id, event_id, slot_id, attempts
         FROM event_waitlist_promotion_jobs
        WHERE status IN ('pending', 'retryable_failed') AND available_at <= ?
        ORDER BY available_at ASC, created_at ASC
        LIMIT ?`,
    )
    .bind(nowIso, limit)
    .all<PromotionJobRow>();

  let processed = 0;
  let promoted = 0;
  let retried = 0;
  for (const job of jobs.results ?? []) {
    // 機能オフ中はclaimせずpendingのまま残す。再オンで再開する。
    if (job.line_account_id && !await featureJobCanRun(db, { accountId: job.line_account_id, featureId: 'events', job: 'event waitlist promotions' })) {
      continue;
    }
    const claimed = await db
      .prepare(
        `UPDATE event_waitlist_promotion_jobs
            SET status = 'processing', attempts = attempts + 1, updated_at = ?, last_error = NULL
          WHERE id = ? AND status IN ('pending', 'retryable_failed')`,
      )
      .bind(nowIso, job.id)
      .run();
    if ((claimed.meta?.changes ?? 0) === 0) continue;
    processed++;
    try {
      const result = await promoteEventWaitlist(db, {
        occurrenceId: job.slot_id,
        lineAccountId: job.line_account_id,
        now,
        sender: params.sender,
      });
      if (result.kind === 'promoted') promoted++;
      await db
        .prepare(
          `UPDATE event_waitlist_promotion_jobs
              SET status = 'completed', completed_at = ?, updated_at = ?
            WHERE id = ? AND status = 'processing'`,
        )
        .bind(nowIso, nowIso, job.id)
        .run();
    } catch (error) {
      retried++;
      const delayMinutes = Math.min(2 ** Math.min(job.attempts, 6), JOB_RETRY_MAX_MINUTES);
      const availableAt = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
      const message = error instanceof Error ? error.message.slice(0, 500) : 'unknown_error';
      await db
        .prepare(
          `UPDATE event_waitlist_promotion_jobs
              SET status = 'retryable_failed', available_at = ?, last_error = ?, updated_at = ?
            WHERE id = ? AND status = 'processing'`,
        )
        .bind(availableAt, message, nowIso, job.id)
        .run();
    }
  }
  return { processed, promoted, retried };
}

function formatJst(utcIso: string): string {
  const jst = new Date(new Date(utcIso).getTime() + 9 * 3600_000).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

export function createEventWaitlistOfferSender(
  db: D1Database,
  options: { liffUrl?: string },
): EventWaitlistOfferSender {
  return async (offer) => {
    const row = await db
      .prepare(
        `SELECT la.channel_access_token, la.channel_access_token_encrypted, f.line_user_id
           FROM line_accounts la
           JOIN friends f ON f.id = ? AND f.line_account_id = la.id
          WHERE la.id = ?`,
      )
      .bind(offer.friendId, offer.lineAccountId)
      .first<{
        channel_access_token: string;
        channel_access_token_encrypted: string | null;
        line_user_id: string;
      }>();
    if (
      (!row?.channel_access_token && !row?.channel_access_token_encrypted)
      || !row.line_user_id
    ) {
      throw new Error('waitlist_notification_destination_missing');
    }
    const accessToken = await resolveLineCredential(
      row.channel_access_token_encrypted,
      row.channel_access_token,
      { lineAccountId: offer.lineAccountId, field: 'channel_access_token' },
    );
    const baseUrl = options.liffUrl?.trim();
    const offerUrl = baseUrl
      ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}eventWaitlistToken=${encodeURIComponent(offer.token)}`
      : null;
    await sendEventBookingNotification({
      channelAccessToken: accessToken,
      toLineUserId: row.line_user_id,
      kind: 'waitlist_offer',
      ctx: {
        eventName: offer.eventName,
        startsAtJst: formatJst(offer.startsAt),
        venueName: offer.venueName,
        venueUrl: offer.venueUrl,
        offerExpiresAtJst: formatJst(offer.expiresAt),
        offerUrl,
      },
    });
  };
}
