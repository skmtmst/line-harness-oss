import type { HarnessProxyDispatch } from './line-proxy-send.js';
import { pushViaHarnessProxy } from './line-proxy-send.js';
import {
  activeTenantLineAccountSql,
  isOperationCapabilityStopped,
  resolveLineCredential,
} from '@line-crm/db';
import { stoppedTenantLineAccountSql } from './tenant-runtime-status.js';
import { featureJobCanRun } from './feature-enforcement.js';
import { cancelByTrigger, enrollByTrigger, reconcileV6ToStartsAt } from './reminder-trigger.js';

export type MeetReminderKind = 'day_before' | 'hour_before';

export interface RegisterMeetConsultationInput {
  externalEventId: string;
  friendId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  meetUrl: string;
  /** 結び付く予約。版と組で後発の勝者を古い操作から守る。無いときは従来どおり無条件。 */
  bookingId?: string | null;
  bookingVersion?: number | null;
}

export interface CancelMeetConsultationOptions {
  failOnSendInFlight?: boolean;
  /** 行が見た版と違うときは何も変えず false (古い補償が勝者を消さない)。無いときは従来どおり無条件。 */
  expectedBookingId?: string | null;
  expectedBookingVersion?: number | null;
}

export interface MeetReminderSchedule {
  kind: MeetReminderKind;
  scheduledAt: string;
}

export interface MeetReminderDeliveryOptions {
  now: Date;
  proxyBaseUrl: string;
  proxyDispatch?: HarnessProxyDispatch;
}

interface MeetConsultationRow {
  id: string;
  external_event_id: string;
  friend_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  meet_url: string;
  status: 'confirmed' | 'cancelled' | 'completed';
  booking_id: string | null;
  booking_version: number | null;
}

interface DueMeetReminderRow {
  id: string;
  consultation_id: string;
  kind: MeetReminderKind;
  retry_count: number;
  title: string;
  starts_at: string;
  meet_url: string;
  line_user_id: string;
  line_account_id: string;
  channel_access_token: string;
  channel_access_token_encrypted: string | null;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MAX_RETRY = 3;
const MEET_URL_RE = /^https:\/\/meet\.google\.com\/[a-z0-9-]+(?:[/?#].*)?$/i;

function normalizeDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be a valid ISO datetime`);
  return date;
}

export function calculateMeetReminderSchedule(
  startsAt: string,
  now: Date,
): MeetReminderSchedule[] {
  const start = normalizeDate(startsAt, 'startsAt');
  const startMs = start.getTime();
  const nowMs = now.getTime();
  if (startMs <= nowMs) return [];

  const schedules: MeetReminderSchedule[] = [];
  const untilStart = startMs - nowMs;

  // 24時間以内に確定した予定は、前日通知を次のcronで即時送信する。
  // 開始1時間以内なら同時に2通送らず、1時間前通知だけにまとめる。
  if (untilStart > HOUR_MS) {
    schedules.push({
      kind: 'day_before',
      scheduledAt: new Date(Math.max(startMs - DAY_MS, nowMs)).toISOString(),
    });
  }
  schedules.push({
    kind: 'hour_before',
    scheduledAt: new Date(Math.max(startMs - HOUR_MS, nowMs)).toISOString(),
  });
  return schedules;
}

export function renderMeetReminderText(kind: MeetReminderKind, startsAt: string, meetUrl: string): string {
  const start = normalizeDate(startsAt, 'startsAt');
  const jst = new Date(start.getTime() + 9 * HOUR_MS);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const iso = jst.toISOString();
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const time = iso.slice(11, 16);
  const dateLabel = `${month}月${day}日（${weekdays[jst.getUTCDay()]}）${time}`;
  const lead = kind === 'day_before'
    ? `明日${dateLabel}から`
    : `本日${dateLabel}から（開始約1時間前）`;

  return `【個別相談リマインド】\n${lead}、Google Meetで個別相談を予定しています。\n\nお時間になりましたら、こちらからご参加ください。\n${meetUrl}\n\nよろしくお願いいたします！`;
}

export async function registerMeetConsultation(
  db: D1Database,
  input: RegisterMeetConsultationInput,
  now = new Date(),
): Promise<{ id: string; reminders: MeetReminderSchedule[]; updated: boolean }> {
  if (!input.externalEventId.trim()) throw new Error('externalEventId is required');
  if (!input.friendId.trim()) throw new Error('friendId is required');
  if (!input.title.trim()) throw new Error('title is required');
  if (!MEET_URL_RE.test(input.meetUrl)) throw new Error('meetUrl must be a Google Meet URL');

  const start = normalizeDate(input.startsAt, 'startsAt');
  const end = normalizeDate(input.endsAt, 'endsAt');
  if (end.getTime() <= start.getTime()) throw new Error('endsAt must be after startsAt');
  if (start.getTime() <= now.getTime()) throw new Error('startsAt must be in the future');

  const friend = await db
    .prepare('SELECT id, line_account_id FROM friends WHERE id = ? AND is_following = 1')
    .bind(input.friendId)
    .first<{ id: string; line_account_id: string | null }>();
  if (!friend) throw new Error('friend not found or not following');
  // V6 登録は店舗境界の中でだけ行う。所属不明では書かずに落とす。
  if (!friend.line_account_id) throw new Error('friend line account unknown');

  const existing = await db
    .prepare('SELECT * FROM meet_consultations WHERE external_event_id = ?')
    .bind(input.externalEventId)
    .first<MeetConsultationRow>();
  const consultationId = existing?.id ?? crypto.randomUUID();
  const normalizedStart = start.toISOString();
  const normalizedEnd = end.toISOString();
  const scheduleChanged = Boolean(
    existing &&
    (existing.friend_id !== input.friendId ||
      existing.starts_at !== normalizedStart ||
      existing.ends_at !== normalizedEnd ||
      existing.meet_url !== input.meetUrl),
  );
  const nowIso = now.toISOString();
  const schedules = calculateMeetReminderSchedule(normalizedStart, now);

  // 版フェンス: 同じ予定IDに後発の勝者がいるとき、古い登録は何も書かない
  // (勝者の相談・未来通知・V6を残す)。版なし同士・同版の再送・版なし行への
  // 上書きは従来どおり通す。SELECT と書込みの間の交差は下の WHERE でも防ぐ。
  const incomingVersion = input.bookingVersion ?? null;
  const storedVersion = existing?.booking_version ?? null;
  if (
    existing != null &&
    incomingVersion !== null &&
    storedVersion !== null &&
    incomingVersion < storedVersion
  ) {
    return { id: consultationId, reminders: schedules, updated: false };
  }

  const upsert = await db
    .prepare(
      `INSERT INTO meet_consultations
        (id, external_event_id, friend_id, title, starts_at, ends_at, meet_url,
         status, booking_id, booking_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)
       ON CONFLICT(external_event_id) DO UPDATE SET
         friend_id=excluded.friend_id,
         title=excluded.title,
         starts_at=excluded.starts_at,
         ends_at=excluded.ends_at,
         meet_url=excluded.meet_url,
         status='confirmed',
         booking_id=excluded.booking_id,
         booking_version=excluded.booking_version,
         updated_at=excluded.updated_at
       WHERE excluded.booking_version IS NULL
          OR meet_consultations.booking_version IS NULL
          OR excluded.booking_version >= meet_consultations.booking_version`,
    )
    .bind(
      consultationId,
      input.externalEventId,
      input.friendId,
      input.title,
      normalizedStart,
      normalizedEnd,
      input.meetUrl,
      input.bookingId ?? null,
      incomingVersion,
      nowIso,
      nowIso,
    )
    .run();
  // SELECT 後に勝者が書いていたら WHERE が止めて 0 件になる。敗者は何も触らない。
  if (existing != null && (upsert.meta?.changes ?? 0) === 0) {
    return { id: consultationId, reminders: schedules, updated: false };
  }

  const expectedKinds = new Set(schedules.map((item) => item.kind));
  for (const item of schedules) {
    const reminder = await db
      .prepare(
        'SELECT id, status FROM meet_consultation_reminders WHERE consultation_id = ? AND kind = ?',
      )
      .bind(consultationId, item.kind)
      .first<{ id: string; status: string }>();
    if (!reminder) {
      await db
        .prepare(
          `INSERT INTO meet_consultation_reminders
            (id, consultation_id, kind, scheduled_at, status, retry_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
        )
        .bind(crypto.randomUUID(), consultationId, item.kind, item.scheduledAt, nowIso, nowIso)
        .run();
    } else if (scheduleChanged || reminder.status === 'cancelled') {
      // 送信ずみは履歴として残し、未来分だけ再設定する。sent を pending に
      // 戻すと二重送信になり、sent_at を消すと履歴が欠ける。
      await db
        .prepare(
          `UPDATE meet_consultation_reminders
              SET scheduled_at=?, status='pending', retry_count=0,
                  last_error=NULL, updated_at=?
            WHERE id=? AND status IN ('pending','failed','cancelled')`,
        )
        .bind(item.scheduledAt, nowIso, reminder.id)
        .run();
    }
  }

  // 直前への日程変更などで不要になった種類は送らない。
  for (const kind of ['day_before', 'hour_before'] as const) {
    if (expectedKinds.has(kind)) continue;
    await db
      .prepare(
        `UPDATE meet_consultation_reminders
            SET status='cancelled', updated_at=?
          WHERE consultation_id=? AND kind=? AND status IN ('pending','failed')`,
      )
      .bind(nowIso, consultationId, kind)
      .run();
  }

  // N-065: 個別相談の日程変更・再送を V6 へ連動する。
  // 予約ルール (booking) を個別相談にも使い、sourceKind='meet' で追跡する。
  // 旧起点ではなく現在の開始時刻へ直す。途中失敗後の再送でも回復でき、
  // 友だち変更で旧友だちへ残った行もここで止める (新 friend だけ active)。
  // 移行前の行は個別相談が作っていないので探さない (同時刻の別予約へ触れない)。
  const v6Base = {
    triggerType: 'booking' as const,
    sourceKind: 'meet',
    sourceId: consultationId,
    sourceEventId: input.externalEventId,
    friendId: input.friendId,
    lineAccountId: friend.line_account_id,
    allowLegacyFallback: false,
  };
  const oldFriendId = existing?.friend_id ?? null;
  const friendChanged = oldFriendId !== null && oldFriendId !== input.friendId;
  // 新 friend 側にこの相談の active 行があるか。再送の判定に使う。
  // 初回も再送も V6 登録に失敗した再送では、相談行だけ新 friend へ進み
  // (friendChanged=false)、旧取消を先にすると新旧どちらの通知も消える。
  const newActive = await db.prepare(
    `SELECT COUNT(*) AS c FROM friend_reminders
      WHERE status = 'active' AND source_kind = 'meet' AND friend_id = ?
        AND (source_id = ? OR source_event_id = ?)`,
  ).bind(input.friendId, consultationId, input.externalEventId).first<{ c: number }>();
  // 新規成功後に旧取消: 新 friend 側の行が無いときは登録を先に行い、
  // 失敗は投げる (旧行に触る前に終えるため旧通知が残り、再送で回復できる)。
  const mustEnrollFirst = friendChanged || (oldFriendId !== null && (newActive?.c ?? 0) === 0);
  if (mustEnrollFirst) {
    // 新側の日付ずれだけ先に直す (旧側には触れない)。無いときは何もしない。
    await reconcileV6ToStartsAt(db, {
      triggerType: v6Base.triggerType,
      sourceKind: v6Base.sourceKind,
      sourceId: v6Base.sourceId,
      sourceEventId: v6Base.sourceEventId,
      friendId: v6Base.friendId,
      startsAtIso: normalizedStart,
      leaveOtherFriends: true,
    });
    await enrollByTrigger(db, {
      ...v6Base,
      startsAtIso: normalizedStart,
    });
  }
  await reconcileV6ToStartsAt(db, {
    triggerType: v6Base.triggerType,
    sourceKind: v6Base.sourceKind,
    sourceId: v6Base.sourceId,
    sourceEventId: v6Base.sourceEventId,
    friendId: v6Base.friendId,
    startsAtIso: normalizedStart,
  });
  if (!mustEnrollFirst) {
    // 登録失敗で相談登録自体を壊さない。二重登録は enroll 側で吸収する。
    await enrollByTrigger(db, {
      ...v6Base,
      startsAtIso: normalizedStart,
    }).catch((error) => console.error('meet reminder enroll (v6) failed:', error));
  }

  return { id: consultationId, reminders: schedules, updated: true };
}

export async function cancelMeetConsultation(
  db: D1Database,
  externalEventId: string,
  now = new Date(),
  options?: CancelMeetConsultationOptions,
): Promise<boolean> {
  const consultation = await db
    .prepare(
      `SELECT c.id, c.friend_id, c.starts_at, c.status, c.booking_id, c.booking_version,
              f.line_account_id
         FROM meet_consultations c
         LEFT JOIN friends f ON f.id = c.friend_id
        WHERE c.external_event_id = ?`,
    )
    .bind(externalEventId)
    .first<{
      id: string;
      friend_id: string;
      starts_at: string;
      status: 'confirmed' | 'cancelled' | 'completed';
      booking_id: string | null;
      booking_version: number | null;
      line_account_id: string | null;
    }>();
  if (!consultation) return false;
  // 版フェンス: 期待と違う版の行は古い補償の対象外。何も変えず false。
  // (同じ予定IDの後発の勝者を敗者が取り消せない)。期待なしは従来どおり無条件。
  if (
    options?.expectedBookingVersion !== undefined &&
    options.expectedBookingVersion !== consultation.booking_version
  ) {
    return false;
  }
  if (
    options?.expectedBookingId !== undefined &&
    options.expectedBookingId !== consultation.booking_id
  ) {
    return false;
  }
  const nowIso = now.toISOString();
  // 行の確定を先に条件付きで勝ち取る。SELECT 後に勝者が上書きしていたら
  // 0 件になり、V6・通知には触らず false (敗者は何も壊さない)。
  const claimed = await db
    .prepare(
      `UPDATE meet_consultations SET status='cancelled', updated_at=?
        WHERE id=?
          AND (booking_version = ? OR (booking_version IS NULL AND ? IS NULL))
          AND (booking_id = ? OR (booking_id IS NULL AND ? IS NULL))`,
    )
    .bind(
      nowIso,
      consultation.id,
      consultation.booking_version,
      consultation.booking_version,
      consultation.booking_id,
      consultation.booking_id,
    )
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) return false;
  // N-065: V6 の未送信予定だけを止める。送信済み履歴は残す。
  // 再送は active が無いため 0 件で返す。移行前の行は探さない。
  try {
    await cancelByTrigger(db, {
      triggerType: 'booking',
      sourceKind: 'meet',
      sourceId: consultation.id,
      sourceEventId: externalEventId,
      friendId: consultation.friend_id,
      startsAtIso: consultation.starts_at,
      lineAccountId: consultation.line_account_id,
      cancelReason: `meet_cancel:${externalEventId}:by:admin`,
      allowLegacyFallback: false,
      failOnSendInFlight: options?.failOnSendInFlight,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'REMINDER_SEND_IN_FLIGHT') {
      // 409 では行の確定も戻す (版が自分のまま・状態が自分の確定のときだけ)。
      // 勝者が上書きずみなら 0 件になり、勝者の状態を残す。再送で回復できる。
      await db
        .prepare(
          `UPDATE meet_consultations SET status=?, updated_at=?
            WHERE id=? AND status='cancelled'
              AND (booking_version = ? OR (booking_version IS NULL AND ? IS NULL))
              AND (booking_id = ? OR (booking_id IS NULL AND ? IS NULL))`,
        )
        .bind(
          consultation.status,
          nowIso,
          consultation.id,
          consultation.booking_version,
          consultation.booking_version,
          consultation.booking_id,
          consultation.booking_id,
        )
        .run();
    }
    throw error;
  }
  await db
    .prepare(
      `UPDATE meet_consultation_reminders
          SET status='cancelled', updated_at=?
        WHERE consultation_id=? AND status IN ('pending','failed')`,
    )
    .bind(nowIso, consultation.id)
    .run();
  return true;
}

export async function processDueMeetConsultationReminders(
  db: D1Database,
  options: MeetReminderDeliveryOptions,
): Promise<{ sent: number; failed: number }> {
  const nowIso = options.now.toISOString();
  await db.prepare(
    `UPDATE meet_consultation_reminders
        SET status='cancelled', last_error='tenant_suspended', updated_at=?
      WHERE status IN ('pending','failed')
        AND scheduled_at <= ?
        AND EXISTS (
          SELECT 1
            FROM meet_consultations stopped_consultation
            JOIN friends stopped_friend ON stopped_friend.id=stopped_consultation.friend_id
           WHERE stopped_consultation.id=meet_consultation_reminders.consultation_id
             AND ${stoppedTenantLineAccountSql('stopped_friend.line_account_id')}
        )`,
  ).bind(nowIso, nowIso).run();
  const due = await db
    .prepare(
      `SELECT r.id, r.consultation_id, r.kind, r.retry_count,
              c.title, c.starts_at, c.meet_url,
              f.line_user_id, f.line_account_id, la.channel_access_token,
              la.channel_access_token_encrypted
         FROM meet_consultation_reminders r
         INNER JOIN meet_consultations c ON c.id = r.consultation_id
         INNER JOIN friends f ON f.id = c.friend_id
         INNER JOIN line_accounts la ON la.id = f.line_account_id
        WHERE r.status IN ('pending','failed')
          AND r.retry_count < ?
          AND r.scheduled_at <= ?
          AND c.status = 'confirmed'
          AND c.starts_at > ?
          AND f.is_following = 1
          AND la.is_active = 1
          AND ${activeTenantLineAccountSql('f.line_account_id')}
          AND NOT EXISTS (
            SELECT 1 FROM bookings dead_booking
            WHERE dead_booking.external_event_id = c.external_event_id
              AND dead_booking.line_account_id = f.line_account_id
              AND dead_booking.status IN ('cancelled','expired')
          )
        ORDER BY r.scheduled_at ASC
        LIMIT 100`,
    )
    .bind(MAX_RETRY, nowIso, nowIso)
    .all<DueMeetReminderRow>();

  let sent = 0;
  let failed = 0;
  for (const row of due.results ?? []) {
    // 機能オフ中は送らずpendingのまま残す。再オンで再開する。
    if (row.line_account_id && !await featureJobCanRun(db, { accountId: row.line_account_id, featureId: 'booking', job: 'meet consultation reminders' })) {
      continue;
    }
    // 緊急停止 (#1050): reminder_dispatch が止まっている統括は行に触れず
    // pending のまま残す。復旧すれば次の cron が拾う。
    if (await isOperationCapabilityStopped(db, row.line_account_id, 'reminder_dispatch')) {
      continue;
    }
    // 取消と配信の競合対策: 送る直前に相談の状態を確かめ、取消済みなら送らない。
    // 結び付く予約が取消ずみでも送らない (可視フェンスの二重化)。
    const live = await db
      .prepare(
        `SELECT c.status AS status FROM meet_consultations c
          WHERE c.id = ?
            AND NOT EXISTS (
              SELECT 1 FROM bookings dead_booking
              WHERE dead_booking.external_event_id = c.external_event_id
                AND dead_booking.status IN ('cancelled','expired')
            )`,
      )
      .bind(row.consultation_id)
      .first<{ status: string }>();
    if (!live || live.status !== 'confirmed') {
      await db
        .prepare(
          `UPDATE meet_consultation_reminders
              SET status='cancelled', updated_at=?
            WHERE id=? AND status IN ('pending','failed')`,
        )
        .bind(nowIso, row.id)
        .run();
      continue;
    }
    try {
      const text = renderMeetReminderText(row.kind, row.starts_at, row.meet_url);
      const accessToken = await resolveLineCredential(
        row.channel_access_token_encrypted,
        row.channel_access_token,
        { lineAccountId: row.line_account_id, field: 'channel_access_token' },
      );
      // 取消と送信の競合対策: push の直前にもう一度だけ確かめる。
      // この後 push まで待たない (間に取消が入る余地を残さない)。
      // 予約側の取消もここで見る。
      const liveBeforePush = await db
        .prepare(
          `SELECT c.status AS status FROM meet_consultations c
            WHERE c.id = ?
              AND NOT EXISTS (
                SELECT 1 FROM bookings dead_booking
                WHERE dead_booking.external_event_id = c.external_event_id
                  AND dead_booking.status IN ('cancelled','expired')
              )`,
        )
        .bind(row.consultation_id)
        .first<{ status: string }>();
      if (!liveBeforePush || liveBeforePush.status !== 'confirmed') {
        await db
          .prepare(
            `UPDATE meet_consultation_reminders
                SET status='cancelled', updated_at=?
              WHERE id=? AND status IN ('pending','failed')`,
          )
          .bind(nowIso, row.id)
          .run();
        continue;
      }
      await pushViaHarnessProxy(
        options.proxyBaseUrl,
        accessToken,
        row.line_user_id,
        [{ type: 'text', text }],
        row.id,
        options.proxyDispatch,
        'reminder_dispatch',
      );
      // 同時取消で止められた行を sent で上書きしない (状態だけ守る。送信数は数える)。
      const marked = await db
        .prepare(
          `UPDATE meet_consultation_reminders
              SET status='sent', sent_at=?, last_error=NULL, updated_at=?
            WHERE id=? AND status IN ('pending','failed')`,
        )
        .bind(nowIso, nowIso, row.id)
        .run();
      sent++;
      // push と確定の間に取消が確定したときは送り直さず、追跡用に記録する。
      if (Number(marked.meta?.changes ?? 0) !== 1) {
        console.error(JSON.stringify({
          event: 'meet_reminder_sent_after_cancel',
          consultationId: row.consultation_id,
          reminderId: row.id,
        }));
      }
    } catch (error) {
      const retryCount = row.retry_count + 1;
      await db
        .prepare(
          `UPDATE meet_consultation_reminders
              SET status='failed', retry_count=?, last_error=?, updated_at=?
            WHERE id=?`,
        )
        .bind(
          retryCount,
          error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
          nowIso,
          row.id,
        )
        .run();
      failed++;
    }
  }
  return { sent, failed };
}
