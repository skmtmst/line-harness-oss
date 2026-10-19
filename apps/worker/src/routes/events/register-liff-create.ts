import { EntitlementError } from '../../features/booking/booking-entitlements/index.js';
import { discardUnacceptedEventBooking, assertEventPassRequirement, validateEventEntitlement, eventEntitlementUse } from '../../services/event-entitlements.js';
import { logger } from '@line-crm/shared/server';
import { prepareEventNotification } from '../../services/event-notification-plan.js';
import { prepareEventReminders } from '../../services/event-reminder-plan.js';
import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { eventModeRemaining } from '../../services/event-mode-capacity.js';
import { bad } from '../../services/event-input-error.js';
import { inputJsonBoundary } from '../../lib/input-errors.js';
import { enrollByTrigger } from '../../services/reminder-trigger.js';
import { CUSTOMER_NOTE_MAX, EVENT_IDEMPOTENCY_TTL_MINUTES } from '../../services/event-booking-types.js';
import { verifyCallerLineUserId } from '../../services/liff-auth.js';
import { computeIdentityKey } from '../../lib/identity-key.js';
import { reserveEventIdempotency, finalizeEventIdempotencyResponse } from '../../services/event-booking-idempotency.js';
import { computeRemindersForBooking, insertRemindersForBooking } from '../../services/event-booking-reminders.js';
import { sendEventBookingNotification, type EventNotificationKind } from '../../services/event-booking-notifier.js';
import { awardActivityMileage } from '../../services/activity-mileage.js';
import { dispatchAutomationEventWithLogging } from '../../features/automations/automation-triggers/index.js';
import { applyActionScoreEvent } from '../../services/action-score-events.js';
import { resolveLineCredential } from '@line-crm/db';
import { getEventOccurrenceUsedSeats } from '../../services/event-waitlist.js';
import { resolveAccountIdFromLiff, EVENT_PARTY_SIZE_MAX, serializeAnswerSnapshot, validateEventAnswers, parseEventQuestions, eventBookingSnapshot, optionalExecutionCtx } from './input.js';
import { EventDbRow, SlotDbRow, startsAtJst } from './time-input.js';

export function registerLiffCreate(events: Hono<Env>): void {
events.post('/api/liff/events/:id/bookings', inputJsonBoundary(), async (c) => {
  const account_id = await resolveAccountIdFromLiff(c);
  if (!account_id) return bad(c, 'liff_account_resolution_failed', 400, []);
  const idemKey = c.req.header('Idempotency-Key');
  if (!idemKey) return bad(c, 'idempotency_key_required', 400, []);
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env, account_id);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);

  // is_following=1 必須: フォロー解除した友だちは push が届かない。
  // Salon booking と同じ防御を入れる。user_id / picture_url は identity_key
  // 算出に必要 (broadcasts dedup と同じ識別ロジック)。
  const friend = await c.env.DB
    .prepare(
      `SELECT id, user_id, picture_url FROM friends
        WHERE line_user_id = ? AND line_account_id = ? AND is_following = 1`,
    )
    .bind(callerLineUserId, account_id)
    .first<{ id: string; user_id: string | null; picture_url: string | null }>();
  if (!friend) return bad(c, 'friend_not_found', 404);

  // Reserve idempotency key BEFORE the booking work to dedupe concurrent
  // double-taps (the key is held for the full TTL window).
  const reservation = await reserveEventIdempotency(c.env.DB, {
    key: idemKey,
    lineAccountId: account_id,
    friendId: friend.id,
    ttlMinutes: EVENT_IDEMPOTENCY_TTL_MINUTES,
    now: new Date(),
  });
  if (reservation.kind === 'cached') {
    if (reservation.status >= 500) throw new Error('event_booking_cached_failure');
    return c.json(
      reservation.body as Record<string, unknown>,
      reservation.status as 200 | 201 | 400 | 409 | 410 | 422,
    );
  }
  if (reservation.kind === 'in_progress') {
    return bad(c, 'idempotent_in_progress', 429);
  }

  // Helper that finalizes the reservation row before returning. Wraps every
  // exit path so retries after this point hit the cached branch above.
  const finalize = async (status: number, body: unknown): Promise<Response> => {
    await finalizeEventIdempotencyResponse(c.env.DB, {
      key: idemKey,
      lineAccountId: account_id,
      friendId: friend.id,
      status,
      body,
    });
    return c.json(body as Record<string, unknown>, status as 200 | 201 | 400 | 409 | 410 | 422);
  };
  // try/catch wrapper so an unexpected DB error does not strand the
  // idempotency reservation in the in_progress state for the full TTL.
  try {
    return await runBookingFlow();
  } catch (e) {
    if(e instanceof EntitlementError)return finalize(e.status,{error:e.code});
    if(e instanceof Error&&e.message.includes('entitlement_unavailable'))return finalize(409,{error:'entitlement_unavailable'});
    await finalize(500, { error: 'internal_error' });
    throw e;
  }

  async function runBookingFlow(): Promise<Response> {
  // Hoisted function declarations lose narrowing of outer-scope `const`
  // captures; re-assert here to keep `friend` / `callerLineUserId` non-null.
  // The outer scope already returned on null, so these throws are unreachable.
  if (friend == null) throw new Error('runBookingFlow: friend missing');
  if (callerLineUserId == null) throw new Error('runBookingFlow: callerLineUserId missing');
  if (account_id == null) throw new Error('runBookingFlow: line account missing');

  const event = await c.env.DB
    .prepare(
      `SELECT id, name, image_url, description, venue_name, venue_address, venue_url,
              confirmation_message_extra, cancel_deadline_hours_before,
              requires_approval, approval_deadline_hours, current_published_version_id,
              max_bookings_per_friend,
              reminder_day_before_enabled, reminder_hours_before,
              visible_tag_id, waitlist_enabled, entry_cutoff_hours_before,
              questions_json
         FROM events
        WHERE id = ? AND deleted_at IS NULL AND is_published = 1
          AND (lifecycle_status IS NULL OR lifecycle_status = 'published') AND (
          (target_type = 'single' AND line_account_id = ?)
          OR (target_type = 'multi-account-dedup'
              AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
        )`,
    )
    .bind(c.req.param('id'), account_id, account_id)
    .first<EventDbRow>();
  if (!event) return finalize(409, { error: 'event_unpublished' });

  const body = (await c.req.json().catch(() => ({}))) as {
    slot_id?: string;
    entitlement_id?: unknown;
    customer_note?: string | null;
    party_size?: unknown;
    participation_mode?: unknown;
    answers?: unknown;
  };
  if (typeof body.slot_id !== 'string' || body.slot_id.length === 0) {
    return finalize(422, { error: 'invalid_slot_id' });
  }
  if (body.customer_note != null) {
    if (typeof body.customer_note !== 'string' || body.customer_note.length > CUSTOMER_NOTE_MAX) {
      return finalize(422, { error: 'invalid_customer_note' });
    }
  }
  const requestedPartySize = body.party_size == null ? 1 : body.party_size;
  if (!Number.isInteger(requestedPartySize) || (requestedPartySize as number) < 1 || (requestedPartySize as number) > EVENT_PARTY_SIZE_MAX) {
    return finalize(422, { error: 'invalid_party_size' });
  }
  await assertEventPassRequirement(c.env.DB,account_id,event.id,body.entitlement_id);
  const partySize = requestedPartySize as number;
  if(body.entitlement_id!==undefined&&(typeof body.entitlement_id!=='string'||!body.entitlement_id||partySize!==1)) return finalize(422,{error:'invalid_entitlement'});
  const participationMode=body.participation_mode??'classroom';
  if(participationMode!=='classroom'&&participationMode!=='online')return finalize(422,{error:'invalid_participation_mode'});
  const answerSnapshot = serializeAnswerSnapshot(body.answers);
  if (!answerSnapshot.ok) return finalize(422, { error: 'invalid_answers' });
  // 必須の質問に答えていない申込は受け付けない。定義に無いidへの回答は
  // 編集途中のずれとして許容し、保存だけする。
  if (!validateEventAnswers(parseEventQuestions(event.questions_json), body.answers)) {
    return finalize(422, { error: 'missing_required_answers' });
  }
  const firstParticipationCheckedAt = new Date().toISOString();
  const attended = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS c FROM event_bookings
        WHERE friend_id = ? AND status = 'attended' AND requested_at < ?`,
    )
    .bind(friend.id, firstParticipationCheckedAt)
    .first<{ c: number }>();
  const priorAttendedCount = attended?.c ?? 0;
  const firstParticipationIsFirst = priorAttendedCount === 0 ? 1 : 0;

  const slot = await c.env.DB
    .prepare(
      `SELECT id, event_id, starts_at, ends_at, is_active, deleted_at
         FROM event_slots WHERE id = ? AND event_id = ? AND deleted_at IS NULL`,
    )
    .bind(body.slot_id, event.id)
    .first<SlotDbRow>();
  if (!slot || slot.is_active !== 1) return finalize(409, { error: 'slot_inactive' });
  if (new Date(slot.starts_at).getTime() <= Date.now()) return finalize(410, { error: 'slot_started' });
  const bookingSnapshotJson = eventBookingSnapshot(event, slot);

  // 公開対象を絞っているイベントは、そのタグを持つ人だけが申し込める。
  // 一覧や詳細でも同じ条件で隠すが、URL を直接叩けば素通りするので
  // 申込のところでも見る。
  if (event.visible_tag_id) {
    const tagged = await c.env.DB
      .prepare(`SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ? LIMIT 1`)
      .bind(friend.id, event.visible_tag_id)
      .first<{ 1: number }>();
    if (!tagged) return finalize(409, { error: 'event_unpublished' });
  }

  // 申込の締め切り。開始そのものは上で見ているので、ここは「何時間前まで」。
  if (event.entry_cutoff_hours_before != null) {
    const cutoffAt =
      new Date(slot.starts_at).getTime() - event.entry_cutoff_hours_before * 3600_000;
    if (Date.now() >= cutoffAt) return finalize(410, { error: 'entry_closed' });
  }

  const identityKey = computeIdentityKey(friend);

  /*
   * 満席のときキャンセル待ちへ入れる。**申込前の空き確認と、INSERT 後の
   * 再検査で負けたときの両方から呼ぶ** (#747 / N-416)。
   *
   * 以前はここが申込前の分岐の中だけにあったので、**同時申込で負けた側は
   * 待ちが有効でも `slot_full` で終わっていた**。空き確認を通った時点では
   * 席があったのに、後から来た再検査で弾かれるという、利用者からは
   * 区別のつかない負け方をする。待ちが有効なら、どちらの負け方でも
   * 同じ行き先にする。
   *
   * キャンセル待ちは event_bookings に入れない。定員を数えている箇所が
   * 多く、そこへ「待ちは数えない」条件を足して回ると必ずどこかで漏れる。
   * 同じ(枠, 同一人物)の重複は部分UNIQUE索引が弾くので INSERT OR IGNORE。
   */
  // 巻き上げられる function 宣言にすると、外側の const に効いている絞り込みが
  // 消える (このファイルの runBookingFlow と同じ理由)。const の arrow にする。
  const enterWaitlist = async (): Promise<Response> => {
    // 別キーの同時申込で、この本人の予約が先に成立した可能性がある。
    // 確認と待ち登録を同じ文にして、その間に予約が割り込む隙間も閉じる。
    const entered = await c.env.DB
      .prepare(
        `INSERT OR IGNORE INTO event_waitlist
           (id, line_account_id, event_id, slot_id, friend_id, identity_key, status,
            party_size, answer_snapshot_json, first_participation,
            first_participation_attended_count, first_participation_checked_at,
            event_version_id, event_snapshot_json, created_at, updated_at, participation_mode)
         SELECT ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM event_bookings
             WHERE event_id = ? AND slot_id = ? AND identity_key = ?
               AND status IN ('requested','confirmed')
          )
            AND (? IS NULL OR (
              SELECT COUNT(*) FROM event_bookings
               WHERE event_id = ? AND identity_key = ?
                 AND status IN ('requested','confirmed')
            ) < ?)`,
      )
      .bind(
        crypto.randomUUID(),
        account_id,
        event.id,
        slot.id,
        friend.id,
        identityKey,
        partySize,
        answerSnapshot.json,
        firstParticipationIsFirst,
        priorAttendedCount,
        firstParticipationCheckedAt,
        event.current_published_version_id,
        bookingSnapshotJson,
        firstParticipationCheckedAt,
        firstParticipationCheckedAt,
        participationMode,
        event.id, slot.id, identityKey,
        event.max_bookings_per_friend, event.id, identityKey, event.max_bookings_per_friend,
      )
      .run();
    if ((entered.meta.changes ?? 0) === 0) {
      const existing = await c.env.DB
        .prepare(
          `SELECT b.id, b.status, b.slot_id, s.starts_at AS slot_starts_at, COUNT(*) OVER () AS total
             FROM event_bookings b
             JOIN event_slots s ON s.id = b.slot_id
            WHERE b.event_id = ? AND b.identity_key = ?
              AND b.status IN ('requested','confirmed')
            ORDER BY (b.slot_id = ?) DESC, b.requested_at ASC, b.id ASC
            LIMIT 1`,
        )
        .bind(event.id, identityKey, slot.id)
        .first<{ id: string; status: string; slot_id: string; slot_starts_at: string; total: number }>();
      if (existing && (existing.slot_id === slot.id
        || (event.max_bookings_per_friend != null && existing.total >= event.max_bookings_per_friend))) {
        if (existing.slot_id === slot.id || event.max_bookings_per_friend === 1) {
          return finalize(409, {
            error: 'duplicate_friend_booking',
            existing: { id: existing.id, status: existing.status, slot_starts_at: existing.slot_starts_at },
          });
        }
        return finalize(409, { error: 'over_friend_limit' });
      }
      // 判定後に予約が取り消された場合も、未登録を「待ち」と返さない。
      const waiting = await c.env.DB
        .prepare(`SELECT id FROM event_waitlist WHERE event_id = ? AND slot_id = ?
                   AND identity_key = ? AND status IN ('waiting','offered') LIMIT 1`)
        .bind(event.id, slot.id, identityKey)
        .first<{ id: string }>();
      if (!waiting) return finalize(409, { error: 'slot_full' });
    }
    // 200 で返す。409 だと画面側は失敗として扱い、「待ちに入りました」を
    // 出せない。画面は waitlisted を見て確定と区別する。
    return finalize(200, { waitlisted: true, slot_id: slot.id });
  };

  // Pre-flight friend-limit check は identity_key ベースに統合済 (後段の
  // sameIdentityActive ブロック参照)。friend_id ベースの単一アカウント
  // 内カウントは cross-account 同一人物を捉えられないので使わない。
  // Pre-flight capacity check (also a cheap rejection).
  const slotRow = await c.env.DB
    .prepare(`SELECT capacity FROM event_slots WHERE id = ?`)
    .bind(slot.id)
    .first<{ capacity: number | null }>();
  if (slotRow?.capacity != null) {
    const usedSeats = await getEventOccurrenceUsedSeats(c.env.DB, slot.id);
    if (usedSeats + partySize > slotRow.capacity) {
      if (event.waitlist_enabled !== 1) return finalize(409, { error: 'slot_full' });
      return enterWaitlist();
    }
  }

  if(typeof body.entitlement_id==='string') await validateEventEntitlement(c.env.DB,account_id,friend.id,event.id,body.entitlement_id,slot.starts_at);
  const modeRemaining=await eventModeRemaining(c.env.DB,slot.id,participationMode);
  if(modeRemaining!==null&&partySize>modeRemaining){if(event.waitlist_enabled===1)return enterWaitlist();return finalize(409,{error:'slot_full'});}

  // 同一人物 (cross-account) の active 予約数を identity_key ベースでカウント。
  // 重複制限ロジック:
  //   - max=null: 制限なし (admin UI の「制限なし」と整合)、チェックスキップ
  //   - max=1: 同一人物の 2 件目を duplicate_friend_booking で弾く
  //   - max=N (>1): N 件まで許可、N+1 件目以降は over_friend_limit
  // UNIQUE INDEX を貼らないので max>1 の event も正しく動作する。
  if (event.max_bookings_per_friend != null) {
    const sameIdentityActive = await c.env.DB
      .prepare(
        `SELECT b.id, b.status, s.starts_at AS slot_starts_at, COUNT(*) OVER () AS total
           FROM event_bookings b
           JOIN event_slots s ON s.id = b.slot_id
          WHERE b.event_id = ?
            AND b.identity_key = ?
            AND b.status IN ('requested','confirmed')
          ORDER BY b.requested_at ASC
          LIMIT 1`,
      )
      .bind(event.id, identityKey)
      .first<{ id: string; status: string; slot_starts_at: string; total: number }>();
    if (sameIdentityActive && sameIdentityActive.total >= event.max_bookings_per_friend) {
      if (event.max_bookings_per_friend === 1) {
        return finalize(409, {
          error: 'duplicate_friend_booking',
          existing: {
            id: sameIdentityActive.id,
            status: sameIdentityActive.status,
            slot_starts_at: sameIdentityActive.slot_starts_at,
          },
        });
      }
      return finalize(409, { error: 'over_friend_limit' });
    }
  }

  // Insert-then-verify pattern: Cloudflare D1 doesn't expose multi-statement
  // transactions, so we INSERT first, then re-COUNT. If concurrent inserts
  // pushed us over the limit we DELETE this row and return 409. Determinism
  // is enforced by the INSERT timestamp (newest row loses).
  const status = event.requires_approval === 1 ? 'requested' : 'confirmed';
  const id = crypto.randomUUID();
  const nowIso = firstParticipationCheckedAt;
  const approvalExpiresAt = status === 'requested'
    ? new Date(Date.parse(nowIso) + event.approval_deadline_hours * 3600_000).toISOString()
    : null;
  const notificationKind:EventNotificationKind=status==='requested'?'received_pending':'received_confirmed';
  const notificationPlan=await prepareEventNotification(c.env.DB,{
    accountId:account_id,operationId:`event-booking:${id}:${notificationKind}:${slot.id}`,to:callerLineUserId,
    kind:notificationKind,ctx:{eventName:event.name,startsAtJst:startsAtJst(slot.starts_at),venueName:event.venue_name,
      venueUrl:event.venue_url,confirmationExtra:event.confirmation_message_extra},subject:{bookingId:id,slotId:slot.id,status,startsAt:slot.starts_at},now:new Date(nowIso),
  });
  const reminderPlans=status==='confirmed'?prepareEventReminders(c.env.DB,id,computeRemindersForBooking({
    starts_at_utc:slot.starts_at,reminder_day_before_enabled:event.reminder_day_before_enabled===1,
    reminder_hours_before:event.reminder_hours_before,now:new Date(nowIso),
  }),true):[];
  const [bookingInserted] = await c.env.DB.batch([c.env.DB.prepare(
      `INSERT INTO event_bookings
         (id, line_account_id, event_id, slot_id, friend_id, status, customer_note,
          requested_at, identity_key, party_size, answer_snapshot_json,
          first_participation, first_participation_attended_count,
          first_participation_checked_at, event_version_id, event_snapshot_json,
          approval_expires_at, participation_mode)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM event_waitlist
           WHERE event_id = ? AND slot_id = ? AND identity_key = ?
             AND status IN ('waiting','offered','accepted')
        )
          AND (? IS NULL OR (
            (SELECT COUNT(*) FROM event_bookings
              WHERE event_id = ? AND identity_key = ? AND status IN ('requested','confirmed'))
            + (SELECT COUNT(*) FROM event_waitlist
                WHERE event_id = ? AND identity_key = ? AND status IN ('offered','accepted'))
          ) < ?)
          AND EXISTS(SELECT 1 FROM event_slots live_slot WHERE live_slot.id=?
            AND (live_slot.capacity IS NULL OR COALESCE((SELECT SUM(party_size) FROM event_bookings
              WHERE slot_id=live_slot.id AND status IN ('requested','confirmed')),0)
              + COALESCE((SELECT SUM(party_size) FROM event_waitlist
                WHERE slot_id=live_slot.id AND status IN ('offered','accepted')),0)+?<=live_slot.capacity))`,
    )
    .bind(
      id, account_id, event.id, slot.id, friend.id, status,
      body.customer_note ?? null, nowIso, identityKey, partySize,
      answerSnapshot.json, firstParticipationIsFirst, priorAttendedCount,
      firstParticipationCheckedAt,
      event.current_published_version_id, bookingSnapshotJson, approvalExpiresAt, participationMode,
      event.id, slot.id, identityKey,
      event.max_bookings_per_friend, event.id, identityKey,
      event.id, identityKey, event.max_bookings_per_friend,slot.id,partySize,
    ),...(typeof body.entitlement_id==='string'?[await eventEntitlementUse(c.env.DB,account_id,id,body.entitlement_id,slot.starts_at)]:[]),notificationPlan,...reminderPlans]);
  if ((bookingInserted.meta?.changes ?? 0) === 0) {
    const remaining=await eventModeRemaining(c.env.DB,slot.id,participationMode);
    if(remaining!==null&&remaining<partySize){if(event.waitlist_enabled===1)return enterWaitlist();return finalize(409,{error:'slot_full'});}
    // 同じ回の待ちが先に成立した場合は、その順番・人数・回答を維持する。
    // 別の回のwaitingは予約上限を消費せず、席を保留したoffered/acceptedだけ数える。
    const waiting = await c.env.DB
      .prepare(`SELECT id FROM event_waitlist WHERE event_id = ? AND slot_id = ?
                 AND identity_key = ? AND status IN ('waiting','offered','accepted') LIMIT 1`)
      .bind(event.id, slot.id, identityKey)
      .first<{ id: string }>();
    if (waiting) return finalize(409, { error: 'duplicate_friend_booking' });
    return finalize(409, { error: event.max_bookings_per_friend === 1 ? 'duplicate_friend_booking' : 'over_friend_limit' });
  }

  // Verify capacity again. If there is a race winner ahead of us — i.e. an
  // earlier (smaller requested_at, then smaller id) row — we are the loser
  // and roll back our row.
  if (slotRow?.capacity != null) {
    const usedSeats = await getEventOccurrenceUsedSeats(c.env.DB, slot.id);
    if (usedSeats > slotRow.capacity) {
      const winner = await c.env.DB
        .prepare(
          `SELECT id FROM (
             SELECT id,
                    SUM(party_size) OVER (ORDER BY requested_at ASC, id ASC) AS occupied_seats
               FROM event_bookings
              WHERE slot_id = ? AND status IN ('requested','confirmed')
           ) WHERE occupied_seats <= MAX(0, ? - COALESCE((
             SELECT SUM(party_size) FROM event_waitlist
              WHERE slot_id = ? AND status IN ('offered','accepted')
           ), 0))`,
        )
        .bind(slot.id, slotRow.capacity, slot.id)
        .all<{ id: string }>();
      const winners = new Set((winner.results ?? []).map((r) => r.id));
      if (!winners.has(id)) {
        await discardUnacceptedEventBooking(c.env.DB,account_id,id);
        // 席を戻してから待ちへ入れる。順序が逆だと、自分の予約行が残った
        // まま待ちの行が増え、一瞬だけ定員を二重に押さえる。
        if (event.waitlist_enabled === 1) return enterWaitlist();
        return finalize(409, { error: 'slot_full' });
      }
    }
  }

  // Verify friend-limit again (identity_key ベース、cross-account 同一人物
  // を含めて再 COUNT)。並走 race の loser は DELETE してロールバック。
  // null は管理画面の「制限なし」なので、この検査自体を行わない。
  if (event.max_bookings_per_friend != null) {
    const effectiveMax = event.max_bookings_per_friend;
    const cnt2 = await c.env.DB
      .prepare(
        `SELECT COUNT(*) AS c FROM event_bookings
          WHERE event_id = ? AND identity_key = ? AND status IN ('requested','confirmed')`,
      )
      .bind(event.id, identityKey)
      .first<{ c: number }>();
    if ((cnt2?.c ?? 0) > effectiveMax) {
      const winner = await c.env.DB
        .prepare(
          `SELECT id FROM event_bookings
            WHERE event_id = ? AND identity_key = ? AND status IN ('requested','confirmed')
            ORDER BY requested_at ASC, id ASC
            LIMIT ?`,
        )
        .bind(event.id, identityKey, effectiveMax)
        .all<{ id: string }>();
      const winners = new Set((winner.results ?? []).map((r) => r.id));
      if (!winners.has(id)) {
        await discardUnacceptedEventBooking(c.env.DB,account_id,id);
        const code = effectiveMax === 1 ? 'duplicate_friend_booking' : 'over_friend_limit';
        return finalize(409, { error: code });
      }
    }
  }

  await awardActivityMileage(c.env.DB, {
    eventType: 'booking_created',
    source: 'event_booking',
    sourceEventId: id,
    friendId: friend.id,
    metadata: { bookingType: 'event', eventId: event.id, slotId: slot.id },
    occurredAt: nowIso,
  });
  const actionScorePromise = applyActionScoreEvent(c.env.DB, {
    lineAccountId: account_id,
    friendId: friend.id,
    eventType: 'booking_created',
    source: 'event_booking',
    sourceEventId: id,
    subjectKey: event.id,
    occurredAt: nowIso,
  }).catch((error) => {
    // 予約成立後の派生処理なので、スコア側の障害で予約を失敗扱いにしない。
    logger.error("routes_events_failed");
  });
  const actionScoreExecutionCtx = optionalExecutionCtx(c);
  if (actionScoreExecutionCtx) actionScoreExecutionCtx.waitUntil(actionScorePromise);
  else await actionScorePromise;

  if (status === 'confirmed') {
    const reminders = computeRemindersForBooking({
      starts_at_utc: slot.starts_at,
      reminder_day_before_enabled: event.reminder_day_before_enabled === 1,
      reminder_hours_before: event.reminder_hours_before,
    });
    await insertRemindersForBooking(c.env.DB, id, reminders);
  }

  // イベントをきっかけにするリマインダへ登録する。承認待ちの段階では
  // まだ登録しない。落選した人にまで「明日です」と届く。
  if (status === 'confirmed') {
    await enrollByTrigger(c.env.DB, {
      triggerType: 'event',
      friendId: friend.id,
      startsAtIso: slot.starts_at as string,
      sourceId: id,
      sourceEventId: id,
      eventId: event.id,
      lineAccountId: account_id,
    }).catch((err) => logger.error("routes_events_failed"));
    optionalExecutionCtx(c)?.waitUntil(
      dispatchAutomationEventWithLogging(c.env.DB, {
        lineAccountId: account_id,
        eventType: 'calendar_booked',
        sourceEventId: id,
        friendId: friend.id,
        eventData: {
          bookingType: 'event', bookingId: id, eventId: event.id, slotId: slot.id,
        },
      })
        .catch((error) => logger.error("routes_events_failed")),
    );
  }

  // best-effort notification: do not fail the booking if push fails.
  try {
    const acc = await c.env.DB
      .prepare(
        `SELECT la.channel_access_token, la.channel_access_token_encrypted,
                e.confirmation_message_extra
           FROM line_accounts la
           JOIN events e ON e.id = ?
          WHERE la.id = ?`,
      )
      .bind(event.id, account_id)
      .first<{ channel_access_token: string; channel_access_token_encrypted: string | null; confirmation_message_extra: string | null }>();
    if (acc?.channel_access_token) {
      const accessToken = await resolveLineCredential(
        acc.channel_access_token_encrypted,
        acc.channel_access_token,
        { lineAccountId: account_id, field: 'channel_access_token' },
      );
      const kind: EventNotificationKind =
        status === 'requested' ? 'received_pending' : 'received_confirmed';
      await sendEventBookingNotification({
        delivery: { db: c.env.DB, accountId: account_id, operationId: `event-booking:${id}:${kind}:${slot.id}`,
          subject:{bookingId:id,slotId:slot.id,status,startsAt:slot.starts_at},
          authorize: async () => !!await c.env.DB.prepare('SELECT 1 ok FROM event_bookings WHERE id=? AND line_account_id=? AND status=? AND slot_id=?')
            .bind(id,account_id,status,slot.id).first() },
        channelAccessToken: accessToken,
        toLineUserId: callerLineUserId,
        kind,
        ctx: {
          eventName: event.name,
          startsAtJst: startsAtJst(slot.starts_at),
          venueName: event.venue_name,
          venueUrl: event.venue_url,
          confirmationExtra: acc.confirmation_message_extra,
        },
      });
    }
  } catch (e) {
    logger.error("routes_events_failed");
  }

  return finalize(201, { id, status });
  } // close runBookingFlow
});
}
