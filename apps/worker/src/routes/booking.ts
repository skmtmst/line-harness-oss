// Booking feature HTTP routes.
//
// LIFF-facing endpoints live under /api/liff/booking/* (auth-bypassed by
// authMiddleware) and resolve the LINE account from the liffId query.
// Admin-facing endpoints live under /api/booking/admin/* and rely on the
// global authMiddleware for staff/owner authentication; they require an
// `account_id` query param to scope to a single LINE account.
//
// All UUIDs are generated via crypto.randomUUID(); UTC ISO timestamps for
// time-of-event columns (starts_at / ends_at / block_ends_at / requested_at /
// scheduled_at / decided_at / expires_at) are written from the Worker.

import { Hono, type Context } from 'hono';
import {
  createBookingCustomer,
  getBookingCustomer,
  getLineAccounts,
  resolveLineCredential,
  searchBookingCustomers,
  createBookingAvailabilityException,
  getBookingAdminSettings,
  listBookingAdminResources,
  getBookingAvailabilityException,
  listBookingAvailabilityExceptions,
  updateBookingAvailabilityException,
  updateBookingMenuSettings,
  type BookingExceptionKind,
  type BookingExceptionScope,
  type BookingInterval,
  type BookingPriceMode,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { cancelByTrigger, enrollByTrigger } from '../services/reminder-trigger.js';
import { canTransition, nextStatus, type BookingAction } from '../services/booking-state.js';
import { getAccountTimeZone, getAvailability, tzDateStr, tzHHMM } from '../services/availability.js';
import {
  enqueueCalendarDeleteOperation,
  removeBookingFromGoogle,
  runCalendarDeleteOperation,
  syncConfirmedBookingToGoogle,
  verifyStaffCalendarConnection,
} from '../services/booking-calendar-sync.js';
import {
  completeIdempotencyResponse,
  findIdempotencyResponse,
  reserveIdempotencyResponse,
  saveIdempotencyResponse,
} from '../services/booking-idempotency.js';
import { sendBookingNotification } from '../services/booking-notifier.js';
import { dispatchOperatorEvent } from '../services/operator-notification-dispatch.js';
import {
  buildConfirmationReminderSchedule,
  insertConfirmationReminders,
} from '../services/booking-confirm.js';
import { attachTagAndFireSideEffects } from '../services/friend-tag-attach.js';
import {
  DEFAULT_ACCOUNT_SETTINGS,
  IDEMPOTENCY_TTL_MINUTES,
  type BookingStatus,
} from '../services/booking-types.js';
import { awardActivityMileage } from '../services/activity-mileage.js';
import { dispatchAutomationEventWithLogging } from '../services/automation-triggers.js';
import { applyActionScoreEvent } from '../services/action-score-events.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import {
  finishBookingOperation,
  listBookingOperations,
  queueBookingOperation,
} from '../services/booking-operation-runs.js';
import {
  getBookingAdminDetail,
  getBookingCustomerContext,
} from '../services/booking-admin-detail.js';

const booking = new Hono<Env>();
const BOOKING_CONFIRMED_AUTOMATION_EVENT = 'calendar_booked' as const;

// 管理画面の予約APIはすべて account_id を受け取る。認証済みでも、URLだけを
// 書き換えて担当外のLINEアカウントを読んだり更新したりできないよう、個別の
// handlerへ入る前に共通で所属範囲を確認する。account_id 未指定の400は各
// handlerが従来どおり返すため、ここでは指定された場合だけを検査する。
booking.use('/api/booking/admin/*', async (c, next) => {
  const accountId = c.req.query('account_id');
  if (accountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ error: 'forbidden_account' }, 403);
  }
  return next();
});

function googleCredentials(env: Env['Bindings']) {
  return {
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  };
}

type BookingConflictSource = 'internal_booking' | 'google_calendar' | 'schedule';

function minuteOfDay(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function isValidShiftDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isClockTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isValidTimeRange(start: unknown, end: unknown): boolean {
  return isClockTime(start) && isClockTime(end) && minuteOfDay(start) < minuteOfDay(end);
}

/**
 * 確定直前の枠照合。
 *
 * 要求された instant と、いま計算し直した候補の `startUtc` が同じ瞬間で
 * あることだけを見る。壁時刻（YYYY-MM-DD + HH:MM）の突合は使わない。
 * 夏時間の終わる日は同じ壁時刻が2回現れるので、01:30 で照合すると
 * 「空いている方の 01:30」で「埋まっている方の 01:30」を通してしまう。
 *
 * `startUtc` が無い・読めない候補は一致とみなさない（fail-closed）。
 * 壊れた候補を素通りさせると、営業時間外・休業例外・Google の予定を
 * 迂回して予約が入る。
 */
function findLatestSlotForInstant(
  slots: Array<{ startUtc?: string | null }> | undefined,
  startsAt: Date,
): { startUtc?: string | null } | null {
  const wantedMs = startsAt.getTime();
  if (!Number.isFinite(wantedMs)) return null;
  for (const slot of slots ?? []) {
    const raw = slot?.startUtc;
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const slotMs = new Date(raw).getTime();
    if (!Number.isFinite(slotMs)) continue;
    if (slotMs === wantedMs) return slot;
  }
  return null;
}

/**
 * 要求 instant を店舗タイムゾーンで読み直し、その暦日の候補と突き合わせる。
 * 取得範囲は前後 1 日を含める。UTC より進んだ／遅れた店舗では、要求の
 * instant が隣の暦日に落ちることがあるため。
 */
async function reverifyLatestSlot(
  db: D1Database,
  env: Env['Bindings'],
  input: {
    lineAccountId: string;
    menuId: string;
    staffId: string;
    startsAt: Date;
    minLeadTimeMinutes: number;
  },
): Promise<boolean> {
  const timeZone = await getAccountTimeZone(db, input.lineAccountId);
  const date = tzDateStr(timeZone, input.startsAt);
  const latest = await getAvailability(db, {
    lineAccountId: input.lineAccountId,
    menuId: input.menuId,
    staffId: input.staffId,
    from: date,
    to: date,
    now: new Date(),
    minLeadTimeMinutes: input.minLeadTimeMinutes,
    googleCredentials: googleCredentials(env),
  });
  const slots = latest.by_staff.find((item) => item.staff_id === input.staffId)?.slots;
  return findLatestSlotForInstant(slots, input.startsAt) !== null;
}

async function bookingConflictAlternatives(
  db: D1Database,
  env: Env['Bindings'],
  input: {
    lineAccountId: string;
    menuId: string;
    staffId: string;
    startsAt: Date;
    durationMinutes: number;
  },
) {
  const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
  // 代替候補も店舗タイムゾーンで並べる。+09:00 固定だと NY 店舗で
  // 「別の日の・別の時刻の枠」を代わりとして出してしまう。
  const timeZone = await getAccountTimeZone(db, input.lineAccountId);
  const date = tzDateStr(timeZone, input.startsAt);
  const time = tzHHMM(timeZone, input.startsAt);
  const wantedMs = input.startsAt.getTime();
  const [overlap, availability] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS count, MIN(starts_at) AS conflict_from,
              MAX(block_ends_at) AS conflict_to
         FROM bookings
        WHERE line_account_id = ? AND staff_id = ?
          AND status IN ('requested', 'confirmed')
          AND starts_at < ? AND block_ends_at > ?`,
    ).bind(
      input.lineAccountId,
      input.staffId,
      endsAt.toISOString(),
      input.startsAt.toISOString(),
    ).first<{ count: number; conflict_from: string | null; conflict_to: string | null }>(),
    getAvailability(db, {
      lineAccountId: input.lineAccountId,
      menuId: input.menuId,
      from: date,
      to: date,
      now: new Date(),
      minLeadTimeMinutes: 0,
      googleCredentials: googleCredentials(env),
    }),
  ]);
  const selected = availability.by_staff.find((item) => item.staff_id === input.staffId);
  // 「同じ時刻」は instant で見る。fold 日は壁時刻 01:30 が2回あるため、
  // 壁時刻だけで拾うと要求とは別の瞬間の枠を「同じ時刻の代わり」に出す。
  const isRequestedInstant = (slot: { startUtc?: string | null }): boolean => {
    const raw = slot?.startUtc;
    if (typeof raw !== 'string' || raw.trim() === '') return false;
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) && ms === wantedMs;
  };
  const nearbySlots = [...(selected?.slots ?? [])]
    .filter((slot) => slot.date === date && !isRequestedInstant(slot))
    .sort((a, b) => Math.abs(minuteOfDay(a.start) - minuteOfDay(time)) - Math.abs(minuteOfDay(b.start) - minuteOfDay(time)))
    .slice(0, 3);
  const alternateStaff = availability.by_staff
    .filter((item) => item.staff_id !== input.staffId)
    .filter((item) => item.slots.some(isRequestedInstant))
    .slice(0, 3)
    .map((item) => ({
      staffId: item.staff_id,
      displayName: item.display_name,
      slot: item.slots.find(isRequestedInstant)!,
    }));
  const count = Number(overlap?.count ?? 0);
  const source: BookingConflictSource = count > 0 ? 'internal_booking'
    : selected ? 'google_calendar' : 'schedule';
  return {
    conflict: {
      from: overlap?.conflict_from ?? input.startsAt.toISOString(),
      to: overlap?.conflict_to ?? endsAt.toISOString(),
      count: Math.max(1, count),
      source,
    },
    nearbySlots,
    alternateStaff,
  };
}

// ----------------------------------------------------------------
// Helpers

const JST_OFFSET_MS = 9 * 3600_000;

function startsAtJst(utcIso: string): string {
  const jst = new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

// UTC [start, end) bounds covering a JST calendar day (YYYY-MM-DD in JST).
// The JST day runs [date 00:00 JST, date+1 00:00 JST) = [date-1 15:00Z, date 15:00Z).
// Used to fetch a staff member's existing bookings for slot computation.
// (Replaces a broken `${date}T-09:00:00.000Z`.replace('-09','00') that corrupted
//  any date string containing '-09'/'-11'/'-12' and dropped JST 00:00-09:00.)
export function jstDayWindowUtc(jstDate: string): { startUtc: string; endUtc: string } {
  return {
    startUtc: new Date(`${jstDate}T00:00:00+09:00`).toISOString(),
    endUtc: `${jstDate}T15:00:00Z`,
  };
}

async function resolveAccountIdFromLiff(c: Context<Env>): Promise<string | null> {
  const liffId = c.req.query('liffId');
  if (!liffId) return null;
  const acc = await c.env.DB
    .prepare(`SELECT id FROM line_accounts WHERE liff_id = ? AND is_active = 1`)
    .bind(liffId)
    .first<{ id: string }>();
  return acc?.id ?? null;
}

// LIFF が送る id_token を LINE Login API で verify し、認証済み LINE userId を返す。
// 失敗時は null（呼び出し側で 401）。
//
// 候補チャンネル ID:
//   1. LINE_LOGIN_CHANNEL_ID env (デフォルトアカウント)
//   2. DB 内 line_accounts.login_channel_id (LINE Login channel)
//   3. DB 内 line_accounts.channel_id (Messaging channel) — LIFF を Login channel
//      ではなく Messaging channel に紐付けてる構成への保険
//   4. id_token の aud claim を base64 デコードして直接抽出 — どの DB 値とも
//      一致しない場合の最後の手段（LIFF が独自に発行する場合）
async function verifyCallerLineUserId(c: Context<Env>): Promise<string | null> {
  const auth = c.req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const idToken = auth.slice('Bearer '.length).trim();
  if (!idToken) return null;

  const candidates: string[] = [];
  const push = (v: string | null | undefined) => {
    if (v && !candidates.includes(v)) candidates.push(v);
  };

  push(c.env.LINE_LOGIN_CHANNEL_ID);
  const dbAccounts = await getLineAccounts(c.env.DB);
  for (const a of dbAccounts) {
    const acc = a as unknown as {
      login_channel_id?: string | null;
      channel_id?: string | null;
      liff_id?: string | null;
    };
    push(acc.login_channel_id);
    push(acc.channel_id);
    // liff_id は "<channel_id>-<random>" 形式
    const liffPrefix = acc.liff_id?.split('-')[0];
    push(liffPrefix);
  }

  // id_token (JWT) の payload を base64url decode して aud を抽出
  // Cloudflare Workers の atob は base64 を扱う。base64url の文字置換が必要。
  try {
    const parts = idToken.split('.');
    if (parts.length === 3) {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const json = JSON.parse(atob(padded));
      if (typeof json.aud === 'string') push(json.aud);
      else if (Array.isArray(json.aud)) for (const a of json.aud) push(String(a));
    }
  } catch {
    /* decode 失敗は無視: 候補 URL のみで verify を試す */
  }

  console.log('[verifyCallerLineUserId] candidates:', candidates.length, candidates.join(','));

  for (const channelId of candidates) {
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (res.ok) {
      const verified = await res.json<{ sub?: string }>();
      if (verified.sub) return verified.sub;
    } else {
      const errBody = await res.text().catch(() => '');
      console.log(
        `[verifyCallerLineUserId] verify fail channel=${channelId} status=${res.status} body=${errBody.slice(0, 200)}`,
      );
    }
  }
  return null;
}

async function resolveAccountIdAdmin(c: Context<Env>): Promise<string | null> {
  return c.req.query('account_id') ?? null;
}

// staff が指定 account に属することを保証する。属していなければ null を返す。
async function assertStaffInAccount(
  db: D1Database,
  staffId: string,
  accountId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM staff WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`)
    .bind(staffId, accountId)
    .first<{ ok: number }>();
  return Boolean(row?.ok);
}

// account-scope な friend 解決。friends.line_account_id が webhook で書き換わる
// マルチアカウント環境で、別 tenant の friend 行を再利用しないようにする。
// line_account_id が NULL の旧データ（multi-account 化前）は account 一致が判定できないので
// 安全側として除外（必要なら個別にバックフィルする）。
async function resolveFriendId(
  c: Context<Env>,
  lineUserId: string,
  accountId: string,
): Promise<string | null> {
  const f = await c.env.DB
    .prepare(
      `SELECT id FROM friends
        WHERE line_user_id = ? AND line_account_id = ?`,
    )
    .bind(lineUserId, accountId)
    .first<{ id: string }>();
  return f?.id ?? null;
}

async function notifyForBooking(
  db: D1Database,
  bookingId: string,
  kind: 'requested' | 'approved' | 'rejected',
  existingOperationId?: string,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT b.starts_at, b.line_account_id,
              m.name AS menu_name,
              s.display_name AS staff_name,
              la.channel_access_token,
              la.channel_access_token_encrypted,
              f.line_user_id
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         INNER JOIN line_accounts la ON la.id = b.line_account_id
         INNER JOIN friends f ON f.id = b.friend_id
        WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first<{
      starts_at: string;
      line_account_id: string;
      menu_name: string;
      staff_name: string;
      channel_access_token: string;
      channel_access_token_encrypted: string | null;
      line_user_id: string;
    }>();
  if (!row) return;
  const operationId = existingOperationId ?? await queueBookingOperation(db, {
    bookingId,
    lineAccountId: row.line_account_id,
    kind: 'confirmation_line',
    idempotencyKey: `${bookingId}:confirmation-line:${kind}`,
    result: { notificationKind: kind },
  });
  try {
    const accessToken = await resolveLineCredential(
      row.channel_access_token_encrypted,
      row.channel_access_token,
      { lineAccountId: row.line_account_id, field: 'channel_access_token' },
    );
    await sendBookingNotification({
      channelAccessToken: accessToken,
      toLineUserId: row.line_user_id,
      kind,
      ctx: {
        menuName: row.menu_name,
        staffName: row.staff_name,
        startsAtJst: startsAtJst(row.starts_at),
        hoursBefore: 0,
      },
    });
    await finishBookingOperation(db, {
      id: operationId,
      status: 'succeeded',
      completedAt: new Date().toISOString(),
      result: { notificationKind: kind, openTracking: 'inbox' },
    });
  } catch (error) {
    await finishBookingOperation(db, {
      id: operationId,
      status: 'permanent_failed',
      completedAt: new Date().toISOString(),
      errorCode: error instanceof Error ? error.name : 'notification_failed',
      result: { notificationKind: kind },
    });
    throw error;
  }
}

// ================================================================
// LIFF endpoints (/api/liff/booking/*)
// ================================================================

booking.get('/api/liff/booking/menus', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, name, category_label, description,
              duration_minutes, buffer_after_minutes,
              base_price, price_mode, sort_order,
              cancel_deadline_hours_before, intake_question
         FROM menus
        WHERE line_account_id = ? AND is_active = 1 AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(accountId)
    .all();
  return c.json({ menus: rows.results });
});

booking.get('/api/liff/booking/menus/:id/staff', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const menuId = c.req.param('id');
  const rows = await c.env.DB
    .prepare(
      `SELECT s.id, s.display_name, s.role, s.profile_image_url, s.bio,
              s.is_designation_optional,
              COALESCE(sm.override_price, m.base_price) AS price,
              m.price_mode,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS duration_minutes
         FROM staff s
         INNER JOIN staff_menus sm ON sm.staff_id = s.id AND sm.menu_id = ?2 AND sm.is_offered = 1
         INNER JOIN menus m ON m.id = ?2
        WHERE s.line_account_id = ?1 AND s.is_active = 1 AND s.deleted_at IS NULL
        ORDER BY s.is_designation_optional DESC, s.sort_order ASC, s.id ASC`,
    )
    .bind(accountId, menuId)
    .all();
  return c.json({ staff: rows.results });
});

booking.get('/api/liff/booking/availability', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const menuId = c.req.query('menu_id');
  const staffId = c.req.query('staff_id') || undefined;
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!menuId || !from || !to) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  if ((toD.getTime() - fromD.getTime()) / 86400_000 > 28) {
    return c.json({ error: 'range_too_wide' }, 400);
  }
  const result = await getAvailability(c.env.DB, {
    lineAccountId: accountId,
    menuId,
    staffId,
    from,
    to,
    now: new Date(),
    minLeadTimeMinutes: DEFAULT_ACCOUNT_SETTINGS.min_lead_time_minutes,
    googleCredentials: googleCredentials(c.env),
  });
  return c.json(result);
});

booking.post('/api/liff/booking/requests', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const idemKey = c.req.header('Idempotency-Key');
  if (!idemKey) return c.json({ error: 'missing_idempotency_key' }, 400);

  // 認証済み caller の LINE userId を Authorization: Bearer <id_token> から取得。
  const callerLineUserId = await verifyCallerLineUserId(c);
  if (!callerLineUserId) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{
    menu_id: string;
    staff_id: string;
    starts_at: string; // UTC ISO8601
    customer_note?: string;
  }>();
  if (!body.menu_id || !body.staff_id || !body.starts_at) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const friendId = await resolveFriendId(c, callerLineUserId, accountId);
  if (!friendId) return c.json({ error: 'friend_not_found' }, 404);

  // Idempotency lookup は account+friend スコープ。同じ key を別 caller が送っても
  // それぞれの caller のキャッシュを返す（=cross-tenant leak 防止）。
  const cached = await findIdempotencyResponse(c.env.DB, {
    key: idemKey,
    lineAccountId: accountId,
    friendId,
    now: new Date(),
  });
  if (cached) {
    return c.json(cached.body as Record<string, unknown>, cached.status as 200 | 201 | 400 | 409 | 422);
  }

  // Block check: customer cannot book
  const friend = await c.env.DB
    .prepare(`SELECT is_following FROM friends WHERE id = ?`)
    .bind(friendId)
    .first<{ is_following: number }>();
  if (!friend || friend.is_following === 0) {
    return c.json({ error: 'cannot_book' }, 403);
  }

  // Menu + staff_menu lookup (must be offered)
  const menuRow = await c.env.DB
    .prepare(
      `SELECT m.id, m.duration_minutes, m.buffer_after_minutes, m.base_price,
              m.auto_tag_id, m.concurrent_capacity,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS dur,
              COALESCE(sm.override_price, m.base_price) AS price,
              sm.is_offered
         FROM menus m
         LEFT JOIN staff_menus sm ON sm.menu_id = m.id AND sm.staff_id = ?2
        WHERE m.id = ?1 AND m.line_account_id = ?3
          AND m.deleted_at IS NULL AND m.is_active = 1`,
    )
    .bind(body.menu_id, body.staff_id, accountId)
    .first<{ duration_minutes: number; buffer_after_minutes: number; auto_tag_id: string | null; concurrent_capacity: number; dur: number; price: number; is_offered: number | null }>();
  if (!menuRow || menuRow.is_offered !== 1) {
    return c.json({ error: 'menu_not_offered' }, 422);
  }

  const startsAt = new Date(body.starts_at);
  if (Number.isNaN(startsAt.getTime())) {
    return c.json({ error: 'invalid_starts_at' }, 422);
  }
  if (startsAt < new Date()) {
    return c.json({ error: 'past_datetime' }, 422);
  }
  const endsAt = new Date(startsAt.getTime() + menuRow.dur * 60_000);
  const blockEndsAt = new Date(endsAt.getTime() + menuRow.buffer_after_minutes * 60_000);

  // Server-side availability 再検証: 曜日受付時間 / Google Calendar /
  // リードタイム / 既存予約を、確定直前にもう一度突合する。
  // 突合は店舗タイムゾーンの暦日で取り直した候補の instant と、要求の
  // instant の完全一致で行う（+09:00 固定の壁時刻照合ではない）。
  const slotMatched = await reverifyLatestSlot(c.env.DB, c.env, {
    lineAccountId: accountId,
    menuId: body.menu_id,
    staffId: body.staff_id,
    startsAt,
    minLeadTimeMinutes: DEFAULT_ACCOUNT_SETTINGS.min_lead_time_minutes,
  });
  if (!slotMatched) return c.json({ error: 'slot_not_available' }, 422);

  const bookingId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  // 競合チェックと INSERT を 1 ステートメントで原子化する。
  // INSERT ... SELECT WHERE NOT EXISTS パターンで、同一スタッフの overlap 行がある場合は
  // 0 行 INSERT に落とす。changes=0 を 409 として扱う。
  const insertResult = await c.env.DB
    .prepare(
      `INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id,
         starts_at, ends_at, block_ends_at, status,
         customer_note, price_at_booking, requested_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?
        WHERE NOT EXISTS (
          -- 別メニューの予約は、定員に関係なく1件でも塞ぐ。
          -- 1対1の施術とグループを同じ時間に入れることはできない。
          SELECT 1 FROM bookings
           WHERE staff_id = ?
             AND status IN ('requested','confirmed')
             AND starts_at < ?
             AND block_ends_at > ?
             AND menu_id != ?
        )
        AND (
          -- 同じメニューは同時受付数まで重ねられる。定員1なら従来と同じ判定になる。
          SELECT COUNT(*) FROM bookings
           WHERE staff_id = ?
             AND status IN ('requested','confirmed')
             AND starts_at < ?
             AND block_ends_at > ?
             AND menu_id = ?
        ) < ?`,
    )
    .bind(
      bookingId,
      accountId,
      friendId,
      body.staff_id,
      body.menu_id,
      startsAt.toISOString(),
      endsAt.toISOString(),
      blockEndsAt.toISOString(),
      'requested' satisfies BookingStatus,
      body.customer_note ?? null,
      menuRow.price,
      nowIso,
      // 別メニューの重なりを見る副問い合わせ
      body.staff_id,
      blockEndsAt.toISOString(),
      startsAt.toISOString(),
      body.menu_id,
      // 同じメニューの件数を数える副問い合わせ
      body.staff_id,
      blockEndsAt.toISOString(),
      startsAt.toISOString(),
      body.menu_id,
      Math.max(1, menuRow.concurrent_capacity ?? 1),
    )
    .run();
  if ((insertResult.meta?.changes ?? 0) === 0) {
    const err = { error: 'slot_conflict' };
    await saveIdempotencyResponse(c.env.DB, {
      key: idemKey,
      lineAccountId: accountId,
      friendId,
      status: 409,
      body: err,
      ttlMinutes: IDEMPOTENCY_TTL_MINUTES,
      now: new Date(),
    });
    return c.json(err, 409);
  }

  c.executionCtx.waitUntil(
    awardActivityMileage(c.env.DB, {
      eventType: 'booking_created',
      source: 'booking',
      sourceEventId: bookingId,
      friendId,
      metadata: { bookingType: 'salon', menuId: body.menu_id, staffId: body.staff_id },
      occurredAt: nowIso,
    }),
  );
  c.executionCtx.waitUntil(
    applyActionScoreEvent(c.env.DB, {
      lineAccountId: accountId,
      friendId,
      eventType: 'booking_created',
      source: 'booking',
      sourceEventId: bookingId,
      subjectKey: body.menu_id,
      occurredAt: nowIso,
    }).catch((error) => console.error('booking action score failed:', error)),
  );

  // 予約をきっかけにするリマインダへ登録する。通知やタグ付与と同じく
  // 予約成功は左右しない。リマインダが登録できなかったからといって
  // 予約そのものを失敗させるのは筋が違う。
  c.executionCtx.waitUntil(
    enrollByTrigger(c.env.DB, {
      triggerType: 'booking',
      friendId,
      startsAtIso: startsAt.toISOString(),
      sourceId: bookingId,
      sourceEventId: bookingId,
      lineAccountId: accountId,
    }).catch((err) => console.error('reminder enroll (booking) failed:', err)),
  );

  // Fire-and-forget notification — failures must not roll back the booking.
  c.executionCtx.waitUntil(
    notifyForBooking(c.env.DB, bookingId, 'requested').catch((err) =>
      console.error('booking notify (requested) failed:', err),
    ),
  );

  // 予約が入ったことを運用者へ知らせる。これも他の副作用と同じ扱いで、
  // 通知が落ちても予約は成立させる。発生元に予約IDを使うので、同じ予約から
  // 通知が二重に作られることはない。送り残しは回収口から拾う。
  c.executionCtx.waitUntil(
    dispatchOperatorEvent(c.env.DB, c.env, {
      lineAccountId: accountId,
      eventType: 'booking_created',
      sourceEventId: bookingId,
      message: '新しい予約が入りました',
      executionMode: 'automatic',
    }).catch((err) => console.error('booking operator notification failed:', err)),
  );

  // notifyForBooking と同じく fire-and-forget。タグ付与失敗は予約成功扱い。
  // attachTagAndFireSideEffects は POST /api/friends/:id/tags と同じ side effects
  // (tag_added シナリオ enrollment + tag_change イベント) を発火する。
  // INSERT OR IGNORE で重複を吸収し、新規付与のときだけ side effects を打つ。
  //
  // 設定した時点で active でも、予約が入る時点では整理済み(archived)になっている
  // ことがある。メニューに残っている auto_tag_id をそのまま信じず、付与の直前に
  // アカウントと status='active' を引き直す。外れていれば付与も後続副作用も打たない
  // (整理済みのタグが友だちに付き、シナリオ・イベントまで動いてしまうのを止める)。
  if (menuRow.auto_tag_id) {
    const tagId = menuRow.auto_tag_id;
    c.executionCtx.waitUntil(
      (async () => {
        if (!(await isAssignableAutoTag(c.env.DB, tagId, accountId))) {
          console.warn(JSON.stringify({
            event: 'booking_auto_tag_skipped',
            reason: 'tag_not_active_in_account',
            tag_id: tagId,
            line_account_id: accountId,
            booking_id: bookingId,
          }));
          return;
        }
        await attachTagAndFireSideEffects(c.env.DB, friendId, tagId, {
          defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
          workerUrl: c.env.WORKER_URL,
        });
      })().catch((err) => console.error('booking auto-tag failed:', err)),
    );
  }

  const responseBody = { booking_id: bookingId, status: 'requested' };
  await saveIdempotencyResponse(c.env.DB, {
    key: idemKey,
    lineAccountId: accountId,
    friendId,
    status: 201,
    body: responseBody,
    ttlMinutes: IDEMPOTENCY_TTL_MINUTES,
    now: new Date(),
  });
  return c.json(responseBody, 201);
});

booking.get('/api/liff/booking/me', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  // 履歴も idToken 検証必須。query の lineUserId に頼ると他人の履歴を覗けてしまう。
  const callerLineUserId = await verifyCallerLineUserId(c);
  if (!callerLineUserId) return c.json({ error: 'unauthorized' }, 401);
  const friendId = await resolveFriendId(c, callerLineUserId, accountId);
  if (!friendId) return c.json({ upcoming: [], past: [] });

  const upcoming = await c.env.DB
    .prepare(
      `SELECT b.id, b.starts_at, b.status, b.customer_note,
              m.name AS menu_name,
              s.display_name AS staff_name, s.profile_image_url
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
        WHERE b.friend_id = ? AND b.line_account_id = ?
          AND b.status IN ('requested','confirmed')
          AND b.starts_at >= ?
        ORDER BY b.starts_at ASC`,
    )
    .bind(friendId, accountId, new Date().toISOString())
    .all();

  const past = await c.env.DB
    .prepare(
      `SELECT b.id, b.starts_at, b.status,
              m.name AS menu_name,
              s.display_name AS staff_name, s.profile_image_url
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
        WHERE b.friend_id = ? AND b.line_account_id = ?
          AND (b.status NOT IN ('requested','confirmed') OR b.starts_at < ?)
        ORDER BY b.starts_at DESC
        LIMIT 50`,
    )
    .bind(friendId, accountId, new Date().toISOString())
    .all();

  return c.json({ upcoming: upcoming.results, past: past.results });
});

// ================================================================
// Admin endpoints (/api/booking/admin/*)
// authMiddleware enforces staff/owner auth at index.ts level.
// All endpoints require ?account_id= query.
// ================================================================

// ---- Booking customers (LINE未連携の電話客) ----

booking.get('/api/booking/admin/customers', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  try {
    const customers = await searchBookingCustomers(c.env.DB, {
      lineAccountId: accountId,
      query: c.req.query('q'),
      encryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
    });
    return c.json({ customers });
  } catch (error) {
    console.error('GET /api/booking/admin/customers error:', error instanceof Error ? error.name : 'unknown');
    return c.json({ error: 'customer_data_unavailable' }, 503);
  }
});

booking.get('/api/booking/admin/customers/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  try {
    const customer = await getBookingCustomer(
      c.env.DB,
      c.req.param('id'),
      accountId,
      c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
    );
    return customer
      ? c.json({ customer })
      : c.json({ error: 'booking_customer_not_found' }, 404);
  } catch (error) {
    console.error('GET /api/booking/admin/customers/:id error:', error instanceof Error ? error.name : 'unknown');
    return c.json({ error: 'customer_data_unavailable' }, 503);
  }
});

booking.post(
  '/api/booking/admin/customers',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const accountId = await resolveAccountIdAdmin(c);
    if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
    const body = await c.req.json<{
      display_name?: string;
      phone?: string;
      pet_name?: string | null;
      email?: string | null;
    }>();
    if (!body.display_name || !body.phone) {
      return c.json({ error: 'missing_customer_fields' }, 400);
    }
    try {
      const customer = await createBookingCustomer(c.env.DB, {
        id: crypto.randomUUID(),
        lineAccountId: accountId,
        displayName: body.display_name,
        phone: body.phone,
        petName: body.pet_name,
        email: body.email,
        encryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
      });
      return c.json({ customer }, 201);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code.startsWith('booking_customer_') && code.endsWith('_invalid')) {
        return c.json({ error: code }, 422);
      }
      console.error('POST /api/booking/admin/customers error:', error instanceof Error ? error.name : 'unknown');
      return c.json({ error: 'customer_data_unavailable' }, 503);
    }
  },
);

// ---- Menus CRUD ----

const BOOKING_EXCEPTION_KINDS = new Set<BookingExceptionKind>(['closed', 'custom_hours', 'open']);
const BOOKING_EXCEPTION_SCOPES = new Set<BookingExceptionScope>(['store', 'staff', 'resource']);
const BOOKING_PRICE_MODES = new Set<BookingPriceMode>(['fixed', 'free', 'inquiry']);

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readBookingIntervals(raw: unknown): { ok: true; value: BookingInterval[] } | { ok: false } {
  if (!Array.isArray(raw) || raw.length > 8) return { ok: false };
  const intervals: BookingInterval[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false };
    const value = item as Record<string, unknown>;
    const start = typeof value.start === 'string' ? value.start : '';
    const end = typeof value.end === 'string' ? value.end : '';
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) || start >= end) {
      return { ok: false };
    }
    intervals.push({ start, end });
  }
  intervals.sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 1; index < intervals.length; index++) {
    if (intervals[index - 1].end > intervals[index].start) return { ok: false };
  }
  return { ok: true, value: intervals };
}

function readBookingException(input: Record<string, unknown>):
  | {
    ok: true;
    value: {
      scopeKind: BookingExceptionScope;
      scopeId: string | null;
      dateFrom: string;
      dateTo: string;
      kind: BookingExceptionKind;
      intervals: BookingInterval[];
      reason: string | null;
    };
  }
  | { ok: false; error: string } {
  const scopeKind = String(input.scopeKind ?? '');
  const kind = String(input.kind ?? '');
  const dateFrom = typeof input.dateFrom === 'string' ? input.dateFrom : '';
  const dateTo = typeof input.dateTo === 'string' ? input.dateTo : '';
  const rawScopeId = typeof input.scopeId === 'string' ? input.scopeId.trim() : '';
  const reason = input.reason == null ? null : typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!BOOKING_EXCEPTION_SCOPES.has(scopeKind as BookingExceptionScope)) {
    return { ok: false, error: 'scopeKindが正しくありません' };
  }
  if ((scopeKind === 'store' && rawScopeId) || (scopeKind !== 'store' && !rawScopeId)) {
    return { ok: false, error: '対象とscopeIdの組み合わせが正しくありません' };
  }
  if (!isCalendarDate(dateFrom) || !isCalendarDate(dateTo) || dateFrom > dateTo) {
    return { ok: false, error: '例外日の期間が正しくありません' };
  }
  if (!BOOKING_EXCEPTION_KINDS.has(kind as BookingExceptionKind)) {
    return { ok: false, error: '例外日の種類が正しくありません' };
  }
  if (reason !== null && (!reason || reason.length > 200)) {
    return { ok: false, error: '理由は200文字以内で指定してください' };
  }
  const intervals = readBookingIntervals(input.intervals);
  if (!intervals.ok || (kind === 'closed' && intervals.value.length > 0)
    || (kind !== 'closed' && intervals.value.length === 0)) {
    return { ok: false, error: '営業時間は重ならない正しい時刻で指定してください' };
  }
  return {
    ok: true,
    value: {
      scopeKind: scopeKind as BookingExceptionScope,
      scopeId: scopeKind === 'store' ? null : rawScopeId,
      dateFrom,
      dateTo,
      kind: kind as BookingExceptionKind,
      intervals: intervals.value,
      reason,
    },
  };
}

function readPriceModeAndAmount(input: { price_mode?: unknown; base_price?: unknown }):
  | { ok: true; priceMode: BookingPriceMode; basePrice: number }
  | { ok: false; error: string } {
  const priceMode = String(input.price_mode ?? 'fixed') as BookingPriceMode;
  if (!BOOKING_PRICE_MODES.has(priceMode)) {
    return { ok: false, error: 'price_mode must be fixed, free, or inquiry' };
  }
  if (priceMode !== 'fixed') return { ok: true, priceMode, basePrice: 0 };
  const basePrice = Number(input.base_price);
  if (!Number.isInteger(basePrice) || basePrice < 0 || basePrice > 100_000_000) {
    return { ok: false, error: 'base_price must be an integer between 0 and 100000000' };
  }
  return { ok: true, priceMode, basePrice };
}

booking.get('/api/booking/admin/settings', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ success: false, error: 'missing_account_id' }, 400);
  try {
    const settings = await getBookingAdminSettings(c.env.DB, accountId);
    if (!settings) return c.json({ success: false, error: 'not_found' }, 404);
    return c.json({ success: true, data: settings });
  } catch {
    console.error(JSON.stringify({ event: 'booking_settings_read_failed' }));
    return c.json({ success: false, error: 'booking_settings_unavailable' }, 503);
  }
});

booking.get('/api/booking/admin/resources', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ success: false, error: 'missing_account_id' }, 400);
  try {
    const resources = await listBookingAdminResources(c.env.DB, accountId);
    return c.json({ success: true, data: { resources } });
  } catch {
    console.error(JSON.stringify({ event: 'booking_resources_read_failed' }));
    return c.json({ success: false, error: 'booking_resources_unavailable' }, 503);
  }
});

booking.get('/api/booking/admin/exceptions', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ success: false, error: 'missing_account_id' }, 400);
  try {
    const items = await listBookingAvailabilityExceptions(c.env.DB, accountId);
    return c.json({ success: true, data: { items } });
  } catch {
    console.error(JSON.stringify({ event: 'booking_exceptions_read_failed' }));
    return c.json({ success: false, error: 'booking_exceptions_unavailable' }, 503);
  }
});

booking.post('/api/booking/admin/exceptions', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ success: false, error: 'missing_account_id' }, 400);
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ success: false, error: 'invalid_json' }, 400);
    const parsed = readBookingException(body);
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    const item = await createBookingAvailabilityException(c.env.DB, {
      lineAccountId: accountId,
      ...parsed.value,
    });
    if (!item) return c.json({ success: false, error: 'scope_not_found' }, 422);
    return c.json({ success: true, data: item }, 201);
  } catch {
    console.error(JSON.stringify({ event: 'booking_exception_create_failed' }));
    return c.json({ success: false, error: 'booking_exception_save_failed' }, 503);
  }
});

booking.patch('/api/booking/admin/exceptions/:id', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ success: false, error: 'missing_account_id' }, 400);
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const expectedVersion = Number(body?.expectedVersion);
    if (!body || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return c.json({ success: false, error: 'expectedVersionは1以上の整数で指定してください' }, 400);
    }
    const current = await getBookingAvailabilityException(c.env.DB, c.req.param('id'), accountId);
    if (!current) return c.json({ success: false, error: 'not_found' }, 404);
    const parsed = readBookingException({
      scopeKind: body.scopeKind ?? current.scopeKind,
      scopeId: Object.prototype.hasOwnProperty.call(body, 'scopeId') ? body.scopeId : current.scopeId,
      dateFrom: body.dateFrom ?? current.dateFrom,
      dateTo: body.dateTo ?? current.dateTo,
      kind: body.kind ?? current.kind,
      intervals: body.intervals ?? current.intervals,
      reason: Object.prototype.hasOwnProperty.call(body, 'reason') ? body.reason : current.reason,
    });
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    const result = await updateBookingAvailabilityException(c.env.DB, {
      id: current.id,
      lineAccountId: accountId,
      expectedVersion,
      ...parsed.value,
    });
    if (result.status === 'not_found') return c.json({ success: false, error: 'not_found' }, 404);
    if (result.status === 'scope_not_found') {
      return c.json({ success: false, error: 'scope_not_found' }, 422);
    }
    if (result.status === 'conflict') {
      return c.json({
        success: false,
        code: 'version_conflict',
        error: '例外日が更新されています。読み直してください',
        data: { currentVersion: result.currentVersion },
      }, 409);
    }
    return c.json({ success: true, data: result.item });
  } catch {
    console.error(JSON.stringify({ event: 'booking_exception_update_failed' }));
    return c.json({ success: false, error: 'booking_exception_save_failed' }, 503);
  }
});

/** 受付条件として画面から送られてくる項目。 */
interface MenuBookingRuleBody {
  concurrent_capacity?: unknown;
  booking_window_days?: unknown;
  cutoff_hours_before?: unknown;
  cancel_deadline_hours_before?: unknown;
  intake_question?: unknown;
}

interface MenuBaseBody {
  name?: unknown;
  duration_minutes?: unknown;
  buffer_after_minutes?: unknown;
  sort_order?: unknown;
}

function readMenuBase(
  body: MenuBaseBody,
): { ok: true; value: { name: string; durationMinutes: number; bufferAfterMinutes: number; sortOrder: number } }
  | { ok: false; error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, error: 'name must not be empty' };
  if (name.length > 200) return { ok: false, error: 'name must be 200 characters or fewer' };

  const durationMinutes = Number(body.duration_minutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1_440) {
    return { ok: false, error: 'duration_minutes must be an integer between 1 and 1440' };
  }
  const bufferAfterMinutes = body.buffer_after_minutes === undefined
    ? 0
    : Number(body.buffer_after_minutes);
  if (!Number.isInteger(bufferAfterMinutes) || bufferAfterMinutes < 0 || bufferAfterMinutes > 1_440) {
    return { ok: false, error: 'buffer_after_minutes must be an integer between 0 and 1440' };
  }
  const sortOrder = body.sort_order === undefined ? 0 : Number(body.sort_order);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
    return { ok: false, error: 'sort_order must be an integer between 0 and 1000000' };
  }
  return { ok: true, value: { name, durationMinutes, bufferAfterMinutes, sortOrder } };
}

/**
 * 受付条件を検証して、DBの列名で返す。送られた項目だけを含める。
 *
 * 上限を置いているのは、桁を間違えた値がそのまま保存されると
 * 「1年先まで予約できてしまう」「一度に999件受けてしまう」といった
 * 形で表に出てくるため。0 や負の値もここで弾く。
 */
function readMenuBookingRules(
  b: MenuBookingRuleBody,
): { ok: true; value: Record<string, number | string | null> } | { ok: false; error: string } {
  const out: Record<string, number | string | null> = {};

  const positiveInt = (
    key: keyof MenuBookingRuleBody,
    column: string,
    max: number,
    { nullable }: { nullable: boolean },
  ): string | null => {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return null;
    const raw = b[key];
    if (raw === null || raw === '' || raw === undefined) {
      if (!nullable) return `${key} must not be empty`;
      out[column] = null;
      return null;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      return `${key} must be an integer between 1 and ${max}`;
    }
    out[column] = n;
    return null;
  };

  // 同時受付数だけは NOT NULL。空にはできず、最低1。
  const errors = [
    positiveInt('concurrent_capacity', 'concurrent_capacity', 100, { nullable: false }),
    positiveInt('booking_window_days', 'booking_window_days', 365, { nullable: true }),
    positiveInt('cutoff_hours_before', 'cutoff_hours_before', 24 * 30, { nullable: true }),
    positiveInt('cancel_deadline_hours_before', 'cancel_deadline_hours_before', 24 * 30, {
      nullable: true,
    }),
  ].filter((e): e is string => e !== null);
  if (errors.length > 0) return { ok: false, error: errors[0] };

  if (Object.prototype.hasOwnProperty.call(b, 'intake_question')) {
    const raw = b.intake_question;
    if (raw === null || raw === '' || raw === undefined) {
      out.intake_question = null;
    } else if (typeof raw !== 'string') {
      return { ok: false, error: 'intake_question must be a string' };
    } else if (raw.length > 200) {
      return { ok: false, error: 'intake_question must be 200 characters or fewer' };
    } else {
      out.intake_question = raw.trim();
    }
  }

  return { ok: true, value: out };
}

booking.get('/api/booking/admin/menus', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  try {
    const [rows, staffRows, countRows] = await Promise.all([
      c.env.DB.prepare(
        `SELECT m.id, m.name, m.category_label, m.description,
                m.duration_minutes, m.buffer_after_minutes,
                m.base_price, m.price_mode, m.version,
                m.sort_order, m.is_active, m.auto_tag_id,
                m.concurrent_capacity, m.booking_window_days, m.cutoff_hours_before,
                m.cancel_deadline_hours_before, m.intake_question,
                COALESCE(bs.booking_window_days, 60) AS store_booking_window_days,
                COALESCE(bs.cutoff_minutes_before, 1440) AS store_cutoff_minutes_before,
                COALESCE(bs.cancel_deadline_minutes_before, 1440) AS store_cancel_deadline_minutes_before
           FROM menus m
      LEFT JOIN booking_settings bs ON bs.line_account_id = m.line_account_id
          WHERE m.line_account_id = ? AND m.deleted_at IS NULL
          ORDER BY m.sort_order ASC, m.id ASC`,
      )
      .bind(accountId)
      .all<Record<string, unknown>>(),
      c.env.DB.prepare(
        `SELECT sm.menu_id, s.id, s.display_name
           FROM staff_menus sm
           JOIN menus m ON m.id = sm.menu_id
           JOIN staff s ON s.id = sm.staff_id
          WHERE m.line_account_id = ? AND m.deleted_at IS NULL
            AND s.line_account_id = m.line_account_id
            AND s.deleted_at IS NULL AND s.is_active = 1 AND sm.is_offered = 1
          ORDER BY s.sort_order ASC, s.id ASC`,
      ).bind(accountId).all<{ menu_id: string; id: string; display_name: string }>(),
      c.env.DB.prepare(
        `SELECT menu_id, COUNT(*) AS booking_count
           FROM bookings
          WHERE line_account_id = ?
            AND requested_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
          GROUP BY menu_id`,
      ).bind(accountId).all<{ menu_id: string; booking_count: number }>(),
    ]);
    const staffByMenu = new Map<string, Array<{ id: string; display_name: string }>>();
    for (const row of staffRows.results ?? []) {
      const assigned = staffByMenu.get(row.menu_id) ?? [];
      assigned.push({ id: row.id, display_name: row.display_name });
      staffByMenu.set(row.menu_id, assigned);
    }
    const countByMenu = new Map(
      (countRows.results ?? []).map((row) => [row.menu_id, Number(row.booking_count) || 0]),
    );
    return c.json({
      menus: (rows.results ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        category_label: row.category_label,
        description: row.description,
        duration_minutes: row.duration_minutes,
        buffer_after_minutes: row.buffer_after_minutes,
        base_price: row.base_price,
        price_mode: row.price_mode,
        version: row.version,
        sort_order: row.sort_order,
        is_active: row.is_active,
        auto_tag_id: row.auto_tag_id,
        concurrent_capacity: row.concurrent_capacity,
        booking_window_days: row.booking_window_days,
        cutoff_hours_before: row.cutoff_hours_before,
        cancel_deadline_hours_before: row.cancel_deadline_hours_before,
        intake_question: row.intake_question,
        assigned_staff: staffByMenu.get(String(row.id)) ?? [],
        booking_count_30_days: countByMenu.get(String(row.id)) ?? 0,
        effectiveBookingRules: {
          bookingWindowDays: row.booking_window_days ?? row.store_booking_window_days,
          cutoffMinutesBefore: row.cutoff_hours_before == null
            ? row.store_cutoff_minutes_before
            : Number(row.cutoff_hours_before) * 60,
          cancelDeadlineMinutesBefore: row.cancel_deadline_hours_before == null
            ? row.store_cancel_deadline_minutes_before
            : Number(row.cancel_deadline_hours_before) * 60,
          source: {
            bookingWindowDays: row.booking_window_days == null ? 'store' : 'menu',
            cutoffMinutesBefore: row.cutoff_hours_before == null ? 'store' : 'menu',
            cancelDeadlineMinutesBefore: row.cancel_deadline_hours_before == null ? 'store' : 'menu',
          },
        },
      })),
    });
  } catch {
    console.error(JSON.stringify({ event: 'booking_menu_list_failed' }));
    return c.json({ error: 'booking_menu_data_unavailable' }, 503);
  }
});

/**
 * 公開フラグの正規化。画面は 1/0 の数値、他は true/false で送る。
 * どちらも「止める = 0」に倒す。書いていなければ出す(1)側に倒す。
 */
function toMenuActiveFlag(value: unknown): number {
  return value === false || value === 0 ? 0 : 1;
}

type AutoTagIdRead =
  | { ok: true; present: boolean; value: string | null }
  | { ok: false; error: 'invalid_auto_tag_id' };

/**
 * auto_tag_id は「文字列」か「null / 未送信」だけを受け付ける。
 * 数値・真偽値・配列・オブジェクトをそのまま `.trim()` へ流すと TypeError になり、
 * 入力の不備が 500(サーバ障害)として返ってしまう。呼び手が直せる誤りなので
 * ここで型を見て 400 に倒す。
 *
 * PUT は「送られた項目だけ更新する」ため、未送信(`present: false`)と
 * 明示的な null(`present: true, value: null`)を呼び出し側で区別できるようにする。
 */
function readAutoTagId(body: Record<string, unknown>): AutoTagIdRead {
  if (!Object.prototype.hasOwnProperty.call(body, 'auto_tag_id')) {
    return { ok: true, present: false, value: null };
  }
  const raw = body.auto_tag_id;
  if (raw === null || raw === undefined) return { ok: true, present: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_auto_tag_id' };
  const trimmed = raw.trim();
  return { ok: true, present: true, value: trimmed === '' ? null : trimmed };
}

/**
 * 自動タグとして結び付けてよいタグかを、対象アカウント内かつ status='active' で確かめる。
 *
 * 整理済み(archived)のタグを受け付けると、二度と使わないタグへメニューが繋がったままになり、
 * 予約のたびに「付いたはずのタグで絞り込めない」状態を作る。保存時(POST/PUT)と
 * 実行時(予約成立時)の両方でここを通し、設定した後に整理されたタグも止める。
 */
async function isAssignableAutoTag(
  db: D1Database,
  tagId: string,
  accountId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM tags WHERE id = ? AND line_account_id = ? AND status = 'active'`)
    .bind(tagId, accountId)
    .first<{ 1: number }>();
  return row != null;
}

booking.post('/api/booking/admin/menus', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const b = await c.req.json<{
    name: string;
    category_label?: string | null;
    description?: string | null;
    duration_minutes: number;
    buffer_after_minutes?: number;
    base_price?: number;
    price_mode?: BookingPriceMode;
    sort_order?: number;
    auto_tag_id?: string | null;
    is_active?: boolean | number;
  } & MenuBookingRuleBody>();
  const base = readMenuBase(b);
  if (!base.ok) return c.json({ error: base.error }, 400);
  const rules = readMenuBookingRules(b);
  if (!rules.ok) return c.json({ error: rules.error }, 400);
  const hasPriceMode = Object.prototype.hasOwnProperty.call(b, 'price_mode');
  const price = readPriceModeAndAmount(hasPriceMode ? b : {
    price_mode: 'fixed', base_price: b.base_price,
  });
  if (!price.ok) return c.json({ error: price.error }, 400);
  const autoTag = readAutoTagId(b as unknown as Record<string, unknown>);
  if (!autoTag.ok) return c.json({ error: autoTag.error }, 400);
  const autoTagId = autoTag.value;
  if (autoTagId && !(await isAssignableAutoTag(c.env.DB, autoTagId, accountId))) {
    return c.json({ error: 'tag_not_found' }, 400);
  }
  const id = crypto.randomUUID();
  const ruleColumns = Object.keys(rules.value);
  await c.env.DB
    .prepare(
      // 受付条件は送られたものだけを列に足す。送られなければ既定値
      // （従来と同じ動き）が入る。
      `INSERT INTO menus
        (id, line_account_id, name, category_label, description,
         duration_minutes, buffer_after_minutes, base_price, price_mode, sort_order, auto_tag_id, is_active${
           ruleColumns.map((col) => `, ${col}`).join('')
         })
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?${ruleColumns.map(() => ',?').join('')})`,
    )
    .bind(
      id,
      accountId,
      base.value.name,
      b.category_label ?? null,
      b.description ?? null,
      base.value.durationMinutes,
      base.value.bufferAfterMinutes,
      price.basePrice,
      price.priceMode,
      base.value.sortOrder,
      autoTagId,
      toMenuActiveFlag(b.is_active),
      ...ruleColumns.map((col) => rules.value[col]),
    )
    .run();
  return c.json({ id, version: 1 }, 201);
});

booking.put('/api/booking/admin/menus/:id', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  const b = await c.req.json<{
    name: string;
    category_label?: string | null;
    description?: string | null;
    duration_minutes: number;
    buffer_after_minutes?: number;
    base_price: number;
    price_mode?: BookingPriceMode;
    sort_order?: number;
    is_active?: boolean | number;
    auto_tag_id?: string | null;
  } & MenuBookingRuleBody>();

  const base = readMenuBase(b);
  if (!base.ok) return c.json({ error: base.error }, 400);

  const rules = readMenuBookingRules(b);
  if (!rules.ok) return c.json({ error: rules.error }, 400);
  const hasPriceMode = Object.prototype.hasOwnProperty.call(b, 'price_mode');
  const price = readPriceModeAndAmount(hasPriceMode ? b : {
    price_mode: 'fixed', base_price: b.base_price,
  });
  if (!price.ok) return c.json({ error: price.error }, 400);

  // 古いクライアントは新しい項目を送らない。`undefined` を null として
  // 書き込むと既存設定を消してしまうので、明示的に送られたものだけ更新する。
  // auto_tag_id が以前からこの扱いで、受付条件も同じにそろえた。
  const autoTag = readAutoTagId(b as unknown as Record<string, unknown>);
  if (!autoTag.ok) return c.json({ error: autoTag.error }, 400);
  const hasAutoTagId = autoTag.present;
  const autoTagId = autoTag.value;
  if (hasAutoTagId && autoTagId && !(await isAssignableAutoTag(c.env.DB, autoTagId, accountId))) {
    return c.json({ error: 'tag_not_found' }, 400);
  }

  // 常に書き込む項目（PUT なので、送られなければ既定値で上書きする）
  const sets: string[] = [
    'name = ?',
    'category_label = ?',
    'description = ?',
    'duration_minutes = ?',
    'buffer_after_minutes = ?',
    'base_price = ?',
    'sort_order = ?',
    'is_active = ?',
  ];
  const values: unknown[] = [
    base.value.name,
    b.category_label ?? null,
    b.description ?? null,
    base.value.durationMinutes,
    base.value.bufferAfterMinutes,
    price.basePrice,
    base.value.sortOrder,
    toMenuActiveFlag(b.is_active),
  ];
  if (hasPriceMode) {
    sets.push('price_mode = ?');
    values.push(price.priceMode);
  }
  if (hasAutoTagId) {
    sets.push('auto_tag_id = ?');
    values.push(autoTagId);
  }
  for (const [column, value] of Object.entries(rules.value)) {
    sets.push(`${column} = ?`);
    values.push(value);
  }

  await c.env.DB
    .prepare(
      `UPDATE menus
          SET ${sets.join(', ')},
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND line_account_id = ?`,
    )
    .bind(...values, id, accountId)
    .run();
  return c.json({ ok: true });
});

booking.patch('/api/booking/admin/menus/:id', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ success: false, error: 'missing_account_id' }, 400);
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const expectedVersion = Number(body?.expectedVersion);
    if (!body || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return c.json({ success: false, error: 'expectedVersionは1以上の整数で指定してください' }, 400);
    }
    const hasPriceMode = Object.prototype.hasOwnProperty.call(body, 'price_mode');
    const hasBasePrice = Object.prototype.hasOwnProperty.call(body, 'base_price');
    let priceMode: BookingPriceMode | undefined;
    let basePrice: number | undefined;
    if (hasPriceMode) {
      const rawMode = String(body.price_mode) as BookingPriceMode;
      if (!BOOKING_PRICE_MODES.has(rawMode)) {
        return c.json({ success: false, error: 'price_mode must be fixed, free, or inquiry' }, 400);
      }
      priceMode = rawMode;
      if (rawMode !== 'fixed') basePrice = 0;
    }
    if (hasBasePrice && priceMode !== 'free' && priceMode !== 'inquiry') {
      const amount = Number(body.base_price);
      if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) {
        return c.json({ success: false, error: 'base_price must be an integer between 0 and 100000000' }, 400);
      }
      basePrice = amount;
    }
    const rules = readMenuBookingRules(body);
    if (!rules.ok) return c.json({ success: false, error: rules.error }, 400);
    // 公開切替だけの更新(一覧の「止める・出す」)も版付きで受ける。
    // 数値 1/0 と真偽値のどちらも受け、止める側(0/false)に倒す。
    let isActive: boolean | undefined;
    if (Object.prototype.hasOwnProperty.call(body, 'is_active')) {
      const rawActive = body.is_active;
      if (rawActive === true || rawActive === 1) isActive = true;
      else if (rawActive === false || rawActive === 0) isActive = false;
      else {
        return c.json({ success: false, error: 'is_active は true/false または 1/0 で指定してください' }, 400);
      }
    }
    const result = await updateBookingMenuSettings(c.env.DB, {
      id: c.req.param('id'),
      lineAccountId: accountId,
      expectedVersion,
      priceMode,
      basePrice,
      isActive,
      bookingWindowDays: rules.value.booking_window_days as number | null | undefined,
      cutoffHoursBefore: rules.value.cutoff_hours_before as number | null | undefined,
      cancelDeadlineHoursBefore: rules.value.cancel_deadline_hours_before as number | null | undefined,
    });
    if (result.status === 'no_changes') {
      return c.json({ success: false, error: '更新する項目を指定してください' }, 400);
    }
    if (result.status === 'not_found') return c.json({ success: false, error: 'not_found' }, 404);
    if (result.status === 'conflict') {
      return c.json({
        success: false,
        code: 'version_conflict',
        error: '予約メニューが更新されています。読み直してください',
        data: { currentVersion: result.currentVersion },
      }, 409);
    }
    return c.json({ success: true, data: { id: c.req.param('id'), version: result.version } });
  } catch {
    console.error(JSON.stringify({ event: 'booking_menu_settings_update_failed' }));
    return c.json({ success: false, error: 'booking_menu_save_failed' }, 503);
  }
});

booking.delete('/api/booking/admin/menus/:id', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  await c.env.DB
    .prepare(
      `UPDATE menus
          SET deleted_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND line_account_id = ?`,
    )
    .bind(id, accountId)
    .run();
  return c.json({ ok: true });
});

// ---- Staff CRUD ----

// Admin mirror of the LIFF menu-staff lookup — used by the iOS app's
// proxy-booking flow (operator books on behalf of a friend from chat).
booking.get('/api/booking/admin/menus/:id/staff', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const menuId = c.req.param('id');
  const rows = await c.env.DB
    .prepare(
      `SELECT s.id, s.display_name, s.role, s.profile_image_url, s.bio,
              s.is_designation_optional,
              COALESCE(sm.override_price, m.base_price) AS price,
              m.price_mode,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS duration_minutes
         FROM staff s
         INNER JOIN staff_menus sm ON sm.staff_id = s.id AND sm.menu_id = ?2 AND sm.is_offered = 1
         INNER JOIN menus m ON m.id = ?2
        WHERE s.line_account_id = ?1 AND s.is_active = 1 AND s.deleted_at IS NULL
        ORDER BY s.is_designation_optional DESC, s.sort_order ASC, s.id ASC`,
    )
    .bind(accountId, menuId)
    .all();
  return c.json({ staff: rows.results });
});

// Admin mirror of the LIFF availability lookup. minLeadTimeMinutes is 0:
// the operator is on the phone with the customer and may book a slot
// starting within the lead-time window that customers themselves cannot.
booking.get('/api/booking/admin/customer-context', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const friendId = c.req.query('friend_id')?.trim() || null;
  const bookingCustomerId = c.req.query('booking_customer_id')?.trim() || null;
  if ((!friendId && !bookingCustomerId) || (friendId && bookingCustomerId)) {
    return c.json({ error: 'missing_customer' }, 400);
  }
  const customer = await getBookingCustomerContext(c.env.DB, {
    lineAccountId: accountId,
    friendId,
    bookingCustomerId,
  });
  if (!customer) return c.json({ error: 'customer_not_found' }, 404);
  return c.json({ customer });
});

booking.get('/api/booking/admin/reminder-preview', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const startsAt = new Date(c.req.query('starts_at') ?? '');
  if (Number.isNaN(startsAt.getTime())) return c.json({ error: 'invalid_starts_at' }, 400);
  return c.json({
    reminders: buildConfirmationReminderSchedule({ startsAt, now: new Date() }),
  });
});

booking.get('/api/booking/admin/bookings/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const bookingDetail = await getBookingAdminDetail(c.env.DB, {
    id: c.req.param('id'),
    lineAccountId: accountId,
  });
  if (!bookingDetail) return c.json({ error: 'booking_not_found' }, 404);
  return c.json({ booking: bookingDetail });
});

booking.get('/api/booking/admin/alternatives', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const menuId = c.req.query('menu_id')?.trim();
  const staffId = c.req.query('staff_id')?.trim();
  const startsAt = new Date(c.req.query('starts_at') ?? '');
  if (!menuId || !staffId || Number.isNaN(startsAt.getTime())) {
    return c.json({ error: 'missing_params' }, 400);
  }
  if (!await assertStaffInAccount(c.env.DB, staffId, accountId)) {
    return c.json({ error: 'staff_not_found' }, 404);
  }
  const menu = await c.env.DB.prepare(
    `SELECT COALESCE(sm.override_duration_minutes, m.duration_minutes) AS duration_minutes
       FROM menus m
       LEFT JOIN staff_menus sm ON sm.menu_id = m.id AND sm.staff_id = ?
      WHERE m.id = ? AND m.line_account_id = ? AND m.deleted_at IS NULL
        AND m.is_active = 1 AND sm.is_offered = 1`,
  ).bind(staffId, menuId, accountId).first<{ duration_minutes: number }>();
  if (!menu) return c.json({ error: 'menu_not_offered' }, 404);
  return c.json(await bookingConflictAlternatives(c.env.DB, c.env, {
    lineAccountId: accountId,
    menuId,
    staffId,
    startsAt,
    durationMinutes: Number(menu.duration_minutes),
  }));
});

booking.get('/api/booking/admin/availability', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const menuId = c.req.query('menu_id');
  const staffId = c.req.query('staff_id') || undefined;
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!menuId || !from || !to) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  if ((toD.getTime() - fromD.getTime()) / 86400_000 > 28) {
    return c.json({ error: 'range_too_wide' }, 400);
  }
  const result = await getAvailability(c.env.DB, {
    lineAccountId: accountId,
    menuId,
    staffId,
    from,
    to,
    now: new Date(),
    minLeadTimeMinutes: 0,
    googleCredentials: googleCredentials(c.env),
  });
  return c.json(result);
});

// Proxy booking: the operator creates a CONFIRMED booking on behalf of a
// friend, straight from the iOS chat screen. Same shift/slot/conflict
// validation as the LIFF flow, but NO min-lead-time check (the operator
// may book a slot starting sooner than customers are allowed to).
booking.post('/api/booking/admin/bookings', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const idemKey = c.req.header('Idempotency-Key')?.trim();
  if (!idemKey) return c.json({ error: 'missing_idempotency_key' }, 400);
  const body = await c.req.json<{
    friend_id?: string;
    booking_customer_id?: string;
    menu_id: string;
    staff_id: string;
    starts_at: string; // UTC ISO8601
    customer_note?: string;
    send_line_confirmation?: boolean;
  }>();
  const friendInput = body.friend_id?.trim() || null;
  const customerInput = body.booking_customer_id?.trim() || null;
  if (
    (!friendInput && !customerInput)
    || (friendInput && customerInput)
    || !body.menu_id
    || !body.staff_id
    || !body.starts_at
  ) {
    return c.json({ error: 'missing_params' }, 400);
  }

  let friendId: string | null = null;
  let bookingCustomerId: string | null = null;
  if (friendInput) {
    const friend = await c.env.DB
      .prepare(`SELECT id, is_following FROM friends WHERE id = ? AND line_account_id = ?`)
      .bind(friendInput, accountId)
      .first<{ id: string; is_following: number }>();
    if (!friend) return c.json({ error: 'friend_not_found' }, 404);
    if (friend.is_following === 0) return c.json({ error: 'cannot_book' }, 403);
    friendId = friend.id;
  } else {
    const customer = await c.env.DB
      .prepare(
        `SELECT id, friend_id FROM booking_customers
          WHERE id = ? AND line_account_id = ?`,
      )
      .bind(customerInput, accountId)
      .first<{ id: string; friend_id: string | null }>();
    if (!customer) return c.json({ error: 'booking_customer_not_found' }, 404);
    bookingCustomerId = customer.id;
    friendId = customer.friend_id;
    if (friendId) {
      const friend = await c.env.DB
        .prepare(`SELECT is_following FROM friends WHERE id = ? AND line_account_id = ?`)
        .bind(friendId, accountId)
        .first<{ is_following: number }>();
      if (!friend || friend.is_following === 0) return c.json({ error: 'cannot_book' }, 403);
    }
  }
  if (!friendId && body.send_line_confirmation === true) {
    return c.json({ error: 'line_notification_unavailable' }, 422);
  }
  const sendLineConfirmation = Boolean(friendId) && body.send_line_confirmation !== false;
  const idempotencySubject = friendId ?? `booking-customer:${bookingCustomerId}`;

  const cached = await findIdempotencyResponse(c.env.DB, {
    key: idemKey,
    lineAccountId: accountId,
    friendId: idempotencySubject,
    now: new Date(),
  });
  if (cached) {
    if (cached.status !== 202) {
      return c.json(
        cached.body as Record<string, unknown>,
        cached.status as 200 | 201 | 400 | 409 | 422,
      );
    }
    const pendingBookingId = (cached.body as { booking_id?: unknown }).booking_id;
    if (typeof pendingBookingId === 'string') {
      const created = await c.env.DB
        .prepare(
          `SELECT id, status, external_event_id FROM bookings
            WHERE id = ? AND line_account_id = ?
              AND ((? IS NOT NULL AND friend_id = ?)
                OR (? IS NOT NULL AND booking_customer_id = ?))`,
        )
        .bind(
          pendingBookingId,
          accountId,
          friendId,
          friendId,
          bookingCustomerId,
          bookingCustomerId,
        )
        .first<{ id: string; status: string; external_event_id: string | null }>();
      if (created) {
        return c.json({
          booking_id: created.id,
          booking_customer_id: bookingCustomerId,
          status: created.status,
          calendar_sync: created.external_event_id ? 'synced' : 'pending',
          line_notification: sendLineConfirmation ? 'scheduled' : 'not_applicable',
          replayed: true,
        }, 201);
      }
    }
    return c.json({ error: 'request_in_progress' }, 409);
  }

  // staff が同じ account に属することを保証（別 tenant の staff への予約を防ぐ）。
  if (!(await assertStaffInAccount(c.env.DB, body.staff_id, accountId))) {
    return c.json({ error: 'staff_not_found' }, 404);
  }

  const menuRow = await c.env.DB
    .prepare(
      `SELECT m.id, m.duration_minutes, m.buffer_after_minutes, m.base_price,
              m.concurrent_capacity,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS dur,
              COALESCE(sm.override_price, m.base_price) AS price,
              sm.is_offered
         FROM menus m
         LEFT JOIN staff_menus sm ON sm.menu_id = m.id AND sm.staff_id = ?2
        WHERE m.id = ?1 AND m.line_account_id = ?3
          AND m.deleted_at IS NULL AND m.is_active = 1`,
    )
    .bind(body.menu_id, body.staff_id, accountId)
    .first<{ duration_minutes: number; buffer_after_minutes: number; concurrent_capacity: number; dur: number; price: number; is_offered: number | null }>();
  if (!menuRow || menuRow.is_offered !== 1) {
    return c.json({ error: 'menu_not_offered' }, 422);
  }

  const startsAt = new Date(body.starts_at);
  if (Number.isNaN(startsAt.getTime())) {
    return c.json({ error: 'invalid_starts_at' }, 422);
  }
  if (startsAt < new Date()) {
    return c.json({ error: 'past_datetime' }, 422);
  }
  const endsAt = new Date(startsAt.getTime() + menuRow.dur * 60_000);
  const blockEndsAt = new Date(endsAt.getTime() + menuRow.buffer_after_minutes * 60_000);

  // Recurring-hours + Google Calendar + internal-booking validation.
  // LIFF と同じ契約で照合する。店舗タイムゾーンの暦日で取り直した候補の
  // instant と、要求の instant が完全に一致したときだけ通す。
  if (!(await reverifyLatestSlot(c.env.DB, c.env, {
    lineAccountId: accountId,
    menuId: body.menu_id,
    staffId: body.staff_id,
    startsAt,
    minLeadTimeMinutes: 0,
  }))) {
    const alternatives = await bookingConflictAlternatives(c.env.DB, c.env, {
      lineAccountId: accountId,
      menuId: body.menu_id,
      staffId: body.staff_id,
      startsAt,
      durationMinutes: menuRow.dur,
    });
    return c.json({ error: 'slot_not_available', data: alternatives }, 409);
  }

  const bookingId = crypto.randomUUID();
  const reserved = await reserveIdempotencyResponse(c.env.DB, {
    key: idemKey,
    lineAccountId: accountId,
    friendId: idempotencySubject,
    body: { error: 'request_in_progress', booking_id: bookingId },
    ttlMinutes: IDEMPOTENCY_TTL_MINUTES,
    now: new Date(),
  });
  if (!reserved) {
    const raced = await findIdempotencyResponse(c.env.DB, {
      key: idemKey,
      lineAccountId: accountId,
      friendId: idempotencySubject,
      now: new Date(),
    });
    if (raced && raced.status !== 202) {
      return c.json(
        raced.body as Record<string, unknown>,
        raced.status as 200 | 201 | 400 | 409 | 422,
      );
    }
    return c.json({ error: raced ? 'request_in_progress' : 'idempotency_key_conflict' }, 409);
  }
  const nowIso = new Date().toISOString();
  const notificationPolicy = JSON.stringify({
    send_line_confirmation: sendLineConfirmation,
    day_before: sendLineConfirmation,
    hours_before: sendLineConfirmation,
  });
  const insertResult = await c.env.DB
    .prepare(
      `INSERT INTO bookings
        (id, line_account_id, friend_id, booking_customer_id, staff_id, menu_id,
         starts_at, ends_at, block_ends_at, status,
         customer_note, price_at_booking, requested_at, decided_at,
         source, created_by_staff_id, notification_policy_snapshot)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        WHERE NOT EXISTS (
          -- 別メニューの予約は、定員に関係なく1件でも塞ぐ。
          -- 1対1の施術とグループを同じ時間に入れることはできない。
          SELECT 1 FROM bookings
           WHERE staff_id = ?
             AND status IN ('requested','confirmed')
             AND starts_at < ?
             AND block_ends_at > ?
             AND menu_id != ?
        )
        AND (
          -- 同じメニューは同時受付数まで重ねられる。定員1なら従来と同じ判定になる。
          SELECT COUNT(*) FROM bookings
           WHERE staff_id = ?
             AND status IN ('requested','confirmed')
             AND starts_at < ?
             AND block_ends_at > ?
             AND menu_id = ?
        ) < ?`,
    )
    .bind(
      bookingId,
      accountId,
      friendId,
      bookingCustomerId,
      body.staff_id,
      body.menu_id,
      startsAt.toISOString(),
      endsAt.toISOString(),
      blockEndsAt.toISOString(),
      'confirmed' satisfies BookingStatus,
      body.customer_note ?? null,
      menuRow.price,
      nowIso,
      nowIso,
      bookingCustomerId ? 'phone' : 'operator',
      c.get('staff').id,
      notificationPolicy,
      // 別メニューの重なりを見る副問い合わせ
      body.staff_id,
      blockEndsAt.toISOString(),
      startsAt.toISOString(),
      body.menu_id,
      // 同じメニューの件数を数える副問い合わせ
      body.staff_id,
      blockEndsAt.toISOString(),
      startsAt.toISOString(),
      body.menu_id,
      Math.max(1, menuRow.concurrent_capacity ?? 1),
    )
    .run();
  if ((insertResult.meta?.changes ?? 0) === 0) {
    const alternatives = await bookingConflictAlternatives(c.env.DB, c.env, {
      lineAccountId: accountId,
      menuId: body.menu_id,
      staffId: body.staff_id,
      startsAt,
      durationMinutes: menuRow.dur,
    });
    const response = { error: 'slot_conflict', data: alternatives };
    await completeIdempotencyResponse(c.env.DB, {
      key: idemKey,
      lineAccountId: accountId,
      friendId: idempotencySubject,
      status: 409,
      body: response,
    });
    return c.json(response, 409);
  }

  let confirmationOperationId: string | null = null;
  if (sendLineConfirmation && friendId) {
    await insertConfirmationReminders(c.env.DB, {
      bookingId,
      startsAt,
      now: new Date(),
    });
    c.executionCtx.waitUntil(
      enrollByTrigger(c.env.DB, {
        triggerType: 'booking',
        friendId,
        startsAtIso: startsAt.toISOString(),
        sourceId: bookingId,
        sourceEventId: bookingId,
        lineAccountId: accountId,
      }).catch((err) => console.error('reminder enroll (proxy-create) failed:', err)),
    );
    confirmationOperationId = await queueBookingOperation(c.env.DB, {
      bookingId,
      lineAccountId: accountId,
      kind: 'confirmation_line',
      idempotencyKey: `${bookingId}:confirmation-line:approved`,
      result: { notificationKind: 'approved', openTracking: 'inbox' },
    });
  }
  const googleOperationId = await queueBookingOperation(c.env.DB, {
    bookingId,
    lineAccountId: accountId,
    kind: 'google_calendar',
    idempotencyKey: `${bookingId}:google-calendar:create`,
  });
  let calendarSync: 'not_configured' | 'synced' | 'failed' = 'not_configured';
  try {
    const synced = await syncConfirmedBookingToGoogle(
      c.env.DB,
      googleCredentials(c.env),
      bookingId,
    );
    calendarSync = synced.synced ? 'synced' : 'not_configured';
    await finishBookingOperation(c.env.DB, {
      id: googleOperationId,
      status: synced.synced ? 'succeeded' : 'skipped',
      completedAt: new Date().toISOString(),
      result: { calendarSync },
    });
  } catch (error) {
    calendarSync = 'failed';
    await finishBookingOperation(c.env.DB, {
      id: googleOperationId,
      status: 'retry_wait',
      completedAt: new Date().toISOString(),
      errorCode: error instanceof Error ? error.name : 'calendar_sync_failed',
      result: { calendarSync },
    });
    console.error('Google Calendar sync (proxy-create) failed:', error);
  }
  if (friendId) {
    if (sendLineConfirmation && confirmationOperationId) {
      c.executionCtx.waitUntil(
        notifyForBooking(c.env.DB, bookingId, 'approved', confirmationOperationId).catch((err) =>
          console.error('booking notify (proxy-create) failed:', err),
        ),
      );
    }
    const automationOperationId = await queueBookingOperation(c.env.DB, {
      bookingId,
      lineAccountId: accountId,
      kind: 'automation',
      idempotencyKey: `${bookingId}:automation:calendar-booked`,
      result: { eventType: BOOKING_CONFIRMED_AUTOMATION_EVENT },
    });
    c.executionCtx.waitUntil(
      dispatchAutomationEventWithLogging(c.env.DB, {
        lineAccountId: accountId,
        eventType: 'calendar_booked',
        sourceEventId: bookingId,
        friendId,
        eventData: {
          bookingType: 'salon', bookingId, menuId: body.menu_id, staffId: body.staff_id,
        },
      })
        .then(() => finishBookingOperation(c.env.DB, {
          id: automationOperationId,
          status: 'succeeded',
          completedAt: new Date().toISOString(),
          result: { eventType: BOOKING_CONFIRMED_AUTOMATION_EVENT },
        }))
        .catch(async (error) => {
          await finishBookingOperation(c.env.DB, {
            id: automationOperationId,
            status: 'retry_wait',
            completedAt: new Date().toISOString(),
            errorCode: error instanceof Error ? error.name : 'automation_dispatch_failed',
            result: { eventType: BOOKING_CONFIRMED_AUTOMATION_EVENT },
          });
          throw error;
        })
        .catch((error) => console.error('booking automation event failed:', error)),
    );
  }
  const [reminderRows, operationRows, customerContext] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, kind, scheduled_at, sent_at, status
         FROM booking_reminders WHERE booking_id = ? ORDER BY scheduled_at ASC`,
    ).bind(bookingId).all<{
      id: string; kind: string; scheduled_at: string; sent_at: string | null; status: string;
    }>(),
    listBookingOperations(c.env.DB, { bookingId, lineAccountId: accountId }),
    getBookingCustomerContext(c.env.DB, {
      lineAccountId: accountId,
      friendId,
      bookingCustomerId,
    }),
  ]);
  const response = {
    booking_id: bookingId,
    booking_customer_id: bookingCustomerId,
    status: 'confirmed',
    calendar_sync: calendarSync,
    line_notification: sendLineConfirmation ? 'queued' : 'not_applicable',
    reminders: (reminderRows.results ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      scheduled_at: row.scheduled_at,
      sent_at: row.sent_at,
      status: row.status,
    })),
    operations: operationRows,
    customer_context: customerContext,
  };
  await completeIdempotencyResponse(c.env.DB, {
    key: idemKey,
    lineAccountId: accountId,
    friendId: idempotencySubject,
    status: 201,
    body: response,
  });
  return c.json(response, 201);
});

booking.get('/api/booking/admin/staff', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, name, display_name, role, profile_image_url, bio,
              sort_order, is_designation_optional, is_active
         FROM staff
        WHERE line_account_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(accountId)
    .all();
  return c.json({ staff: rows.results });
});

booking.post('/api/booking/admin/staff', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const b = await c.req.json<{
    name: string;
    display_name: string;
    role?: string | null;
    profile_image_url?: string | null;
    bio?: string | null;
    sort_order?: number;
    is_designation_optional?: boolean;
  }>();
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO staff
        (id, line_account_id, name, display_name, role, profile_image_url, bio,
         sort_order, is_designation_optional)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      accountId,
      b.name,
      b.display_name,
      b.role ?? null,
      b.profile_image_url ?? null,
      b.bio ?? null,
      b.sort_order ?? 0,
      b.is_designation_optional ? 1 : 0,
    )
    .run();
  return c.json({ id }, 201);
});

booking.put('/api/booking/admin/staff/:id', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  const b = await c.req.json<{
    name: string;
    display_name: string;
    role?: string | null;
    profile_image_url?: string | null;
    bio?: string | null;
    sort_order?: number;
    is_designation_optional?: boolean;
    is_active?: boolean;
  }>();
  await c.env.DB
    .prepare(
      `UPDATE staff
          SET name = ?, display_name = ?, role = ?, profile_image_url = ?, bio = ?,
              sort_order = ?, is_designation_optional = ?, is_active = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND line_account_id = ?`,
    )
    .bind(
      b.name,
      b.display_name,
      b.role ?? null,
      b.profile_image_url ?? null,
      b.bio ?? null,
      b.sort_order ?? 0,
      b.is_designation_optional ? 1 : 0,
      b.is_active === false ? 0 : 1,
      id,
      accountId,
    )
    .run();
  return c.json({ ok: true });
});

booking.delete('/api/booking/admin/staff/:id', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  await c.env.DB
    .prepare(
      `UPDATE staff
          SET deleted_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND line_account_id = ?`,
    )
    .bind(id, accountId)
    .run();
  return c.json({ ok: true });
});

// ---- staff_menus matrix ----

booking.get('/api/booking/admin/staff/:id/menus', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const rows = await c.env.DB
    .prepare(
      `SELECT m.id AS menu_id, m.name,
              COALESCE(sm.is_offered, 0) AS is_offered,
              sm.override_duration_minutes,
              sm.override_price
         FROM menus m
         LEFT JOIN staff_menus sm ON sm.staff_id = ?2 AND sm.menu_id = m.id
        WHERE m.line_account_id = ?1 AND m.deleted_at IS NULL
        ORDER BY m.sort_order ASC`,
    )
    .bind(accountId, staffId)
    .all();
  return c.json({ matrix: rows.results });
});

booking.put('/api/booking/admin/staff/:id/menus', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const b = await c.req.json<{
    menus: Array<{
      menu_id: string;
      is_offered: boolean;
      override_duration_minutes?: number | null;
      override_price?: number | null;
    }>;
  }>();
  // menu_id も同 account のものに限定。account 外の menu_id は無視。
  const validMenuIds = new Set(
    (
      await c.env.DB
        .prepare(`SELECT id FROM menus WHERE line_account_id = ? AND deleted_at IS NULL`)
        .bind(accountId)
        .all<{ id: string }>()
    ).results.map((r) => r.id),
  );
  await c.env.DB.prepare(`DELETE FROM staff_menus WHERE staff_id = ?`).bind(staffId).run();
  const filtered = b.menus.filter((m) => validMenuIds.has(m.menu_id));
  if (filtered.length > 0) {
    const stmts = filtered.map((m) =>
      c.env.DB
        .prepare(
          `INSERT INTO staff_menus
            (staff_id, menu_id, is_offered, override_duration_minutes, override_price)
           VALUES (?,?,?,?,?)`,
        )
        .bind(
          staffId,
          m.menu_id,
          m.is_offered ? 1 : 0,
          m.override_duration_minutes ?? null,
          m.override_price ?? null,
        ),
    );
    await c.env.DB.batch(stmts);
  }
  return c.json({ ok: true });
});

// ---- shifts ----

booking.get('/api/booking/admin/staff/:id/availability-rules', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const rows = await c.env.DB
    .prepare(
      `SELECT id, weekday, start_time, end_time, is_active
         FROM staff_availability_rules
        WHERE staff_id = ?
        ORDER BY weekday ASC`,
    )
    .bind(staffId)
    .all();
  return c.json({ rules: rows.results });
});

booking.put('/api/booking/admin/staff/:id/availability-rules', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const body = await c.req.json<{
    rules: Array<{ weekday: number; start_time: string; end_time: string }>;
  }>();
  if (!Array.isArray(body.rules)) return c.json({ error: 'invalid_rules' }, 400);
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const weekdays = new Set<number>();
  for (const rule of body.rules) {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) {
      return c.json({ error: 'invalid_weekday' }, 422);
    }
    if (weekdays.has(rule.weekday)) return c.json({ error: 'duplicate_weekday' }, 422);
    weekdays.add(rule.weekday);
    if (!hhmm.test(rule.start_time) || !hhmm.test(rule.end_time) || rule.start_time >= rule.end_time) {
      return c.json({ error: 'invalid_time_range' }, 422);
    }
  }
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`DELETE FROM staff_availability_rules WHERE staff_id = ?`).bind(staffId),
    ...body.rules.map((rule) =>
      c.env.DB
        .prepare(
          `INSERT INTO staff_availability_rules
            (id, staff_id, weekday, start_time, end_time, is_active)
           VALUES (?, ?, ?, ?, ?, 1)`,
        )
        .bind(crypto.randomUUID(), staffId, rule.weekday, rule.start_time, rule.end_time),
    ),
  ];
  await c.env.DB.batch(statements);
  return c.json({ ok: true, count: body.rules.length });
});

booking.get('/api/booking/admin/staff/:id/google-calendar', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const connection = await c.env.DB
    .prepare(
      `SELECT id, calendar_id, auth_type, is_active, last_verified_at, last_error
         FROM google_calendar_connections
        WHERE line_account_id = ? AND staff_id = ? AND is_active = 1
        LIMIT 1`,
    )
    .bind(accountId, staffId)
    .first();
  return c.json({
    connection,
    service_account: {
      configured: Boolean(
        c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      ),
      email: c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    },
  });
});

booking.put('/api/booking/admin/staff/:id/google-calendar', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const body = await c.req.json<{ calendar_id?: string }>();
  const calendarId = body.calendar_id?.trim();
  if (!calendarId || calendarId.length > 1024 || /[\r\n]/.test(calendarId)) {
    return c.json({ error: 'invalid_calendar_id' }, 422);
  }
  const existing = await c.env.DB
    .prepare(
      `SELECT id FROM google_calendar_connections
        WHERE line_account_id = ? AND staff_id = ? LIMIT 1`,
    )
    .bind(accountId, staffId)
    .first<{ id: string }>();
  const connectionId = existing?.id ?? crypto.randomUUID();
  try {
    await verifyStaffCalendarConnection({
      id: connectionId,
      calendar_id: calendarId,
      auth_type: 'service_account',
      access_token: null,
    }, googleCredentials(c.env));
  } catch (error) {
    console.error('Google Calendar verification failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'google_service_account_not_configured' ? 503 : 422;
    return c.json({ error: status === 503 ? 'service_account_not_configured' : 'calendar_not_accessible' }, status);
  }
  const now = new Date().toISOString();
  if (existing) {
    await c.env.DB
      .prepare(
        `UPDATE google_calendar_connections
            SET calendar_id = ?, auth_type = 'service_account', is_active = 1,
                last_verified_at = ?, last_error = NULL, updated_at = ?
          WHERE id = ? AND line_account_id = ? AND staff_id = ?`,
      )
      .bind(calendarId, now, now, connectionId, accountId, staffId)
      .run();
  } else {
    await c.env.DB
      .prepare(
        `INSERT INTO google_calendar_connections
          (id, calendar_id, line_account_id, staff_id, auth_type, is_active,
           last_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'service_account', 1, ?, ?, ?)`,
      )
      .bind(connectionId, calendarId, accountId, staffId, now, now, now)
      .run();
  }
  return c.json({ ok: true, calendar_id: calendarId, last_verified_at: now });
});

booking.delete('/api/booking/admin/staff/:id/google-calendar', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  await c.env.DB
    .prepare(
      `UPDATE google_calendar_connections
          SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE line_account_id = ? AND staff_id = ? AND is_active = 1`,
    )
    .bind(accountId, staffId)
    .run();
  return c.json({ ok: true });
});

booking.get('/api/booking/admin/staff/:id/shifts', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const from = c.req.query('from');
  const to = c.req.query('to');
  const sql = from && to
    ? `SELECT id, work_date, start_time, end_time
         FROM staff_shifts
        WHERE staff_id = ? AND work_date BETWEEN ? AND ?
        ORDER BY work_date ASC`
    : `SELECT id, work_date, start_time, end_time
         FROM staff_shifts
        WHERE staff_id = ?
        ORDER BY work_date ASC`;
  const stmt = c.env.DB.prepare(sql);
  const rows = await (from && to ? stmt.bind(staffId, from, to) : stmt.bind(staffId)).all();
  return c.json({ shifts: rows.results });
});

booking.put('/api/booking/admin/staff/:id/shifts', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const b = await c.req.json<{
    shifts?: Array<{ work_date: string; start_time: string; end_time: string }>;
  }>().catch(() => null);
  if (!b || !Array.isArray(b.shifts)) return c.json({ error: 'shifts_must_be_an_array' }, 400);
  if (b.shifts.length > 366) return c.json({ error: 'too_many_shifts' }, 400);
  const invalid = b.shifts.find((shift) => (
    !isValidShiftDate(shift.work_date)
    || !isValidTimeRange(shift.start_time, shift.end_time)
  ));
  if (invalid) return c.json({ error: 'invalid_shift_date_or_time' }, 400);

  const statements = b.shifts.map((s) => (
    c.env.DB.prepare(
        `INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(staff_id, work_date) DO UPDATE
            SET start_time = excluded.start_time,
                end_time = excluded.end_time,
                updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`,
      )
      .bind(crypto.randomUUID(), staffId, s.work_date, s.start_time, s.end_time)
  ));
  if (statements.length > 0) await c.env.DB.batch(statements);
  return c.json({ ok: true, count: b.shifts.length });
});

booking.delete('/api/booking/admin/staff/:id/shifts/:shiftId', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const shiftId = c.req.param('shiftId');
  await c.env.DB
    .prepare(`DELETE FROM staff_shifts WHERE id = ? AND staff_id = ?`)
    .bind(shiftId, staffId)
    .run();
  return c.json({ ok: true });
});

booking.post('/api/booking/admin/staff/:id/shifts/generate', requireRole('owner', 'admin'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const b = await c.req.json<{
    from_date?: unknown;
    weeks?: unknown;
    weekly_template?: Record<
      'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat',
      { start: string; end: string } | null
    >;
  }>().catch(() => null);
  if (!b || !isValidShiftDate(b.from_date) || !Number.isInteger(b.weeks)
    || Number(b.weeks) < 1 || Number(b.weeks) > 12 || !b.weekly_template
    || typeof b.weekly_template !== 'object' || Array.isArray(b.weekly_template)) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const weeklyTemplate = b.weekly_template;
  const dayKeys: Array<keyof typeof weeklyTemplate> = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  for (const day of dayKeys) {
    const template = weeklyTemplate[day];
    if (template !== null && template !== undefined
      && (!template || typeof template !== 'object'
        || !isValidTimeRange(template.start, template.end))) {
      return c.json({ error: 'invalid_weekly_template' }, 400);
    }
  }
  const start = new Date(`${b.from_date}T00:00:00Z`);
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < Number(b.weeks) * 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const tpl = weeklyTemplate[dayKeys[d.getUTCDay()]];
    if (!tpl) continue;
    stmts.push(
      c.env.DB
        .prepare(
          `INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(staff_id, work_date) DO NOTHING`,
        )
        .bind(crypto.randomUUID(), staffId, d.toISOString().slice(0, 10), tpl.start, tpl.end),
    );
  }
  if (stmts.length === 0) return c.json({ inserted: 0 });
  await c.env.DB.batch(stmts);
  return c.json({ inserted: stmts.length });
});

// ---- Bookings (requests) ----

booking.get('/api/booking/admin/requests', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const status = c.req.query('status') || 'requested';
  const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query('limit') || '50', 10) || 50));
  const offset = Math.max(0, Number.parseInt(c.req.query('offset') || '0', 10) || 0);
  const conditions = ['b.line_account_id = ?'];
  const values: unknown[] = [accountId];
  if (status !== 'all') { conditions.push('b.status = ?'); values.push(status); }
  const customerQuery = c.req.query('query')?.trim();
  if (customerQuery) {
    conditions.push("LOWER(COALESCE(f.display_name, bc.display_name, '')) LIKE ? ESCAPE '\\'");
    values.push(`%${customerQuery.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
  }
  const menuName = c.req.query('menu_name')?.trim();
  if (menuName) { conditions.push('m.name = ?'); values.push(menuName); }
  const from = c.req.query('from')?.trim();
  const to = c.req.query('to')?.trim();
  if (from) { conditions.push('b.starts_at >= ?'); values.push(from); }
  if (to) { conditions.push('b.starts_at < ?'); values.push(to); }
  const joins = `FROM bookings b
    INNER JOIN menus m ON m.id = b.menu_id
    INNER JOIN staff s ON s.id = b.staff_id
    LEFT JOIN friends f ON f.id = b.friend_id
    LEFT JOIN booking_customers bc ON bc.id = b.booking_customer_id`;
  const where = `WHERE ${conditions.join(' AND ')}`;
  const [rows, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT b.*, m.name AS menu_name, s.display_name AS staff_name,
              COALESCE(f.display_name, bc.display_name) AS friend_name,
              bc.phone_last4 AS customer_phone_last4,
              bc.pet_name AS customer_pet_name,
              CASE WHEN f.id IS NULL THEN 0 ELSE 1 END AS is_line_linked
         ${joins} ${where}
        ORDER BY b.starts_at ASC LIMIT ? OFFSET ?`,
    ).bind(...values, limit, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS total ${joins} ${where}`)
      .bind(...values).first<{ total: number }>(),
  ]);
  return c.json({ requests: rows.results, total: Number(count?.total ?? 0), limit, offset });
});

booking.get('/api/booking/admin/requests-summary', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const thisMonth = c.req.query('month') || '';
  const lastMonth = c.req.query('last_month') || '';
  const today = c.req.query('today') || '';
  const weekTo = c.req.query('week_to') || '';
  const totals = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'requested' THEN 1 ELSE 0 END) AS requested,
            SUM(CASE WHEN substr(datetime(starts_at, '+9 hours'), 1, 7) = ? THEN 1 ELSE 0 END) AS month_total,
            SUM(CASE WHEN substr(datetime(starts_at, '+9 hours'), 1, 7) = ? AND status = 'confirmed' THEN 1 ELSE 0 END) AS month_confirmed,
            SUM(CASE WHEN substr(datetime(starts_at, '+9 hours'), 1, 7) = ? AND status IN ('cancelled','rejected','no_show') THEN 1 ELSE 0 END) AS month_cancelled,
            SUM(CASE WHEN substr(datetime(starts_at, '+9 hours'), 1, 7) = ? THEN 1 ELSE 0 END) AS last_month_total,
            SUM(CASE WHEN date(datetime(starts_at, '+9 hours')) = ? THEN 1 ELSE 0 END) AS today_total,
            SUM(CASE WHEN date(datetime(starts_at, '+9 hours')) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS week_total
       FROM bookings WHERE line_account_id = ?`,
  ).bind(thisMonth, thisMonth, thisMonth, lastMonth, today, today, weekTo, accountId).first<Record<string, number>>();
  const byMenu = await c.env.DB.prepare(
    `SELECT m.name, COUNT(*) AS total FROM bookings b
       INNER JOIN menus m ON m.id = b.menu_id
      WHERE b.line_account_id = ? GROUP BY m.id, m.name`,
  ).bind(accountId).all<{ name: string; total: number }>();
  return c.json({
    total: Number(totals?.total ?? 0), requested: Number(totals?.requested ?? 0),
    monthTotal: Number(totals?.month_total ?? 0), monthConfirmed: Number(totals?.month_confirmed ?? 0),
    monthCancelled: Number(totals?.month_cancelled ?? 0), lastMonthTotal: Number(totals?.last_month_total ?? 0),
    todayTotal: Number(totals?.today_total ?? 0), weekTotal: Number(totals?.week_total ?? 0),
    byMenu: byMenu.results.map((row) => ({ name: row.name, total: Number(row.total) })),
  });
});

/**
 * 旧表 (booking_reminders) の未送信を止める。
 *
 * 再送でも同じ結果になるよう1文にまとめ、本線と再送枝の両方から呼ぶ。
 * 一時失敗の 'failed' も止める: 取消ずみの予約は送らないため、'pending' だけ
 * 止めると管理画面に未取消の予定が残り続ける (expirer も両方止めている)。
 * V6 fence の成功後にだけ呼ぶ (409 では旧表も含めて巻き戻す)。
 */
async function cancelLegacyBookingReminders(db: D1Database, bookingId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE booking_reminders SET status='cancelled'
        WHERE booking_id = ? AND status IN ('pending', 'failed')`,
    )
    .bind(bookingId)
    .run();
}

booking.patch('/api/booking/admin/requests/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  const b = await c.req.json<{ action: BookingAction }>();
  const row = await c.env.DB
    .prepare(
      `SELECT id, status, starts_at, friend_id, menu_id, staff_id, decided_at
         FROM bookings WHERE id = ? AND line_account_id = ?`,
    )
    .bind(id, accountId)
    .first<{
      id: string;
      status: BookingStatus;
      starts_at: string;
      friend_id: string;
      menu_id: string;
      staff_id: string;
      decided_at: string | null;
    }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  // 再試行の受付: V6 取消が投げた直後の再送は、業務が済みでも V6 だけ直す (409 にしない)。
  // Calendar 削除も同じ鍵の台帳で再試行する (ずみなら触らず、一時失敗なら再実行)。
  // 却下ずみの再送も受け付ける (却下は終端のため通常遷移では 409 になる)。
  const isCancelRetry =
    (b.action === 'cancel' || b.action === 'expire') &&
    (row.status === 'cancelled' || row.status === 'expired');
  const isRejectRetry = b.action === 'reject' && row.status === 'rejected';
  if (isCancelRetry || isRejectRetry) {
    try {
      await cancelByTrigger(c.env.DB, {
        triggerType: 'booking',
        sourceId: id,
        sourceEventId: id,
        friendId: row.friend_id,
        startsAtIso: row.starts_at,
        lineAccountId: accountId,
        cancelReason: `booking_${row.status}:${id}:by:${c.get('staff')?.id ?? 'admin'}-retry`,
        failOnSendInFlight: true,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'REMINDER_SEND_IN_FLIGHT') {
        return c.json({ error: 'send_in_flight_retry' }, 409);
      }
      throw error;
    }
    // 却下では Calendar 予定を作らないため削除の再試行は要らない。
    if (isCancelRetry) {
      // 初回の途中失敗で旧表だけ未取消のまま残ることがある。同じ取消要求の
      // 再送でそろえる (V6 fence 成功後なので 409 で巻き戻す物は無い)。
      await cancelLegacyBookingReminders(c.env.DB, id);
      // 台帳行が durable に残るまで成功応答しない。enqueue の DB 失敗は
      // 落とさず投げ (連続失敗でも台帳なし200にしない)、再送で回復する。
      // 行さえあれば実行の一時失敗は retry_wait に残り cron が拾う。
      await enqueueCalendarDeleteOperation(c.env.DB, { bookingId: id, lineAccountId: accountId });
      await runCalendarDeleteOperation(c.env.DB, {
        bookingId: id,
        lineAccountId: accountId,
        remove: () => removeBookingFromGoogle(c.env.DB, googleCredentials(c.env), id),
      });
    }
    return c.json({ status: row.status });
  }
  if (!canTransition(row.status, b.action)) {
    return c.json({ error: 'invalid_transition' }, 409);
  }
  const next = nextStatus(row.status, b.action);
  // 条件付き UPDATE: 同時 PATCH の race を防ぐ。changes=0 のときは別オペレータが先に
  // 状態を変えたので 409 を返し、副作用（reminders 作成・通知）は走らせない。
  const updateResult = await c.env.DB
    .prepare(
      `UPDATE bookings SET status = ?, decided_at = ?,
                            updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND status = ?`,
    )
    .bind(next, new Date().toISOString(), id, row.status)
    .run();
  if ((updateResult.meta?.changes ?? 0) === 0) {
    return c.json({ error: 'concurrent_update' }, 409);
  }

  if (next === 'confirmed') {
    await insertConfirmationReminders(c.env.DB, {
      bookingId: id,
      startsAt: new Date(row.starts_at),
      now: new Date(),
    });
    try {
      await syncConfirmedBookingToGoogle(c.env.DB, googleCredentials(c.env), id);
    } catch (error) {
      console.error('Google Calendar sync (approve) failed:', error);
    }
    c.executionCtx.waitUntil(
      notifyForBooking(c.env.DB, id, 'approved').catch((err) =>
        console.error('booking notify (approved) failed:', err),
      ),
    );
    c.executionCtx.waitUntil(
      dispatchAutomationEventWithLogging(c.env.DB, {
        lineAccountId: accountId,
        eventType: 'calendar_booked',
        sourceEventId: id,
        friendId: row.friend_id,
        eventData: {
          bookingType: 'salon', bookingId: id, menuId: row.menu_id, staffId: row.staff_id,
        },
      })
        .catch((error) => console.error('booking automation event failed:', error)),
    );
  } else if (next === 'rejected') {
    // N-065: 却下でも V6 の未送信予定は止める (通知だけでは送り続ける)。
    // 送信権の貸出中は 409 で再試行させる (取消確定後の送信を起こさない)。
    try {
      await cancelByTrigger(c.env.DB, {
        triggerType: 'booking',
        sourceId: id,
        sourceEventId: id,
        friendId: row.friend_id,
        startsAtIso: row.starts_at,
        lineAccountId: accountId,
        cancelReason: `booking_rejected:${id}:by:${c.get('staff')?.id ?? 'admin'}`,
        failOnSendInFlight: true,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'REMINDER_SEND_IN_FLIGHT') {
        // 状態更新を巻き戻して 409 にする。貸出中の送信は確定ずみの予約への
        // 送信になるため正当で、再試行は巻き戻し後の状態から再開する。
        // 巻き戻しが 0 件 (同時更新あり) なら相手の処理に任せる。
        await c.env.DB
          .prepare(
            `UPDATE bookings SET status = ?, decided_at = ?,
                                  updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
              WHERE id = ? AND status = ?`,
          )
          .bind(row.status, row.decided_at, id, next)
          .run();
        return c.json({ error: 'send_in_flight_retry' }, 409);
      }
      throw error;
    }
    c.executionCtx.waitUntil(
      notifyForBooking(c.env.DB, id, 'rejected').catch((err) =>
        console.error('booking notify (rejected) failed:', err),
      ),
    );
  } else if (next === 'cancelled' || next === 'expired') {
    // N-065: V6 の未送信予定だけを止める。送信済み履歴は残す。
    // 旧表の取消は V6 fence 成功の後に回す: fence の 409 では旧表も
    // 含めて完全 rollback する (先に止めると巻き戻せない)。
    // 送信権の貸出中は状態更新を巻き戻して 409 にする
    // (取消確定後の送信を起こさない)。
    try {
      await cancelByTrigger(c.env.DB, {
        triggerType: 'booking',
        sourceId: id,
        sourceEventId: id,
        friendId: row.friend_id,
        startsAtIso: row.starts_at,
        lineAccountId: accountId,
        cancelReason: `booking_${next}:${id}:by:${c.get('staff')?.id ?? 'admin'}`,
        failOnSendInFlight: true,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'REMINDER_SEND_IN_FLIGHT') {
        // 状態更新を巻き戻して 409 にする (却下分岐と同趣旨)。
        await c.env.DB
          .prepare(
            `UPDATE bookings SET status = ?, decided_at = ?,
                                  updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
              WHERE id = ? AND status = ?`,
          )
          .bind(row.status, row.decided_at, id, next)
          .run();
        return c.json({ error: 'send_in_flight_retry' }, 409);
      }
      throw error;
    }
    await cancelLegacyBookingReminders(c.env.DB, id);
    // Calendar 削除は台帳駆動 (安定キーで1行)。V6 の fence 成功後に登録する:
    // 送信権の貸出中で巻き戻した 409 の後に queued 行が残ると、cron が確定
    // ずみの予約の予定を消してしまう。登録の失敗は落とさず投げる
    // (取消再試行で回復できる)。一時失敗は retry_wait に残し、
    // 次の取消再試行で同じ鍵で再実行する。
    // 却下では Calendar 予定を作らないため登録しない。
    await enqueueCalendarDeleteOperation(c.env.DB, { bookingId: id, lineAccountId: accountId });
    c.executionCtx.waitUntil(
      runCalendarDeleteOperation(c.env.DB, {
        bookingId: id,
        lineAccountId: accountId,
        remove: () => removeBookingFromGoogle(c.env.DB, googleCredentials(c.env), id),
      }).catch((error) => console.error('Google Calendar delete failed:', error)),
    );
  }

  return c.json({ status: next });
});

// Pending count for sidebar badge.
booking.get('/api/booking/admin/pending-count', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const row = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS cnt FROM bookings
        WHERE line_account_id = ? AND status = 'requested'`,
    )
    .bind(accountId)
    .first<{ cnt: number }>();
  return c.json({ count: row?.cnt ?? 0 });
});

export default booking;
