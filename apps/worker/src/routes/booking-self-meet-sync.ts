import { type Context } from 'hono';
import type { Env } from '../worker-env.js';
import { cancelMeetConsultation, registerMeetConsultation } from '../services/meet-consultation-reminders.js';
import { type BookingStatus } from '../features/booking/booking-types/index.js';
import { recordBookingAudit } from '@line-crm/db';

// ---- F6 本人日時変更・取消 (core)。待ち列は含まない ----

// 本人変更後の Meet 相談連携。予約の外部予定IDに結び付く相談だけを動かす。
// 一般予約 reminder と Meet reminder は別経路のため、ここでは Meet 側だけを触る。
export async function syncSelfBookingMeet(
  c: Context<Env>,
  self: SelfBookingChange,
  bookingId: string,
  oldEventId: string | null,
  expectedVersion: number,
): Promise<'updated' | 'recreated' | 'not_linked' | 'failed' | 'superseded'> {
  try {
    if (!oldEventId) return 'not_linked';
    const consult = await c.env.DB
      .prepare(
        `SELECT external_event_id, friend_id, title, meet_url, booking_id, booking_version
           FROM meet_consultations WHERE external_event_id = ?`,
      )
      .bind(oldEventId)
      .first<{
        external_event_id: string;
        friend_id: string;
        title: string;
        meet_url: string;
        booking_id: string | null;
        booking_version: number | null;
      }>();
    if (!consult || consult.friend_id !== self.friendId) return 'not_linked';
    // フェンス: 予約の所有・状態・版を書き込み直前に再確認する。
    // 交差した取消・別変更が勝っていたら Meet を触らない。
    const booking = await c.env.DB
      .prepare(
        `SELECT status, friend_id, lock_version, starts_at, ends_at, external_event_id
           FROM bookings WHERE id = ? AND line_account_id = ?`,
      )
      .bind(bookingId, self.accountId)
      .first<{
        status: BookingStatus;
        friend_id: string | null;
        lock_version: number;
        starts_at: string;
        ends_at: string;
        external_event_id: string | null;
      }>();
    if (!booking || booking.friend_id !== self.friendId) return 'not_linked';
    if (
      (booking.status !== 'requested' && booking.status !== 'confirmed') ||
      Number(booking.lock_version) !== expectedVersion
    ) {
      return 'superseded';
    }
    const newEventId = booking.external_event_id ?? oldEventId;
    if (newEventId !== oldEventId) {
      // 予定が作り直されても同一相談は続ける。古い相談を止め、新予定ID・
      // 本人・新日時・同じ Meet URL で登録し直す（前日・1時間前も組み直す）。
      // 旧予定IDは回転ずみで誰の新予定でもないため、見た版のまま無条件で止める。
      await cancelMeetConsultation(c.env.DB, oldEventId, new Date(), {
        failOnSendInFlight: true,
        expectedBookingId: consult.booking_id,
        expectedBookingVersion: consult.booking_version,
      });
    }
    const registered = await registerMeetConsultation(c.env.DB, {
      externalEventId: newEventId,
      friendId: self.friendId,
      title: consult.title,
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
      meetUrl: consult.meet_url,
      bookingId,
      bookingVersion: expectedVersion,
    });
    // 登録時に後発の勝者がいたら敗者は何も書いていない。補償で勝者を
    // 消さないよう、そのまま superseded で終える (409)。
    if (!registered.updated) return 'superseded';
    // 書込み後の再確認。register との間に取消・別変更が勝っていたら、
    // 今書いた相談を取り消して戻す（敗者が復活を残さない）。
    // 補償の失敗は隠さず failed と監査に残す。取消再送が回収口になる。
    const after = await c.env.DB
      .prepare(
        `SELECT status, friend_id, lock_version FROM bookings
          WHERE id = ? AND line_account_id = ?`,
      )
      .bind(bookingId, self.accountId)
      .first<{ status: BookingStatus; friend_id: string | null; lock_version: number }>();
    if (
      !after ||
      after.friend_id !== self.friendId ||
      (after.status !== 'requested' && after.status !== 'confirmed') ||
      Number(after.lock_version) !== expectedVersion
    ) {
      try {
        // 補償は自分の版の行だけを消す。同じ予定IDに後発の勝者がいたら
        // false になり、勝者の相談・通知を残して superseded で終える。
        const compensated = await cancelMeetConsultation(c.env.DB, newEventId, new Date(), {
          failOnSendInFlight: true,
          expectedBookingId: bookingId,
          expectedBookingVersion: expectedVersion,
        });
        if (!compensated) return 'superseded';
      } catch (error) {
        await recordBookingAudit(c.env.DB, {
          bookingId,
          lineAccountId: self.accountId,
          action: 'meet_sync_failed',
          before: { external_event_id: newEventId },
          after: { external_event_id: newEventId },
          reason: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
          actorType: 'customer',
          actorId: self.friendId,
          actorName: null,
          occurredAt: new Date().toISOString(),
        });
        return 'failed';
      }
      return 'superseded';
    }
    return newEventId !== oldEventId ? 'recreated' : 'updated';
  } catch {
    return 'failed';
  }
}

// F6 本人変更の呼び出し情報。管理者の account_id クエリ・staff 認証の代わりに
// LIFF の idToken→account→friend 所有で渡す。本人口に BOOKING_SETTINGS_KEY は要求しない。
export type SelfBookingChange = {
  accountId: string;
  friendId: string;
  lineUserId: string;
};
