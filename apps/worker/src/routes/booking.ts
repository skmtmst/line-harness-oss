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
import { getLineAccounts } from '@line-crm/db';
import type { Env } from '../index.js';
import { canTransition, nextStatus, type BookingAction } from '../services/booking-state.js';
import { computeSlots, getAvailability } from '../services/availability.js';
import {
  findIdempotencyResponse,
  saveIdempotencyResponse,
} from '../services/booking-idempotency.js';
import { sendBookingNotification } from '../services/booking-notifier.js';
import { insertConfirmationReminders } from '../services/booking-confirm.js';
import { GoogleCalendarClient } from '../services/google-calendar.js';
import {
  attachTagAndFireSideEffects,
  fireTagAddedSideEffects,
} from '../services/friend-tag-attach.js';
import { syncBookingFriendProfile } from '../services/booking-friend-sync.js';
import {
  DEFAULT_BOOKING_FORM_FIELDS,
  DEFAULT_BOOKING_MESSAGES,
  getBookingFormFields,
  getBookingMessage,
  getBookingSettings,
  isWithinReceptionWindow,
  type BookingFormField,
  type BookingManagementSettings,
} from '../services/booking-settings.js';
import {
  DEFAULT_ACCOUNT_SETTINGS,
  IDEMPOTENCY_TTL_MINUTES,
  type BookingStatus,
} from '../services/booking-types.js';

const booking = new Hono<Env>();

// ----------------------------------------------------------------
// Helpers

const JST_OFFSET_MS = 9 * 3600_000;

const DEFAULT_CONSENT = {
  title: '注意事項・利用規約',
  body: `【ご来店に際しての注意事項】

・15分以上遅刻された場合は、施術をお断りする場合がございます。
・予約の変更・キャンセルは前日の12:00までにご連絡ください。
・当日キャンセル、無断キャンセルは料金の100%を申し受ける場合がございます。
・体調不良や感染症が疑われる場合は、無理をせず事前にご連絡ください。
・ノーメイクでのご来店をおすすめしております。`,
  version: 1,
  is_required: 1,
  is_active: 1,
} as const;

type ConsentSetting = {
  title: string;
  body: string;
  version: number;
  is_required: number;
  is_active: number;
};

async function getConsentSetting(db: D1Database, accountId: string): Promise<ConsentSetting> {
  return (
    await db
      .prepare(
        `SELECT title, body, version, is_required, is_active
           FROM booking_consent_settings
          WHERE line_account_id = ?`,
      )
      .bind(accountId)
      .first<ConsentSetting>()
  ) ?? { ...DEFAULT_CONSENT };
}

function startsAtJst(utcIso: string): string {
  const jst = new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

function bookingRangeForDisplay(startsAt: string, endsAt: string): string {
  const start = new Date(new Date(startsAt).getTime() + JST_OFFSET_MS);
  const end = new Date(new Date(endsAt).getTime() + JST_OFFSET_MS);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[start.getUTCDay()];
  return `${startIso.slice(0, 4)}年${startIso.slice(5, 7)}月${startIso.slice(8, 10)}日(${weekday}) ${startIso.slice(11, 16)}〜${endIso.slice(11, 16)}`;
}

function priceForDisplay(price: number | null): string {
  return price === null ? '料金はスタッフよりご案内します' : `${price.toLocaleString('ja-JP')}円`;
}

function bookingConfirmUrl(liffId: string | null): string {
  if (!liffId) return '';
  const encoded = encodeURIComponent(liffId);
  return `https://liff.line.me/${encoded}/?page=salon-book&liffId=${encoded}&view=history`;
}

function locationBlock(row: {
  location_name: string | null;
  location_address: string | null;
  location_phone: string | null;
  location_access: string | null;
}): string {
  const name = row.location_name ?? 'ご予約店舗';
  const details = [row.location_access, row.location_address, row.location_phone]
    .filter((value): value is string => Boolean(value?.trim()));
  if (details.length === 0) {
    return `アクセスは：${name}\n詳細住所はスタッフよりご案内します。`;
  }
  return [`アクセスは：${name}`, ...details].join('\n');
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

type BookingOptionRow = {
  id: string;
  name: string;
  description: string | null;
  additional_price: number;
  additional_duration_minutes: number;
  sort_order: number;
  is_active: number;
};

function uniqueOptionIds(input: unknown): string[] | null {
  if (input === undefined || input === null || input === '') return [];
  const source = Array.isArray(input) ? input : String(input).split(',');
  const ids = [...new Set(source.map((value) => String(value).trim()).filter(Boolean))];
  if (ids.length > 10 || ids.some((id) => id.length > 100)) return null;
  return ids;
}

async function resolveBookingOptions(
  db: D1Database,
  accountId: string,
  menuId: string,
  locationId: string,
  optionIds: string[],
): Promise<BookingOptionRow[] | null> {
  if (optionIds.length === 0) return [];
  const placeholders = optionIds.map(() => '?').join(',');
  const rows = await db
    .prepare(
      `SELECT bo.id, bo.name, bo.description, bo.additional_price,
              bo.additional_duration_minutes, bo.sort_order, bo.is_active
         FROM booking_options bo
         INNER JOIN booking_option_menus bom
                 ON bom.option_id = bo.id AND bom.menu_id = ?
         INNER JOIN booking_option_locations bol
                 ON bol.option_id = bo.id AND bol.location_id = ?
        WHERE bo.line_account_id = ?
          AND bo.deleted_at IS NULL AND bo.is_active = 1
          AND bo.id IN (${placeholders})
        ORDER BY bo.sort_order ASC, bo.id ASC`,
    )
    .bind(menuId, locationId, accountId, ...optionIds)
    .all<BookingOptionRow>();
  return rows.results.length === optionIds.length ? rows.results : null;
}

async function validateOptionRelations(
  db: D1Database,
  accountId: string,
  menuIds: string[],
  locationIds: string[],
): Promise<boolean> {
  if (menuIds.length === 0 || locationIds.length === 0) return false;
  const menuPlaceholders = menuIds.map(() => '?').join(',');
  const locationPlaceholders = locationIds.map(() => '?').join(',');
  const [menuCount, locationCount] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM menus
          WHERE line_account_id = ? AND deleted_at IS NULL
            AND id IN (${menuPlaceholders})`,
      )
      .bind(accountId, ...menuIds)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM booking_locations
          WHERE line_account_id = ? AND deleted_at IS NULL
            AND id IN (${locationPlaceholders})`,
      )
      .bind(accountId, ...locationIds)
      .first<{ count: number }>(),
  ]);
  return menuCount?.count === menuIds.length && locationCount?.count === locationIds.length;
}

async function replaceOptionRelations(
  db: D1Database,
  optionId: string,
  menuIds: string[],
  locationIds: string[],
): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM booking_option_menus WHERE option_id = ?`).bind(optionId),
    db.prepare(`DELETE FROM booking_option_locations WHERE option_id = ?`).bind(optionId),
    ...menuIds.map((menuId) =>
      db
        .prepare(`INSERT INTO booking_option_menus (option_id, menu_id) VALUES (?, ?)`)
        .bind(optionId, menuId),
    ),
    ...locationIds.map((locationId) =>
      db
        .prepare(`INSERT INTO booking_option_locations (option_id, location_id) VALUES (?, ?)`)
        .bind(optionId, locationId),
    ),
  ]);
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

async function assertLocationInAccount(
  db: D1Database,
  locationId: string,
  accountId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok
         FROM booking_locations
        WHERE id = ? AND line_account_id = ? AND is_active = 1 AND deleted_at IS NULL`,
    )
    .bind(locationId, accountId)
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
  eventKey?: string,
  variables: Record<string, string | number | null | undefined> = {},
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT b.starts_at, b.ends_at, b.price_at_booking, b.customer_name,
              m.name AS menu_name,
              s.display_name AS staff_name,
              bl.name AS location_name, bl.address AS location_address,
              bl.phone AS location_phone, bl.access AS location_access,
              la.channel_access_token,
              la.liff_id,
              f.line_user_id,
              b.line_account_id
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN booking_locations bl ON bl.id = b.location_id
         INNER JOIN line_accounts la ON la.id = b.line_account_id
         INNER JOIN friends f ON f.id = b.friend_id
        WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first<{
      starts_at: string;
      ends_at: string;
      price_at_booking: number | null;
      customer_name: string;
      menu_name: string;
      staff_name: string;
      location_name: string | null;
      location_address: string | null;
      location_phone: string | null;
      location_access: string | null;
      channel_access_token: string;
      liff_id: string | null;
      line_user_id: string;
      line_account_id: string;
    }>();
  if (!row) return;
  const actionType = eventKey?.startsWith('change_')
    ? 'change'
    : eventKey?.startsWith('cancel_')
      ? 'cancel'
      : null;
  const action = actionType
    ? await db
        .prepare(
          `SELECT ar.requested_starts_at, ar.requested_ends_at,
                  rm.name AS requested_menu_name,
                  COALESCE(rsm.override_price, rm.base_price) AS requested_price
             FROM booking_action_requests ar
             LEFT JOIN menus rm ON rm.id = ar.requested_menu_id
             LEFT JOIN staff_menus rsm
               ON rsm.menu_id = ar.requested_menu_id
              AND rsm.staff_id = ar.requested_staff_id
            WHERE ar.booking_id = ? AND ar.request_type = ?
            ORDER BY ar.requested_at DESC
            LIMIT 1`,
        )
        .bind(bookingId, actionType)
        .first<{
          requested_starts_at: string | null;
          requested_ends_at: string | null;
          requested_menu_name: string | null;
          requested_price: number | null;
        }>()
    : null;
  const templateText = await getBookingMessage(
    db,
    row.line_account_id,
    eventKey ??
      (kind === 'requested'
        ? 'booking_requested'
        : kind === 'approved'
          ? 'booking_approved'
          : 'booking_rejected'),
  );
  if (templateText === null) return;
  const currentRange = bookingRangeForDisplay(row.starts_at, row.ends_at);
  const currentPrice = priceForDisplay(row.price_at_booking);
  const requestedRange =
    action?.requested_starts_at && action.requested_ends_at
      ? bookingRangeForDisplay(action.requested_starts_at, action.requested_ends_at)
      : currentRange;
  const requestedMenu = action?.requested_menu_name ?? row.menu_name;
  const requestedPrice = priceForDisplay(action?.requested_price ?? row.price_at_booking);
  const confirmUrl = bookingConfirmUrl(row.liff_id);
  const commonVariables: Record<string, string | number | null | undefined> = {
    name: row.customer_name,
    customer_name: row.customer_name,
    date_time_range_for_display: currentRange,
    price_for_display: currentPrice,
    confirm_url: confirmUrl,
    location_block: locationBlock(row),
    requested_starts_at: requestedRange,

    'context.reserve.create_request.full_name': row.customer_name,
    'context.reserve.create_request.date_time_range_for_display': currentRange,
    'context.reserve.create_request.course.name': row.menu_name,
    'context.reserve.create_request.price_for_display': currentPrice,

    'context.reserve.create_approve.full_name': row.customer_name,
    'context.reserve.create_approve.date_time_range_for_display': currentRange,
    'context.reserve.create_approve.course.name': row.menu_name,
    'context.reserve.create_approve.price_for_display': currentPrice,
    'context.reserve.create_approve.location_block': locationBlock(row),

    'context.reserve.edit_request.current.date_time_range_for_display': currentRange,
    'context.reserve.edit_request.current.course.name': row.menu_name,
    'context.reserve.edit_request.current.price_for_display': currentPrice,
    'context.reserve.edit_request.latest.date_time_range_for_display': requestedRange,
    'context.reserve.edit_request.latest.course.name': requestedMenu,
    'context.reserve.edit_request.latest.price_for_display': requestedPrice,

    'context.reserve.edit_approve.latest.date_time_range_for_display': currentRange,
    'context.reserve.edit_approve.latest.course.name': row.menu_name,
    'context.reserve.edit_approve.latest.price_for_display': currentPrice,
    'context.reserve.edit_approve.confirm_url': confirmUrl,

    'context.reserve.edit_reject.current.date_time_range_for_display': currentRange,
    'context.reserve.edit_reject.current.course.name': row.menu_name,
    'context.reserve.edit_reject.current.price_for_display': currentPrice,
    'context.reserve.edit_reject.latest.date_time_range_for_display': requestedRange,
    'context.reserve.edit_reject.latest.course.name': requestedMenu,
    'context.reserve.edit_reject.latest.price_for_display': requestedPrice,
    'context.reserve.edit_reject.confirm_url': confirmUrl,

    'context.reserve.cancel_request.date_time_range_for_display': currentRange,
    'context.reserve.cancel_request.course.name': row.menu_name,
    'context.reserve.cancel_request.price_for_display': currentPrice,
    'context.reserve.cancel_approve.date_time_range_for_display': currentRange,
    'context.reserve.cancel_approve.course.name': row.menu_name,
    'context.reserve.cancel_approve.price_for_display': currentPrice,
    'context.reserve.cancel_reject.date_time_range_for_display': currentRange,
    'context.reserve.cancel_reject.course.name': row.menu_name,
    'context.reserve.cancel_reject.price_for_display': currentPrice,
    'context.reserve.cancel_reject.confirm_url': confirmUrl,
  };
  await sendBookingNotification({
    channelAccessToken: row.channel_access_token,
    toLineUserId: row.line_user_id,
    kind,
    templateText,
    variables: { ...commonVariables, ...variables },
    ctx: {
      menuName: row.menu_name,
      staffName: row.staff_name,
      startsAtJst: startsAtJst(row.starts_at),
      hoursBefore: 0,
    },
  });
}

async function syncBookingToGoogleCalendar(db: D1Database, bookingId: string): Promise<void> {
  const row = await db
    .prepare(
      `SELECT b.id, b.line_account_id, b.starts_at, b.ends_at,
              b.customer_name, b.customer_phone, b.customer_note,
              m.name AS menu_name, s.display_name AS staff_name,
              bl.name AS location_name,
              bs.calendar_connection_id, bs.google_sync_enabled
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN booking_locations bl ON bl.id = b.location_id
         LEFT JOIN booking_management_settings bs ON bs.line_account_id = b.line_account_id
        WHERE b.id = ? AND b.status = 'confirmed'`,
    )
    .bind(bookingId)
    .first<{
      id: string;
      line_account_id: string;
      starts_at: string;
      ends_at: string;
      customer_name: string | null;
      customer_phone: string | null;
      customer_note: string | null;
      menu_name: string;
      staff_name: string;
      location_name: string | null;
      calendar_connection_id: string | null;
      google_sync_enabled: number | null;
    }>();
  if (!row || row.google_sync_enabled !== 1 || !row.calendar_connection_id) return;
  const connection = await db
    .prepare(
      `SELECT calendar_id, access_token
         FROM google_calendar_connections
        WHERE id = ? AND is_active = 1
          AND (line_account_id = ? OR line_account_id IS NULL)`,
    )
    .bind(row.calendar_connection_id, row.line_account_id)
    .first<{ calendar_id: string; access_token: string | null }>();
  if (!connection?.access_token) return;
  const client = new GoogleCalendarClient({
    calendarId: connection.calendar_id,
    accessToken: connection.access_token,
  });
  const description = [
    `店舗: ${row.location_name ?? '未設定'}`,
    `担当: ${row.staff_name}`,
    row.customer_phone ? `電話: ${row.customer_phone}` : null,
    row.customer_note ? `要望: ${row.customer_note}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const result = await client.createEvent({
    summary: `${row.customer_name ?? 'お客様'}様｜${row.menu_name}`,
    start: row.starts_at,
    end: row.ends_at,
    description,
  });
  await db
    .prepare(
      `UPDATE bookings
          SET external_event_id = ?, external_calendar_id = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ?`,
    )
    .bind(result.eventId, connection.calendar_id, bookingId)
    .run();
}

async function deleteBookingFromGoogleCalendar(db: D1Database, bookingId: string): Promise<void> {
  const row = await db
    .prepare(
      `SELECT b.external_event_id, b.line_account_id,
              bs.calendar_connection_id
         FROM bookings b
         LEFT JOIN booking_management_settings bs ON bs.line_account_id = b.line_account_id
        WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first<{
      external_event_id: string | null;
      line_account_id: string;
      calendar_connection_id: string | null;
    }>();
  if (!row?.external_event_id || !row.calendar_connection_id) return;
  const connection = await db
    .prepare(
      `SELECT calendar_id, access_token
         FROM google_calendar_connections
        WHERE id = ? AND is_active = 1
          AND (line_account_id = ? OR line_account_id IS NULL)`,
    )
    .bind(row.calendar_connection_id, row.line_account_id)
    .first<{ calendar_id: string; access_token: string | null }>();
  if (!connection?.access_token) return;
  await new GoogleCalendarClient({
    calendarId: connection.calendar_id,
    accessToken: connection.access_token,
  }).deleteEvent(row.external_event_id);
  await db
    .prepare(
      `UPDATE bookings SET external_event_id = NULL, external_calendar_id = NULL WHERE id = ?`,
    )
    .bind(bookingId)
    .run();
}

// ================================================================
// LIFF endpoints (/api/liff/booking/*)
// ================================================================

booking.get('/api/liff/booking/config', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const [settings, fields] = await Promise.all([
    getBookingSettings(c.env.DB, accountId),
    getBookingFormFields(c.env.DB, accountId),
  ]);
  return c.json({ settings, fields });
});

booking.get('/api/liff/booking/locations', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const settings = await getBookingSettings(c.env.DB, accountId);
  if (settings.is_public !== 1 || settings.allow_new_booking !== 1) {
    return c.json({ error: 'booking_not_available' }, 403);
  }
  const rows = await c.env.DB
    .prepare(
      `SELECT id, name, address, phone, access, sort_order
         FROM booking_locations
        WHERE line_account_id = ? AND is_active = 1 AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(accountId)
    .all();
  return c.json({ locations: rows.results });
});

booking.get('/api/liff/booking/menus', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const settings = await getBookingSettings(c.env.DB, accountId);
  if (settings.is_public !== 1 || settings.allow_new_booking !== 1) {
    return c.json({ error: 'booking_not_available' }, 403);
  }
  const rows = await c.env.DB
    .prepare(
      `SELECT id, name, category_label, description,
              duration_minutes, buffer_after_minutes,
              base_price, sort_order
         FROM menus
        WHERE line_account_id = ? AND is_active = 1 AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(accountId)
    .all();
  return c.json({ menus: rows.results });
});

booking.get('/api/liff/booking/options', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const menuId = c.req.query('menu_id');
  const locationId = c.req.query('location_id');
  if (!menuId || !locationId) return c.json({ error: 'missing_params' }, 400);
  const rows = await c.env.DB
    .prepare(
      `SELECT bo.id, bo.name, bo.description, bo.additional_price,
              bo.additional_duration_minutes, bo.sort_order
         FROM booking_options bo
         INNER JOIN booking_option_menus bom
                 ON bom.option_id = bo.id AND bom.menu_id = ?
         INNER JOIN booking_option_locations bol
                 ON bol.option_id = bo.id AND bol.location_id = ?
        WHERE bo.line_account_id = ?
          AND bo.is_active = 1 AND bo.deleted_at IS NULL
        ORDER BY bo.sort_order ASC, bo.id ASC`,
    )
    .bind(menuId, locationId, accountId)
    .all();
  return c.json({ options: rows.results });
});

booking.get('/api/liff/booking/menus/:id/staff', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const settings = await getBookingSettings(c.env.DB, accountId);
  if (settings.is_public !== 1 || settings.allow_new_booking !== 1) {
    return c.json({ error: 'booking_not_available' }, 403);
  }
  const menuId = c.req.param('id');
  const rows = await c.env.DB
    .prepare(
      `SELECT s.id, s.display_name, s.role, s.profile_image_url, s.bio,
              s.is_designation_optional,
              COALESCE(sm.override_price, m.base_price) AS price,
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
  const settings = await getBookingSettings(c.env.DB, accountId);
  if (settings.is_public !== 1 || settings.allow_new_booking !== 1) {
    return c.json({ error: 'booking_not_available' }, 403);
  }
  const menuId = c.req.query('menu_id');
  const staffId = c.req.query('staff_id') || undefined;
  const locationId = c.req.query('location_id') || undefined;
  const optionIds = uniqueOptionIds(c.req.query('option_ids'));
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!menuId || !from || !to || optionIds === null) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const selectedOptions = locationId
    ? await resolveBookingOptions(c.env.DB, accountId, menuId, locationId, optionIds)
    : optionIds.length === 0
      ? []
      : null;
  if (!selectedOptions) return c.json({ error: 'invalid_options' }, 422);
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  if ((toD.getTime() - fromD.getTime()) / 86400_000 > 35) {
    return c.json({ error: 'range_too_wide' }, 400);
  }
  const result = await getAvailability(c.env.DB, {
    lineAccountId: accountId,
    menuId,
    staffId,
    locationId,
    from,
    to,
    now: new Date(),
    minLeadTimeMinutes: DEFAULT_ACCOUNT_SETTINGS.min_lead_time_minutes,
    granularityMinutes: settings.slot_interval_minutes,
    additionalDurationMinutes: selectedOptions.reduce(
      (sum, option) => sum + option.additional_duration_minutes,
      0,
    ),
  });
  return c.json(result);
});

booking.post('/api/liff/booking/requests', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const settings = await getBookingSettings(c.env.DB, accountId);
  if (settings.is_public !== 1 || settings.allow_new_booking !== 1) {
    return c.json({ error: 'booking_not_available' }, 403);
  }
  const idemKey = c.req.header('Idempotency-Key');
  if (!idemKey) return c.json({ error: 'missing_idempotency_key' }, 400);

  // 認証済み caller の LINE userId を Authorization: Bearer <id_token> から取得。
  const callerLineUserId = await verifyCallerLineUserId(c);
  if (!callerLineUserId) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{
    menu_id: string;
    staff_id: string;
    location_id: string;
    starts_at: string; // UTC ISO8601
    customer_name: string;
    customer_kana: string;
    customer_phone: string;
    customer_birthdate?: string;
    customer_note?: string;
    form_values?: Record<string, string>;
    consent_agreed?: boolean;
    consent_version?: number;
    option_ids?: string[];
  }>();
  if (
    !body.menu_id ||
    !body.staff_id ||
    !body.location_id ||
    !body.starts_at
  ) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const configuredFields = await getBookingFormFields(c.env.DB, accountId);
  const formValues: Record<string, string> = {
    ...(body.form_values ?? {}),
    customer_name: body.customer_name ?? body.form_values?.customer_name ?? '',
    customer_kana: body.customer_kana ?? body.form_values?.customer_kana ?? '',
    customer_phone: body.customer_phone ?? body.form_values?.customer_phone ?? '',
    customer_birthdate:
      body.customer_birthdate ?? body.form_values?.customer_birthdate ?? '',
  };
  for (const field of configuredFields) {
    const value = String(formValues[field.field_key] ?? '').trim();
    if (field.is_required === 1 && !value) {
      return c.json({ error: 'required_field_missing', field_key: field.field_key }, 422);
    }
    if (value.length > (field.field_type === 'textarea' ? 2_000 : 200)) {
      return c.json({ error: 'field_too_long', field_key: field.field_key }, 422);
    }
  }
  const customerName = formValues.customer_name.trim();
  const customerKana = formValues.customer_kana.trim();
  const customerPhone = formValues.customer_phone.replace(/[^\d+]/g, '');
  const customerBirthdate = formValues.customer_birthdate.trim();
  if (
    customerName.length > 100 ||
    customerKana.length > 100 ||
    (customerPhone && !/^\+?\d{10,15}$/.test(customerPhone)) ||
    (customerBirthdate && !/^\d{4}-\d{2}-\d{2}$/.test(customerBirthdate))
  ) {
    return c.json({ error: 'invalid_customer_details' }, 422);
  }
  if ((body.customer_note?.length ?? 0) > 2_000) {
    return c.json({ error: 'customer_note_too_long' }, 422);
  }
  const consent = await getConsentSetting(c.env.DB, accountId);
  if (
    consent.is_active === 1 &&
    consent.is_required === 1 &&
    (!body.consent_agreed || body.consent_version !== consent.version)
  ) {
    return c.json({ error: 'consent_required', current_version: consent.version }, 422);
  }
  if (!(await assertLocationInAccount(c.env.DB, body.location_id, accountId))) {
    return c.json({ error: 'location_not_found' }, 404);
  }
  const optionIds = uniqueOptionIds(body.option_ids);
  if (optionIds === null) return c.json({ error: 'invalid_options' }, 422);
  const selectedOptions = await resolveBookingOptions(
    c.env.DB,
    accountId,
    body.menu_id,
    body.location_id,
    optionIds,
  );
  if (!selectedOptions) return c.json({ error: 'invalid_options' }, 422);
  const optionDuration = selectedOptions.reduce(
    (sum, option) => sum + option.additional_duration_minutes,
    0,
  );
  const optionPrice = selectedOptions.reduce(
    (sum, option) => sum + option.additional_price,
    0,
  );
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
              m.auto_tag_id,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS dur,
              COALESCE(sm.override_price, m.base_price) AS price,
              sm.is_offered
         FROM menus m
         LEFT JOIN staff_menus sm ON sm.menu_id = m.id AND sm.staff_id = ?2
        WHERE m.id = ?1 AND m.line_account_id = ?3
          AND m.deleted_at IS NULL AND m.is_active = 1`,
    )
    .bind(body.menu_id, body.staff_id, accountId)
    .first<{ duration_minutes: number; buffer_after_minutes: number; auto_tag_id: string | null; dur: number; price: number; is_offered: number | null }>();
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
  if (!isWithinReceptionWindow(settings, startsAt)) {
    return c.json({ error: 'outside_reception_window' }, 422);
  }
  const totalDuration = menuRow.dur + optionDuration;
  const endsAt = new Date(startsAt.getTime() + totalDuration * 60_000);
  const blockEndsAt = new Date(endsAt.getTime() + menuRow.buffer_after_minutes * 60_000);

  // Server-side availability 再検証: シフト内 / リードタイム / 既存予約と非衝突を保証する。
  // UI フィルタだけでは公開 API への直 POST で営業時間外予約を作れてしまうため必須。
  const startJstDate = new Date(startsAt.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const startJstHHMM = new Date(startsAt.getTime() + 9 * 3600_000).toISOString().slice(11, 16);
  const shift = await c.env.DB
    .prepare(
      `SELECT start_time, end_time
         FROM staff_shifts
        WHERE staff_id = ? AND work_date = ? AND location_id = ?`,
    )
    .bind(body.staff_id, startJstDate, body.location_id)
    .first<{ start_time: string; end_time: string }>();
  if (!shift) return c.json({ error: 'out_of_shift' }, 422);
  const existingBookings = await c.env.DB
    .prepare(
      `SELECT starts_at, block_ends_at FROM bookings
        WHERE staff_id = ? AND status IN ('requested','confirmed')
          AND starts_at < ? AND block_ends_at > ?`,
    )
    .bind(
      body.staff_id,
      jstDayWindowUtc(startJstDate).endUtc,
      jstDayWindowUtc(startJstDate).startUtc,
    )
    .all<{ starts_at: string; block_ends_at: string }>();
  const slotsToday = computeSlots({
    working: [{ start: shift.start_time, end: shift.end_time }],
    busy: existingBookings.results.map((b) => ({
      start: new Date(new Date(b.starts_at).getTime() + 9 * 3600_000).toISOString().slice(11, 16),
      end: new Date(new Date(b.block_ends_at).getTime() + 9 * 3600_000).toISOString().slice(11, 16),
    })),
    menu: { duration_minutes: totalDuration, buffer_after_minutes: menuRow.buffer_after_minutes },
    granularityMinutes: settings.slot_interval_minutes,
  });
  const slotMatched = slotsToday.some((s) => s.start === startJstHHMM);
  if (!slotMatched) return c.json({ error: 'slot_not_available' }, 422);
  // リードタイム: 現在時刻 + DEFAULT min_lead_time_minutes より前の枠は受け付けない
  const minLeadAt = new Date(Date.now() + DEFAULT_ACCOUNT_SETTINGS.min_lead_time_minutes * 60_000);
  if (startsAt < minLeadAt) return c.json({ error: 'lead_time_violation' }, 422);

  const bookingId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  // 競合チェックと INSERT を 1 ステートメントで原子化する。
  // INSERT ... SELECT WHERE NOT EXISTS パターンで、同一スタッフの overlap 行がある場合は
  // 0 行 INSERT に落とす。changes=0 を 409 として扱う。
  const insertResult = await c.env.DB
    .prepare(
      `INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id, location_id,
         starts_at, ends_at, block_ends_at, status,
         customer_name, customer_kana, customer_phone, customer_birthdate,
         custom_fields_json, customer_note,
         price_at_booking, consent_title, consent_body, consent_version,
         consent_agreed_at, requested_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        WHERE NOT EXISTS (
          SELECT 1 FROM bookings
           WHERE staff_id = ?
             AND status IN ('requested','confirmed')
             AND starts_at < ?
             AND block_ends_at > ?
        )`,
    )
    .bind(
      bookingId,
      accountId,
      friendId,
      body.staff_id,
      body.menu_id,
      body.location_id,
      startsAt.toISOString(),
      endsAt.toISOString(),
      blockEndsAt.toISOString(),
      'requested' satisfies BookingStatus,
      customerName,
      customerKana,
      customerPhone,
      customerBirthdate || null,
      JSON.stringify(formValues),
      body.customer_note ?? null,
      menuRow.price + optionPrice,
      consent.is_active === 1 ? consent.title : null,
      consent.is_active === 1 ? consent.body : null,
      consent.is_active === 1 ? consent.version : null,
      consent.is_active === 1 && body.consent_agreed ? nowIso : null,
      nowIso,
      // NOT EXISTS subquery params
      body.staff_id,
      blockEndsAt.toISOString(),
      startsAt.toISOString(),
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

  if (selectedOptions.length > 0) {
    try {
      await c.env.DB.batch(
        selectedOptions.map((option) =>
          c.env.DB
            .prepare(
              `INSERT INTO booking_selected_options
                (booking_id, option_id, option_name, additional_price, additional_duration_minutes)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(
              bookingId,
              option.id,
              option.name,
              option.additional_price,
              option.additional_duration_minutes,
            ),
        ),
      );
    } catch (error) {
      await c.env.DB.prepare(`DELETE FROM bookings WHERE id = ?`).bind(bookingId).run();
      console.error(
        JSON.stringify({
          message: 'booking option snapshot failed',
          bookingId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.json({ error: 'option_save_failed' }, 500);
    }
  }

  try {
    const friendSync = await syncBookingFriendProfile(c.env.DB, {
      accountId,
      friendId,
      locationId: body.location_id,
      customer: {
        name: customerName,
        kana: customerKana,
        phone: customerPhone,
        birthdate: customerBirthdate || null,
      },
    });
    if (friendSync.tagAdded) {
      c.executionCtx.waitUntil(
        fireTagAddedSideEffects(c.env.DB, friendId, friendSync.tagId, {
          defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
          workerUrl: c.env.WORKER_URL,
        }).catch((err) =>
          console.error(
            JSON.stringify({
              message: 'booking store tag side effects failed',
              bookingId,
              friendId,
              tagId: friendSync.tagId,
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
        ),
      );
    }
  } catch (error) {
    await c.env.DB.prepare(`DELETE FROM bookings WHERE id = ?`).bind(bookingId).run();
    console.error(
      JSON.stringify({
        message: 'booking friend profile sync failed',
        bookingId,
        friendId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return c.json({ error: 'customer_profile_save_failed' }, 500);
  }

  // Fire-and-forget notification — failures must not roll back the booking.
  c.executionCtx.waitUntil(
    notifyForBooking(c.env.DB, bookingId, 'requested').catch((err) =>
      console.error('booking notify (requested) failed:', err),
    ),
  );

  // notifyForBooking と同じく fire-and-forget。タグ付与失敗は予約成功扱い。
  // attachTagAndFireSideEffects は POST /api/friends/:id/tags と同じ side effects
  // (tag_added シナリオ enrollment + tag_change イベント) を発火する。
  // INSERT OR IGNORE で重複を吸収し、新規付与のときだけ side effects を打つ。
  if (menuRow.auto_tag_id) {
    const tagId = menuRow.auto_tag_id;
    c.executionCtx.waitUntil(
      attachTagAndFireSideEffects(c.env.DB, friendId, tagId, {
        defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
        workerUrl: c.env.WORKER_URL,
      })
        .then(() => undefined)
        .catch((err) => console.error('booking auto-tag failed:', err)),
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
      `SELECT b.id, b.location_id, b.menu_id, b.staff_id, b.starts_at, b.ends_at, b.status, b.customer_note,
              b.customer_name, b.customer_kana, b.customer_phone, b.customer_birthdate,
              b.custom_fields_json,
              b.price_at_booking, b.consent_title, b.consent_body,
              b.consent_version, b.consent_agreed_at,
              (SELECT bar.request_type FROM booking_action_requests bar
                WHERE bar.booking_id = b.id AND bar.status = 'requested'
                ORDER BY bar.requested_at DESC LIMIT 1) AS pending_action_request,
              m.name AS menu_name,
              s.display_name AS staff_name, s.profile_image_url,
              bl.name AS location_name
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN booking_locations bl ON bl.id = b.location_id
        WHERE b.friend_id = ? AND b.line_account_id = ?
          AND b.status IN ('requested','confirmed')
          AND b.starts_at >= ?
        ORDER BY b.starts_at ASC`,
    )
    .bind(friendId, accountId, new Date().toISOString())
    .all();

  const past = await c.env.DB
    .prepare(
      `SELECT b.id, b.location_id, b.menu_id, b.staff_id, b.starts_at, b.ends_at, b.status, b.customer_note,
              b.customer_name, b.customer_kana, b.customer_phone, b.customer_birthdate,
              b.custom_fields_json,
              b.price_at_booking, b.consent_title, b.consent_body,
              b.consent_version, b.consent_agreed_at,
              (SELECT bar.request_type FROM booking_action_requests bar
                WHERE bar.booking_id = b.id AND bar.status = 'requested'
                ORDER BY bar.requested_at DESC LIMIT 1) AS pending_action_request,
              m.name AS menu_name,
              s.display_name AS staff_name, s.profile_image_url,
              bl.name AS location_name
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN booking_locations bl ON bl.id = b.location_id
        WHERE b.friend_id = ? AND b.line_account_id = ?
          AND (b.status NOT IN ('requested','confirmed') OR b.starts_at < ?)
        ORDER BY b.starts_at DESC
        LIMIT 50`,
    )
    .bind(friendId, accountId, new Date().toISOString())
    .all();

  return c.json({ upcoming: upcoming.results, past: past.results });
});

booking.get('/api/liff/booking/consent', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  return c.json({ consent: await getConsentSetting(c.env.DB, accountId) });
});

booking.post('/api/liff/booking/me/:id/cancel', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const callerLineUserId = await verifyCallerLineUserId(c);
  if (!callerLineUserId) return c.json({ error: 'unauthorized' }, 401);
  const friendId = await resolveFriendId(c, callerLineUserId, accountId);
  if (!friendId) return c.json({ error: 'not_found' }, 404);

  const id = c.req.param('id');
  const settings = await getBookingSettings(c.env.DB, accountId);
  if (settings.allow_cancel_request !== 1) {
    return c.json({ error: 'cancel_request_disabled' }, 403);
  }
  const row = await c.env.DB
    .prepare(
      `SELECT id, status, starts_at
         FROM bookings
        WHERE id = ? AND line_account_id = ? AND friend_id = ?`,
    )
    .bind(id, accountId, friendId)
    .first<{ id: string; status: BookingStatus; starts_at: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!canTransition(row.status, 'cancel')) {
    return c.json({ error: 'cannot_cancel', status: row.status }, 409);
  }
  if (new Date(row.starts_at) <= new Date()) {
    return c.json({ error: 'booking_started' }, 409);
  }
  const deadline = new Date(
    new Date(row.starts_at).getTime() -
      settings.cancel_deadline_minutes_before * 60_000,
  );
  if (new Date() > deadline) {
    return c.json({ error: 'cancel_deadline_passed' }, 409);
  }
  const requestId = crypto.randomUUID();
  try {
    await c.env.DB
      .prepare(
        `INSERT INTO booking_action_requests
          (id, line_account_id, booking_id, friend_id, request_type, status, requested_at)
         VALUES (?,?,?,?,?,'requested',?)`,
      )
      .bind(requestId, accountId, id, friendId, 'cancel', new Date().toISOString())
      .run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      return c.json({ error: 'request_already_pending' }, 409);
    }
    throw error;
  }
  c.executionCtx.waitUntil(
    notifyForBooking(c.env.DB, id, 'requested', 'cancel_requested').catch((error) =>
      console.error('booking notify (cancel requested) failed:', error),
    ),
  );
  return c.json({ request_id: requestId, status: 'requested' }, 201);
});

booking.post('/api/liff/booking/me/:id/change', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const callerLineUserId = await verifyCallerLineUserId(c);
  if (!callerLineUserId) return c.json({ error: 'unauthorized' }, 401);
  const friendId = await resolveFriendId(c, callerLineUserId, accountId);
  if (!friendId) return c.json({ error: 'not_found' }, 404);
  const settings = await getBookingSettings(c.env.DB, accountId);
  if (settings.allow_change_request !== 1) {
    return c.json({ error: 'change_request_disabled' }, 403);
  }
  const bookingId = c.req.param('id');
  const current = await c.env.DB
    .prepare(
      `SELECT id, status, starts_at
         FROM bookings
        WHERE id = ? AND line_account_id = ? AND friend_id = ?`,
    )
    .bind(bookingId, accountId, friendId)
    .first<{ id: string; status: BookingStatus; starts_at: string }>();
  if (!current) return c.json({ error: 'not_found' }, 404);
  if (!['requested', 'confirmed'].includes(current.status)) {
    return c.json({ error: 'cannot_change', status: current.status }, 409);
  }
  const deadline = new Date(
    new Date(current.starts_at).getTime() -
      settings.change_deadline_minutes_before * 60_000,
  );
  if (new Date() > deadline) return c.json({ error: 'change_deadline_passed' }, 409);
  const body = await c.req.json<{
    location_id: string;
    menu_id: string;
    staff_id: string;
    starts_at: string;
    customer_note?: string;
    option_ids?: string[];
  }>();
  if (!body.location_id || !body.menu_id || !body.staff_id || !body.starts_at) {
    return c.json({ error: 'missing_params' }, 400);
  }
  if (!(await assertLocationInAccount(c.env.DB, body.location_id, accountId))) {
    return c.json({ error: 'location_not_found' }, 404);
  }
  const optionIds = uniqueOptionIds(body.option_ids);
  if (optionIds === null) return c.json({ error: 'invalid_options' }, 422);
  const selectedOptions = await resolveBookingOptions(
    c.env.DB,
    accountId,
    body.menu_id,
    body.location_id,
    optionIds,
  );
  if (!selectedOptions) return c.json({ error: 'invalid_options' }, 422);
  const optionDuration = selectedOptions.reduce(
    (sum, option) => sum + option.additional_duration_minutes,
    0,
  );
  const menu = await c.env.DB
    .prepare(
      `SELECT m.buffer_after_minutes,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS duration_minutes,
              sm.is_offered
         FROM menus m
         LEFT JOIN staff_menus sm ON sm.menu_id = m.id AND sm.staff_id = ?
        WHERE m.id = ? AND m.line_account_id = ? AND m.is_active = 1 AND m.deleted_at IS NULL`,
    )
    .bind(body.staff_id, body.menu_id, accountId)
    .first<{
      buffer_after_minutes: number;
      duration_minutes: number;
      is_offered: number | null;
    }>();
  if (!menu || menu.is_offered !== 1) return c.json({ error: 'menu_not_offered' }, 422);
  const startsAt = new Date(body.starts_at);
  if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
    return c.json({ error: 'invalid_starts_at' }, 422);
  }
  if (!isWithinReceptionWindow(settings, startsAt)) {
    return c.json({ error: 'outside_reception_window' }, 422);
  }
  const endsAt = new Date(
    startsAt.getTime() + (menu.duration_minutes + optionDuration) * 60_000,
  );
  const blockEndsAt = new Date(endsAt.getTime() + menu.buffer_after_minutes * 60_000);
  const startJstDate = new Date(startsAt.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  const startJstHHMM = new Date(startsAt.getTime() + JST_OFFSET_MS).toISOString().slice(11, 16);
  const shift = await c.env.DB
    .prepare(
      `SELECT start_time, end_time FROM staff_shifts
        WHERE staff_id = ? AND location_id = ? AND work_date = ?`,
    )
    .bind(body.staff_id, body.location_id, startJstDate)
    .first<{ start_time: string; end_time: string }>();
  if (!shift) return c.json({ error: 'out_of_shift' }, 422);
  const conflicts = await c.env.DB
    .prepare(
      `SELECT starts_at, block_ends_at FROM bookings
        WHERE staff_id = ? AND id != ? AND status IN ('requested','confirmed')
          AND starts_at < ? AND block_ends_at > ?`,
    )
    .bind(body.staff_id, bookingId, blockEndsAt.toISOString(), startsAt.toISOString())
    .all<{ starts_at: string; block_ends_at: string }>();
  const slots = computeSlots({
    working: [{ start: shift.start_time, end: shift.end_time }],
    busy: conflicts.results.map((item) => ({
      start: new Date(new Date(item.starts_at).getTime() + JST_OFFSET_MS).toISOString().slice(11, 16),
      end: new Date(new Date(item.block_ends_at).getTime() + JST_OFFSET_MS).toISOString().slice(11, 16),
    })),
    menu: {
      duration_minutes: menu.duration_minutes + optionDuration,
      buffer_after_minutes: menu.buffer_after_minutes,
    },
    granularityMinutes: settings.slot_interval_minutes,
  });
  if (!slots.some((slot) => slot.start === startJstHHMM)) {
    return c.json({ error: 'slot_not_available' }, 422);
  }
  const requestId = crypto.randomUUID();
  try {
    await c.env.DB
      .prepare(
        `INSERT INTO booking_action_requests
          (id, line_account_id, booking_id, friend_id, request_type, status,
           requested_location_id, requested_staff_id, requested_menu_id,
           requested_starts_at, requested_ends_at, requested_block_ends_at,
           customer_note, requested_options_json, requested_at)
         VALUES (?,?,?,?,?,'requested',?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        requestId,
        accountId,
        bookingId,
        friendId,
        'change',
        body.location_id,
        body.staff_id,
        body.menu_id,
        startsAt.toISOString(),
        endsAt.toISOString(),
        blockEndsAt.toISOString(),
        body.customer_note ?? null,
        JSON.stringify(selectedOptions),
        new Date().toISOString(),
      )
      .run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      return c.json({ error: 'request_already_pending' }, 409);
    }
    throw error;
  }
  c.executionCtx.waitUntil(
    notifyForBooking(c.env.DB, bookingId, 'requested', 'change_requested', {
      requested_starts_at: startsAtJst(startsAt.toISOString()),
    }).catch((error) => console.error('booking notify (change requested) failed:', error)),
  );
  return c.json({ request_id: requestId, status: 'requested' }, 201);
});

// ================================================================
// Admin endpoints (/api/booking/admin/*)
// authMiddleware enforces staff/owner auth at index.ts level.
// All endpoints require ?account_id= query.
// ================================================================

booking.get('/api/booking/admin/settings', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const [settings, fields, messageRows, connections] = await Promise.all([
    getBookingSettings(c.env.DB, accountId),
    getBookingFormFields(c.env.DB, accountId, true),
    c.env.DB
      .prepare(
        `SELECT event_key, message_text, is_enabled
           FROM booking_message_settings
          WHERE line_account_id = ?`,
      )
      .bind(accountId)
      .all<{ event_key: string; message_text: string; is_enabled: number }>(),
    c.env.DB
      .prepare(
        `SELECT id, calendar_id, auth_type, is_active,
                CASE WHEN access_token IS NOT NULL AND access_token != '' THEN 1 ELSE 0 END AS has_access_token
           FROM google_calendar_connections
          WHERE line_account_id = ? OR line_account_id IS NULL
          ORDER BY created_at DESC`,
      )
      .bind(accountId)
      .all(),
  ]);
  const savedMessages = new Map(messageRows.results.map((row) => [row.event_key, row]));
  const messages = Object.entries(DEFAULT_BOOKING_MESSAGES).map(([event_key, defaultText]) => ({
    event_key,
    message_text: savedMessages.get(event_key)?.message_text ?? defaultText,
    is_enabled: savedMessages.get(event_key)?.is_enabled ?? 1,
  }));
  return c.json({
    settings,
    fields,
    messages,
    calendar_connections: connections.results,
  });
});

booking.put('/api/booking/admin/settings', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const body = await c.req.json<Partial<BookingManagementSettings>>();
  const current = await getBookingSettings(c.env.DB, accountId);
  const next: BookingManagementSettings = { ...current, ...body };
  if (![15, 30, 60].includes(Number(next.slot_interval_minutes))) {
    return c.json({ error: 'invalid_slot_interval' }, 422);
  }
  if (!['week', 'month'].includes(next.calendar_view)) {
    return c.json({ error: 'invalid_calendar_view' }, 422);
  }
  if (!['always', 'relative', 'fixed'].includes(next.reception_start_mode)) {
    return c.json({ error: 'invalid_reception_start_mode' }, 422);
  }
  if (!['until_start', 'relative', 'fixed'].includes(next.reception_end_mode)) {
    return c.json({ error: 'invalid_reception_end_mode' }, 422);
  }
  const nonNegative = [
    next.reception_end_minutes_before,
    next.change_deadline_minutes_before,
    next.cancel_deadline_minutes_before,
  ];
  if (nonNegative.some((value) => !Number.isInteger(Number(value)) || Number(value) < 0)) {
    return c.json({ error: 'invalid_deadline' }, 422);
  }
  if (next.calendar_connection_id) {
    const connection = await c.env.DB
      .prepare(
        `SELECT 1 AS ok FROM google_calendar_connections
          WHERE id = ? AND (line_account_id = ? OR line_account_id IS NULL)`,
      )
      .bind(next.calendar_connection_id, accountId)
      .first<{ ok: number }>();
    if (!connection) return c.json({ error: 'calendar_connection_not_found' }, 404);
  }
  await c.env.DB
    .prepare(
      `INSERT INTO booking_management_settings
        (line_account_id, is_public, allow_new_booking, allow_change_request,
         allow_cancel_request, reception_start_mode, reception_start_days_before,
         reception_start_at, reception_end_mode, reception_end_minutes_before,
         reception_end_at, change_deadline_minutes_before,
         cancel_deadline_minutes_before, slot_interval_minutes, calendar_view,
         calendar_connection_id, google_sync_enabled)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(line_account_id) DO UPDATE SET
         is_public = excluded.is_public,
         allow_new_booking = excluded.allow_new_booking,
         allow_change_request = excluded.allow_change_request,
         allow_cancel_request = excluded.allow_cancel_request,
         reception_start_mode = excluded.reception_start_mode,
         reception_start_days_before = excluded.reception_start_days_before,
         reception_start_at = excluded.reception_start_at,
         reception_end_mode = excluded.reception_end_mode,
         reception_end_minutes_before = excluded.reception_end_minutes_before,
         reception_end_at = excluded.reception_end_at,
         change_deadline_minutes_before = excluded.change_deadline_minutes_before,
         cancel_deadline_minutes_before = excluded.cancel_deadline_minutes_before,
         slot_interval_minutes = excluded.slot_interval_minutes,
         calendar_view = excluded.calendar_view,
         calendar_connection_id = excluded.calendar_connection_id,
         google_sync_enabled = excluded.google_sync_enabled,
         updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`,
    )
    .bind(
      accountId,
      next.is_public ? 1 : 0,
      next.allow_new_booking ? 1 : 0,
      next.allow_change_request ? 1 : 0,
      next.allow_cancel_request ? 1 : 0,
      next.reception_start_mode,
      next.reception_start_days_before,
      next.reception_start_at,
      next.reception_end_mode,
      next.reception_end_minutes_before,
      next.reception_end_at,
      next.change_deadline_minutes_before,
      next.cancel_deadline_minutes_before,
      next.slot_interval_minutes,
      next.calendar_view,
      next.calendar_connection_id,
      next.google_sync_enabled ? 1 : 0,
    )
    .run();
  return c.json({ settings: await getBookingSettings(c.env.DB, accountId) });
});

booking.put('/api/booking/admin/settings/fields', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const body = await c.req.json<{
    fields: Array<{
      id?: string;
      field_key: string;
      label: string;
      field_type: BookingFormField['field_type'];
      placeholder?: string | null;
      is_required: boolean | number;
      is_active: boolean | number;
      sort_order?: number;
      is_system?: boolean | number;
    }>;
  }>();
  if (!Array.isArray(body.fields) || body.fields.length > 30) {
    return c.json({ error: 'invalid_fields' }, 422);
  }
  const allowedTypes = new Set(['text', 'tel', 'date', 'textarea']);
  const keys = new Set<string>();
  for (const field of body.fields) {
    if (
      !/^[a-z][a-z0-9_]{1,49}$/.test(field.field_key) ||
      keys.has(field.field_key) ||
      !field.label?.trim() ||
      field.label.length > 80 ||
      !allowedTypes.has(field.field_type)
    ) {
      return c.json({ error: 'invalid_field', field_key: field.field_key }, 422);
    }
    keys.add(field.field_key);
  }
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`DELETE FROM booking_form_fields WHERE line_account_id = ?`).bind(accountId),
  ];
  for (let index = 0; index < body.fields.length; index++) {
    const field = body.fields[index];
    statements.push(
      c.env.DB
        .prepare(
          `INSERT INTO booking_form_fields
            (id, line_account_id, field_key, label, field_type, placeholder,
             is_required, is_active, sort_order, is_system)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          field.id && !field.id.startsWith('default:') ? field.id : crypto.randomUUID(),
          accountId,
          field.field_key,
          field.label.trim(),
          field.field_type,
          field.placeholder?.trim() || null,
          field.is_required ? 1 : 0,
          field.is_active ? 1 : 0,
          Number.isFinite(field.sort_order) ? Number(field.sort_order) : (index + 1) * 10,
          field.is_system ? 1 : 0,
        ),
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ fields: await getBookingFormFields(c.env.DB, accountId, true) });
});

booking.put('/api/booking/admin/settings/messages', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const body = await c.req.json<{
    messages: Array<{ event_key: string; message_text: string; is_enabled: boolean | number }>;
  }>();
  const allowedKeys = new Set(Object.keys(DEFAULT_BOOKING_MESSAGES));
  if (
    !Array.isArray(body.messages) ||
    body.messages.some(
      (message) =>
        !allowedKeys.has(message.event_key) ||
        !message.message_text?.trim() ||
        message.message_text.length > 5_000,
    )
  ) {
    return c.json({ error: 'invalid_messages' }, 422);
  }
  await c.env.DB.batch(
    body.messages.map((message) =>
      c.env.DB
        .prepare(
          `INSERT INTO booking_message_settings
            (line_account_id, event_key, message_text, is_enabled)
           VALUES (?,?,?,?)
           ON CONFLICT(line_account_id, event_key) DO UPDATE SET
             message_text = excluded.message_text,
             is_enabled = excluded.is_enabled,
             updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`,
        )
        .bind(
          accountId,
          message.event_key,
          message.message_text.trim(),
          message.is_enabled ? 1 : 0,
        ),
    ),
  );
  return c.json({ ok: true });
});

booking.post('/api/booking/admin/settings/calendar-connections', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const body = await c.req.json<{ calendar_id?: string; access_token?: string }>();
  const calendarId = body.calendar_id?.trim();
  const accessToken = body.access_token?.trim();
  if (!calendarId || !accessToken || calendarId.length > 300 || accessToken.length > 4_000) {
    return c.json({ error: 'calendar_id_and_access_token_required' }, 422);
  }
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO google_calendar_connections
        (id, calendar_id, access_token, auth_type, is_active, line_account_id)
       VALUES (?,?,?,'oauth',1,?)`,
    )
    .bind(id, calendarId, accessToken, accountId)
    .run();
  return c.json({ id, calendar_id: calendarId }, 201);
});

booking.delete('/api/booking/admin/settings/calendar-connections/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  await c.env.DB
    .prepare(
      `UPDATE booking_management_settings
          SET calendar_connection_id = NULL, google_sync_enabled = 0
        WHERE line_account_id = ? AND calendar_connection_id = ?`,
    )
    .bind(accountId, id)
    .run();
  await c.env.DB
    .prepare(`DELETE FROM google_calendar_connections WHERE id = ? AND line_account_id = ?`)
    .bind(id, accountId)
    .run();
  return c.json({ ok: true });
});

// ---- Menus CRUD ----

booking.get('/api/booking/admin/consent', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  return c.json({ consent: await getConsentSetting(c.env.DB, accountId) });
});

booking.put('/api/booking/admin/consent', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const body = await c.req.json<{
    title?: string;
    body?: string;
    is_required?: boolean;
    is_active?: boolean;
  }>();
  const title = body.title?.trim() ?? '';
  const consentBody = body.body?.trim() ?? '';
  if (!title || !consentBody) return c.json({ error: 'title_and_body_required' }, 400);
  if (title.length > 120 || consentBody.length > 10_000) {
    return c.json({ error: 'consent_too_long' }, 422);
  }
  await c.env.DB
    .prepare(
      `INSERT INTO booking_consent_settings
        (line_account_id, title, body, version, is_required, is_active)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(line_account_id) DO UPDATE SET
         title = excluded.title,
         body = excluded.body,
         version = booking_consent_settings.version + 1,
         is_required = excluded.is_required,
         is_active = excluded.is_active,
         updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`,
    )
    .bind(accountId, title, consentBody, body.is_required === false ? 0 : 1, body.is_active === false ? 0 : 1)
    .run();
  return c.json({ consent: await getConsentSetting(c.env.DB, accountId) });
});

booking.get('/api/booking/admin/menus', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, name, category_label, description,
              duration_minutes, buffer_after_minutes,
              base_price, sort_order, is_active, auto_tag_id
         FROM menus
        WHERE line_account_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(accountId)
    .all();
  return c.json({ menus: rows.results });
});

booking.post('/api/booking/admin/menus', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const b = await c.req.json<{
    name: string;
    category_label?: string | null;
    description?: string | null;
    duration_minutes: number;
    buffer_after_minutes?: number;
    base_price: number;
    sort_order?: number;
    auto_tag_id?: string | null;
  }>();
  const autoTagId = (b.auto_tag_id ?? '').trim() === '' ? null : (b.auto_tag_id as string);
  if (autoTagId) {
    const tagExists = await c.env.DB
      .prepare(`SELECT 1 FROM tags WHERE id = ?`)
      .bind(autoTagId)
      .first<{ 1: number }>();
    if (!tagExists) return c.json({ error: 'tag_not_found' }, 400);
  }
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO menus
        (id, line_account_id, name, category_label, description,
         duration_minutes, buffer_after_minutes, base_price, sort_order, auto_tag_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      accountId,
      b.name,
      b.category_label ?? null,
      b.description ?? null,
      b.duration_minutes,
      b.buffer_after_minutes ?? 0,
      b.base_price,
      b.sort_order ?? 0,
      autoTagId,
    )
    .run();
  return c.json({ id }, 201);
});

booking.put('/api/booking/admin/menus/:id', async (c) => {
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
    sort_order?: number;
    is_active?: boolean;
    auto_tag_id?: string | null;
  }>();
  // PUT は古いクライアントが auto_tag_id フィールドを送らない場合がある。`undefined` を
  // null として書き込むと既存設定を消してしまうため、key 存在チェックで「明示的に送られた
  // ときだけ」更新する。
  const hasAutoTagId = Object.prototype.hasOwnProperty.call(b, 'auto_tag_id');
  const autoTagId = hasAutoTagId
    ? ((b.auto_tag_id ?? '').trim() === '' ? null : (b.auto_tag_id as string))
    : null;
  if (hasAutoTagId && autoTagId) {
    const tagExists = await c.env.DB
      .prepare(`SELECT 1 FROM tags WHERE id = ?`)
      .bind(autoTagId)
      .first<{ 1: number }>();
    if (!tagExists) return c.json({ error: 'tag_not_found' }, 400);
  }
  if (hasAutoTagId) {
    await c.env.DB
      .prepare(
        `UPDATE menus
            SET name = ?, category_label = ?, description = ?,
                duration_minutes = ?, buffer_after_minutes = ?,
                base_price = ?, sort_order = ?, is_active = ?, auto_tag_id = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
          WHERE id = ? AND line_account_id = ?`,
      )
      .bind(
        b.name,
        b.category_label ?? null,
        b.description ?? null,
        b.duration_minutes,
        b.buffer_after_minutes ?? 0,
        b.base_price,
        b.sort_order ?? 0,
        b.is_active === false ? 0 : 1,
        autoTagId,
        id,
        accountId,
      )
      .run();
  } else {
    await c.env.DB
      .prepare(
        `UPDATE menus
            SET name = ?, category_label = ?, description = ?,
                duration_minutes = ?, buffer_after_minutes = ?,
                base_price = ?, sort_order = ?, is_active = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
          WHERE id = ? AND line_account_id = ?`,
      )
      .bind(
        b.name,
        b.category_label ?? null,
        b.description ?? null,
        b.duration_minutes,
        b.buffer_after_minutes ?? 0,
        b.base_price,
        b.sort_order ?? 0,
        b.is_active === false ? 0 : 1,
        id,
        accountId,
      )
      .run();
  }
  return c.json({ ok: true });
});

booking.delete('/api/booking/admin/menus/:id', async (c) => {
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

booking.get('/api/booking/admin/options', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const [options, menuRelations, locationRelations] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT id, name, description, additional_price,
                additional_duration_minutes, sort_order, is_active
           FROM booking_options
          WHERE line_account_id = ? AND deleted_at IS NULL
          ORDER BY sort_order ASC, id ASC`,
      )
      .bind(accountId)
      .all<BookingOptionRow>(),
    c.env.DB
      .prepare(
        `SELECT bom.option_id, bom.menu_id
           FROM booking_option_menus bom
           INNER JOIN booking_options bo ON bo.id = bom.option_id
          WHERE bo.line_account_id = ? AND bo.deleted_at IS NULL`,
      )
      .bind(accountId)
      .all<{ option_id: string; menu_id: string }>(),
    c.env.DB
      .prepare(
        `SELECT bol.option_id, bol.location_id
           FROM booking_option_locations bol
           INNER JOIN booking_options bo ON bo.id = bol.option_id
          WHERE bo.line_account_id = ? AND bo.deleted_at IS NULL`,
      )
      .bind(accountId)
      .all<{ option_id: string; location_id: string }>(),
  ]);
  return c.json({
    options: options.results.map((option) => ({
      ...option,
      menu_ids: menuRelations.results
        .filter((relation) => relation.option_id === option.id)
        .map((relation) => relation.menu_id),
      location_ids: locationRelations.results
        .filter((relation) => relation.option_id === option.id)
        .map((relation) => relation.location_id),
    })),
  });
});

booking.post('/api/booking/admin/options', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const body = await c.req.json<{
    name: string;
    description?: string | null;
    additional_price: number;
    additional_duration_minutes: number;
    sort_order?: number;
    is_active?: boolean;
    menu_ids: string[];
    location_ids: string[];
  }>();
  const name = body.name?.trim() ?? '';
  const menuIds = uniqueOptionIds(body.menu_ids);
  const locationIds = uniqueOptionIds(body.location_ids);
  if (
    !name ||
    name.length > 120 ||
    (body.description?.length ?? 0) > 10_000 ||
    !Number.isInteger(body.additional_price) ||
    body.additional_price < 0 ||
    !Number.isInteger(body.additional_duration_minutes) ||
    body.additional_duration_minutes < 0 ||
    !menuIds ||
    !locationIds ||
    !(await validateOptionRelations(c.env.DB, accountId, menuIds, locationIds))
  ) {
    return c.json({ error: 'invalid_option' }, 422);
  }
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO booking_options
        (id, line_account_id, name, description, additional_price,
         additional_duration_minutes, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      accountId,
      name,
      body.description?.trim() || null,
      body.additional_price,
      body.additional_duration_minutes,
      body.sort_order ?? 0,
      body.is_active === false ? 0 : 1,
    )
    .run();
  await replaceOptionRelations(c.env.DB, id, menuIds, locationIds);
  return c.json({ id }, 201);
});

booking.put('/api/booking/admin/options/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  const body = await c.req.json<{
    name: string;
    description?: string | null;
    additional_price: number;
    additional_duration_minutes: number;
    sort_order?: number;
    is_active?: boolean;
    menu_ids: string[];
    location_ids: string[];
  }>();
  const name = body.name?.trim() ?? '';
  const menuIds = uniqueOptionIds(body.menu_ids);
  const locationIds = uniqueOptionIds(body.location_ids);
  if (
    !name ||
    name.length > 120 ||
    (body.description?.length ?? 0) > 10_000 ||
    !Number.isInteger(body.additional_price) ||
    body.additional_price < 0 ||
    !Number.isInteger(body.additional_duration_minutes) ||
    body.additional_duration_minutes < 0 ||
    !menuIds ||
    !locationIds ||
    !(await validateOptionRelations(c.env.DB, accountId, menuIds, locationIds))
  ) {
    return c.json({ error: 'invalid_option' }, 422);
  }
  const result = await c.env.DB
    .prepare(
      `UPDATE booking_options
          SET name = ?, description = ?, additional_price = ?,
              additional_duration_minutes = ?, sort_order = ?, is_active = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`,
    )
    .bind(
      name,
      body.description?.trim() || null,
      body.additional_price,
      body.additional_duration_minutes,
      body.sort_order ?? 0,
      body.is_active === false ? 0 : 1,
      id,
      accountId,
    )
    .run();
  if ((result.meta?.changes ?? 0) === 0) return c.json({ error: 'option_not_found' }, 404);
  await replaceOptionRelations(c.env.DB, id, menuIds, locationIds);
  return c.json({ ok: true });
});

booking.delete('/api/booking/admin/options/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  await c.env.DB
    .prepare(
      `UPDATE booking_options
          SET is_active = 0,
              deleted_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'),
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND line_account_id = ?`,
    )
    .bind(c.req.param('id'), accountId)
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
booking.get('/api/booking/admin/availability', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const settings = await getBookingSettings(c.env.DB, accountId);
  const menuId = c.req.query('menu_id');
  const staffId = c.req.query('staff_id') || undefined;
  const locationId = c.req.query('location_id') || undefined;
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!menuId || !from || !to) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  if ((toD.getTime() - fromD.getTime()) / 86400_000 > 35) {
    return c.json({ error: 'range_too_wide' }, 400);
  }
  const result = await getAvailability(c.env.DB, {
    lineAccountId: accountId,
    menuId,
    staffId,
    locationId,
    from,
    to,
    now: new Date(),
    minLeadTimeMinutes: 0,
    granularityMinutes: settings.slot_interval_minutes,
  });
  return c.json(result);
});

// Proxy booking: the operator creates a CONFIRMED booking on behalf of a
// friend, straight from the iOS chat screen. Same shift/slot/conflict
// validation as the LIFF flow, but NO min-lead-time check (the operator
// may book a slot starting sooner than customers are allowed to).
booking.post('/api/booking/admin/bookings', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const settings = await getBookingSettings(c.env.DB, accountId);
  const body = await c.req.json<{
    friend_id: string;
    menu_id: string;
    staff_id: string;
    location_id: string;
    starts_at: string; // UTC ISO8601
    customer_note?: string;
  }>();
  if (!body.friend_id || !body.menu_id || !body.staff_id || !body.location_id || !body.starts_at) {
    return c.json({ error: 'missing_params' }, 400);
  }

  const friend = await c.env.DB
    .prepare(`SELECT id, is_following FROM friends WHERE id = ? AND line_account_id = ?`)
    .bind(body.friend_id, accountId)
    .first<{ id: string; is_following: number }>();
  if (!friend) return c.json({ error: 'friend_not_found' }, 404);
  if (friend.is_following === 0) return c.json({ error: 'cannot_book' }, 403);

  // staff が同じ account に属することを保証（別 tenant の staff への予約を防ぐ）。
  if (!(await assertStaffInAccount(c.env.DB, body.staff_id, accountId))) {
    return c.json({ error: 'staff_not_found' }, 404);
  }
  if (!(await assertLocationInAccount(c.env.DB, body.location_id, accountId))) {
    return c.json({ error: 'location_not_found' }, 404);
  }

  const menuRow = await c.env.DB
    .prepare(
      `SELECT m.id, m.duration_minutes, m.buffer_after_minutes, m.base_price,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS dur,
              COALESCE(sm.override_price, m.base_price) AS price,
              sm.is_offered
         FROM menus m
         LEFT JOIN staff_menus sm ON sm.menu_id = m.id AND sm.staff_id = ?2
        WHERE m.id = ?1 AND m.line_account_id = ?3
          AND m.deleted_at IS NULL AND m.is_active = 1`,
    )
    .bind(body.menu_id, body.staff_id, accountId)
    .first<{ duration_minutes: number; buffer_after_minutes: number; dur: number; price: number; is_offered: number | null }>();
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

  // Shift + slot validation — same shape as the LIFF create route.
  const startJstDate = new Date(startsAt.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const startJstHHMM = new Date(startsAt.getTime() + 9 * 3600_000).toISOString().slice(11, 16);
  const shift = await c.env.DB
    .prepare(
      `SELECT start_time, end_time
         FROM staff_shifts
        WHERE staff_id = ? AND work_date = ? AND location_id = ?`,
    )
    .bind(body.staff_id, startJstDate, body.location_id)
    .first<{ start_time: string; end_time: string }>();
  if (!shift) return c.json({ error: 'out_of_shift' }, 422);
  const existingBookings = await c.env.DB
    .prepare(
      `SELECT starts_at, block_ends_at FROM bookings
        WHERE staff_id = ? AND status IN ('requested','confirmed')
          AND starts_at < ? AND block_ends_at > ?`,
    )
    .bind(
      body.staff_id,
      jstDayWindowUtc(startJstDate).endUtc,
      jstDayWindowUtc(startJstDate).startUtc,
    )
    .all<{ starts_at: string; block_ends_at: string }>();
  const slotsToday = computeSlots({
    working: [{ start: shift.start_time, end: shift.end_time }],
    busy: existingBookings.results.map((b) => ({
      start: new Date(new Date(b.starts_at).getTime() + 9 * 3600_000).toISOString().slice(11, 16),
      end: new Date(new Date(b.block_ends_at).getTime() + 9 * 3600_000).toISOString().slice(11, 16),
    })),
    menu: { duration_minutes: menuRow.dur, buffer_after_minutes: menuRow.buffer_after_minutes },
    granularityMinutes: settings.slot_interval_minutes,
  });
  if (!slotsToday.some((s) => s.start === startJstHHMM)) {
    return c.json({ error: 'slot_not_available' }, 422);
  }

  const bookingId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const insertResult = await c.env.DB
    .prepare(
      `INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id, location_id,
         starts_at, ends_at, block_ends_at, status,
         customer_note, price_at_booking, requested_at, decided_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?
        WHERE NOT EXISTS (
          SELECT 1 FROM bookings
           WHERE staff_id = ?
             AND status IN ('requested','confirmed')
             AND starts_at < ?
             AND block_ends_at > ?
        )`,
    )
    .bind(
      bookingId,
      accountId,
      body.friend_id,
      body.staff_id,
      body.menu_id,
      body.location_id,
      startsAt.toISOString(),
      endsAt.toISOString(),
      blockEndsAt.toISOString(),
      'confirmed' satisfies BookingStatus,
      body.customer_note ?? null,
      menuRow.price,
      nowIso,
      nowIso,
      // NOT EXISTS subquery params
      body.staff_id,
      blockEndsAt.toISOString(),
      startsAt.toISOString(),
    )
    .run();
  if ((insertResult.meta?.changes ?? 0) === 0) {
    return c.json({ error: 'slot_conflict' }, 409);
  }

  await insertConfirmationReminders(c.env.DB, {
    bookingId,
    startsAt,
    now: new Date(),
  });
  c.executionCtx.waitUntil(
    notifyForBooking(c.env.DB, bookingId, 'approved').catch((err) =>
      console.error('booking notify (proxy-create) failed:', err),
    ),
  );
  c.executionCtx.waitUntil(
    syncBookingToGoogleCalendar(c.env.DB, bookingId).catch((err) =>
      console.error('booking Google Calendar sync (proxy-create) failed:', err),
    ),
  );
  return c.json({ booking_id: bookingId, status: 'confirmed' }, 201);
});

// ---- locations ----

booking.get('/api/booking/admin/locations', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, name, address, phone, access, sort_order, is_active
         FROM booking_locations
        WHERE line_account_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(accountId)
    .all();
  return c.json({ locations: rows.results });
});

booking.post('/api/booking/admin/locations', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const b = await c.req.json<{
    name: string;
    address?: string | null;
    phone?: string | null;
    access?: string | null;
    sort_order?: number;
  }>();
  if (!b.name?.trim()) return c.json({ error: 'name_required' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO booking_locations
        (id, line_account_id, name, address, phone, access, sort_order)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      accountId,
      b.name.trim(),
      b.address?.trim() || null,
      b.phone?.trim() || null,
      b.access?.trim() || null,
      b.sort_order ?? 0,
    )
    .run();
  return c.json({ id }, 201);
});

booking.put('/api/booking/admin/locations/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  const b = await c.req.json<{
    name: string;
    address?: string | null;
    phone?: string | null;
    access?: string | null;
    sort_order?: number;
    is_active?: boolean;
  }>();
  if (!b.name?.trim()) return c.json({ error: 'name_required' }, 400);
  await c.env.DB
    .prepare(
      `UPDATE booking_locations
          SET name = ?, address = ?, phone = ?, access = ?, sort_order = ?, is_active = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`,
    )
    .bind(
      b.name.trim(),
      b.address?.trim() || null,
      b.phone?.trim() || null,
      b.access?.trim() || null,
      b.sort_order ?? 0,
      b.is_active === false ? 0 : 1,
      id,
      accountId,
    )
    .run();
  return c.json({ ok: true });
});

booking.delete('/api/booking/admin/locations/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  const inUse = await c.env.DB
    .prepare(`SELECT 1 AS ok FROM staff_shifts WHERE location_id = ? LIMIT 1`)
    .bind(id)
    .first<{ ok: number }>();
  if (inUse) return c.json({ error: 'location_has_shifts' }, 409);
  await c.env.DB
    .prepare(
      `UPDATE booking_locations
          SET deleted_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND line_account_id = ?`,
    )
    .bind(id, accountId)
    .run();
  return c.json({ ok: true });
});

// ---- staff ----

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

booking.post('/api/booking/admin/staff', async (c) => {
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

booking.put('/api/booking/admin/staff/:id', async (c) => {
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

booking.delete('/api/booking/admin/staff/:id', async (c) => {
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

booking.put('/api/booking/admin/staff/:id/menus', async (c) => {
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
    ? `SELECT ss.id, ss.work_date, ss.start_time, ss.end_time,
              ss.location_id, bl.name AS location_name
         FROM staff_shifts ss
         LEFT JOIN booking_locations bl ON bl.id = ss.location_id
        WHERE ss.staff_id = ? AND ss.work_date BETWEEN ? AND ?
        ORDER BY ss.work_date ASC`
    : `SELECT ss.id, ss.work_date, ss.start_time, ss.end_time,
              ss.location_id, bl.name AS location_name
         FROM staff_shifts ss
         LEFT JOIN booking_locations bl ON bl.id = ss.location_id
        WHERE ss.staff_id = ?
        ORDER BY ss.work_date ASC`;
  const stmt = c.env.DB.prepare(sql);
  const rows = await (from && to ? stmt.bind(staffId, from, to) : stmt.bind(staffId)).all();
  return c.json({ shifts: rows.results });
});

booking.put('/api/booking/admin/staff/:id/shifts', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const b = await c.req.json<{
    shifts: Array<{
      work_date: string;
      start_time: string;
      end_time: string;
      location_id: string;
    }>;
  }>();
  // Upsert each row
  for (const s of b.shifts) {
    if (!(await assertLocationInAccount(c.env.DB, s.location_id, accountId))) {
      return c.json({ error: 'location_not_found' }, 404);
    }
    await c.env.DB
      .prepare(
        `INSERT INTO staff_shifts (id, staff_id, location_id, work_date, start_time, end_time)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(staff_id, work_date) DO UPDATE
            SET location_id = excluded.location_id,
                start_time = excluded.start_time,
                end_time = excluded.end_time,
                updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`,
      )
      .bind(crypto.randomUUID(), staffId, s.location_id, s.work_date, s.start_time, s.end_time)
      .run();
  }
  return c.json({ ok: true, count: b.shifts.length });
});

booking.delete('/api/booking/admin/staff/:id/shifts/:shiftId', async (c) => {
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

booking.post('/api/booking/admin/staff/:id/shifts/generate', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const b = await c.req.json<{
    from_date: string; // YYYY-MM-DD
    weeks: number;
    weekly_template: Record<
      'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat',
      { start: string; end: string; location_id: string } | null
    >;
  }>();
  if (!b.from_date || !b.weeks || !b.weekly_template) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const dayKeys: Array<keyof typeof b.weekly_template> = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const start = new Date(`${b.from_date}T00:00:00Z`);
  const stmts: D1PreparedStatement[] = [];
  const validatedLocationIds = new Set<string>();
  for (let i = 0; i < b.weeks * 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const tpl = b.weekly_template[dayKeys[d.getUTCDay()]];
    if (!tpl) continue;
    if (!validatedLocationIds.has(tpl.location_id)) {
      if (!(await assertLocationInAccount(c.env.DB, tpl.location_id, accountId))) {
        return c.json({ error: 'location_not_found' }, 404);
      }
      validatedLocationIds.add(tpl.location_id);
    }
    stmts.push(
      c.env.DB
        .prepare(
          `INSERT INTO staff_shifts (id, staff_id, location_id, work_date, start_time, end_time)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(staff_id, work_date) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          staffId,
          tpl.location_id,
          d.toISOString().slice(0, 10),
          tpl.start,
          tpl.end,
        ),
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
  const status = c.req.query('status');
  const sql = status === 'all'
    ? `SELECT b.*,
              m.name AS menu_name,
              s.display_name AS staff_name,
              bl.name AS location_name,
              f.display_name AS friend_name
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN booking_locations bl ON bl.id = b.location_id
         LEFT JOIN friends f ON f.id = b.friend_id
        WHERE b.line_account_id = ?
        ORDER BY b.starts_at ASC
        LIMIT 200`
    : `SELECT b.*,
              m.name AS menu_name,
              s.display_name AS staff_name,
              bl.name AS location_name,
              f.display_name AS friend_name
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN booking_locations bl ON bl.id = b.location_id
         LEFT JOIN friends f ON f.id = b.friend_id
        WHERE b.line_account_id = ? AND b.status = ?
        ORDER BY b.starts_at ASC
        LIMIT 200`;
  const stmt = c.env.DB.prepare(sql);
  const rows = await (status === 'all' || !status
    ? (status === 'all' ? stmt.bind(accountId) : stmt.bind(accountId, 'requested'))
    : stmt.bind(accountId, status)).all();
  return c.json({ requests: rows.results });
});

booking.patch('/api/booking/admin/requests/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  const b = await c.req.json<{ action: BookingAction }>();
  const row = await c.env.DB
    .prepare(`SELECT id, status, starts_at FROM bookings WHERE id = ? AND line_account_id = ?`)
    .bind(id, accountId)
    .first<{ id: string; status: BookingStatus; starts_at: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
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
    c.executionCtx.waitUntil(
      notifyForBooking(c.env.DB, id, 'approved').catch((err) =>
        console.error('booking notify (approved) failed:', err),
      ),
    );
    c.executionCtx.waitUntil(
      syncBookingToGoogleCalendar(c.env.DB, id).catch((err) =>
        console.error('booking Google Calendar sync failed:', err),
      ),
    );
  } else if (next === 'rejected') {
    c.executionCtx.waitUntil(
      notifyForBooking(c.env.DB, id, 'rejected').catch((err) =>
        console.error('booking notify (rejected) failed:', err),
      ),
    );
  } else if (next === 'cancelled' || next === 'expired') {
    await c.env.DB
      .prepare(
        `UPDATE booking_reminders SET status='cancelled' WHERE booking_id = ? AND status = 'pending'`,
      )
      .bind(id)
      .run();
    if (next === 'cancelled') {
      c.executionCtx.waitUntil(
        deleteBookingFromGoogleCalendar(c.env.DB, id).catch((err) =>
          console.error('booking Google Calendar delete failed:', err),
        ),
      );
    }
  }

  return c.json({ status: next });
});

booking.get('/api/booking/admin/action-requests', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const status = c.req.query('status') ?? 'requested';
  const rows = await c.env.DB
    .prepare(
      `SELECT ar.*,
              b.starts_at AS current_starts_at, b.status AS booking_status,
              b.customer_name, b.customer_phone,
              m.name AS current_menu_name,
              s.display_name AS current_staff_name,
              bl.name AS current_location_name,
              rm.name AS requested_menu_name,
              rs.display_name AS requested_staff_name,
              rbl.name AS requested_location_name
         FROM booking_action_requests ar
         INNER JOIN bookings b ON b.id = ar.booking_id
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN booking_locations bl ON bl.id = b.location_id
         LEFT JOIN menus rm ON rm.id = ar.requested_menu_id
         LEFT JOIN staff rs ON rs.id = ar.requested_staff_id
         LEFT JOIN booking_locations rbl ON rbl.id = ar.requested_location_id
        WHERE ar.line_account_id = ?
          AND (? = 'all' OR ar.status = ?)
        ORDER BY CASE WHEN ar.status = 'requested' THEN 0 ELSE 1 END,
                 ar.requested_at ASC
        LIMIT 200`,
    )
    .bind(accountId, status, status)
    .all();
  return c.json({ requests: rows.results });
});

booking.patch('/api/booking/admin/action-requests/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  const body = await c.req.json<{ decision?: 'approve' | 'reject' }>();
  if (!['approve', 'reject'].includes(body.decision ?? '')) {
    return c.json({ error: 'invalid_decision' }, 422);
  }
  const request = await c.env.DB
    .prepare(
      `SELECT ar.*, b.status AS booking_status,
              COALESCE(sm.override_price, m.base_price) AS requested_price
         FROM booking_action_requests ar
         INNER JOIN bookings b ON b.id = ar.booking_id
         LEFT JOIN menus m ON m.id = ar.requested_menu_id
         LEFT JOIN staff_menus sm
           ON sm.menu_id = ar.requested_menu_id
          AND sm.staff_id = ar.requested_staff_id
        WHERE ar.id = ? AND ar.line_account_id = ?`,
    )
    .bind(id, accountId)
    .first<{
      id: string;
      booking_id: string;
      request_type: 'change' | 'cancel';
      status: 'requested' | 'approved' | 'rejected';
      booking_status: BookingStatus;
      requested_location_id: string | null;
      requested_staff_id: string | null;
      requested_menu_id: string | null;
      requested_starts_at: string | null;
      requested_ends_at: string | null;
      requested_block_ends_at: string | null;
      customer_note: string | null;
      requested_price: number | null;
      requested_options_json: string | null;
    }>();
  if (!request) return c.json({ error: 'not_found' }, 404);
  if (request.status !== 'requested') {
    return c.json({ error: 'already_decided', status: request.status }, 409);
  }
  if (body.decision === 'approve') {
    if (request.request_type === 'cancel') {
      const result = await c.env.DB
        .prepare(
          `UPDATE bookings
              SET status = 'cancelled', decided_at = ?,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
            WHERE id = ? AND line_account_id = ?
              AND status IN ('requested','confirmed')`,
        )
        .bind(new Date().toISOString(), request.booking_id, accountId)
        .run();
      if ((result.meta?.changes ?? 0) === 0) {
        return c.json({ error: 'booking_state_changed' }, 409);
      }
      await c.env.DB
        .prepare(
          `UPDATE booking_reminders SET status = 'cancelled'
            WHERE booking_id = ? AND status IN ('pending','failed')`,
        )
        .bind(request.booking_id)
        .run();
    } else {
      if (
        !request.requested_location_id ||
        !request.requested_staff_id ||
        !request.requested_menu_id ||
        !request.requested_starts_at ||
        !request.requested_ends_at ||
        !request.requested_block_ends_at
      ) {
        return c.json({ error: 'invalid_change_request' }, 422);
      }
      let requestedOptions: BookingOptionRow[] = [];
      try {
        const parsed = JSON.parse(request.requested_options_json ?? '[]') as unknown;
        if (
          !Array.isArray(parsed) ||
          parsed.some(
            (option) =>
              typeof option !== 'object' ||
              option === null ||
              typeof (option as BookingOptionRow).id !== 'string' ||
              typeof (option as BookingOptionRow).name !== 'string' ||
              !Number.isInteger((option as BookingOptionRow).additional_price) ||
              !Number.isInteger((option as BookingOptionRow).additional_duration_minutes),
          )
        ) {
          return c.json({ error: 'invalid_change_options' }, 422);
        }
        requestedOptions = parsed as BookingOptionRow[];
      } catch {
        return c.json({ error: 'invalid_change_options' }, 422);
      }
      const requestedTotalPrice =
        request.requested_price === null
          ? null
          : request.requested_price +
            requestedOptions.reduce((sum, option) => sum + option.additional_price, 0);
      const result = await c.env.DB
        .prepare(
          `UPDATE bookings
              SET location_id = ?, staff_id = ?, menu_id = ?,
                  starts_at = ?, ends_at = ?, block_ends_at = ?,
                  price_at_booking = COALESCE(?, price_at_booking),
                  customer_note = COALESCE(?, customer_note),
                  updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
            WHERE id = ? AND line_account_id = ?
              AND status IN ('requested','confirmed')
              AND NOT EXISTS (
                SELECT 1 FROM bookings conflict
                 WHERE conflict.staff_id = ?
                   AND conflict.id != ?
                   AND conflict.status IN ('requested','confirmed')
                   AND conflict.starts_at < ?
                   AND conflict.block_ends_at > ?
              )`,
        )
        .bind(
          request.requested_location_id,
          request.requested_staff_id,
          request.requested_menu_id,
          request.requested_starts_at,
          request.requested_ends_at,
          request.requested_block_ends_at,
          requestedTotalPrice,
          request.customer_note,
          request.booking_id,
          accountId,
          request.requested_staff_id,
          request.booking_id,
          request.requested_block_ends_at,
          request.requested_starts_at,
        )
        .run();
      if ((result.meta?.changes ?? 0) === 0) {
        return c.json({ error: 'slot_conflict_or_booking_state_changed' }, 409);
      }
      await c.env.DB.batch([
        c.env.DB
          .prepare(`DELETE FROM booking_selected_options WHERE booking_id = ?`)
          .bind(request.booking_id),
        ...requestedOptions.map((option) =>
          c.env.DB
            .prepare(
              `INSERT INTO booking_selected_options
                (booking_id, option_id, option_name, additional_price, additional_duration_minutes)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(
              request.booking_id,
              option.id,
              option.name,
              option.additional_price,
              option.additional_duration_minutes,
            ),
        ),
      ]);
      await c.env.DB
        .prepare(
          `UPDATE booking_reminders SET status = 'cancelled'
            WHERE booking_id = ? AND status IN ('pending','failed')`,
        )
        .bind(request.booking_id)
        .run();
      if (request.booking_status === 'confirmed') {
        await insertConfirmationReminders(c.env.DB, {
          bookingId: request.booking_id,
          startsAt: new Date(request.requested_starts_at),
          now: new Date(),
        });
      }
    }
  }
  const nextStatus = body.decision === 'approve' ? 'approved' : 'rejected';
  const decided = await c.env.DB
    .prepare(
      `UPDATE booking_action_requests
          SET status = ?, decided_at = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND status = 'requested'`,
    )
    .bind(nextStatus, new Date().toISOString(), id)
    .run();
  if ((decided.meta?.changes ?? 0) === 0) {
    return c.json({ error: 'concurrent_update' }, 409);
  }
  const messageKey = `${request.request_type}_${nextStatus}`;
  c.executionCtx.waitUntil(
    notifyForBooking(
      c.env.DB,
      request.booking_id,
      nextStatus === 'approved' ? 'approved' : 'rejected',
      messageKey,
    ).catch((error) => console.error(`booking notify (${messageKey}) failed:`, error)),
  );
  if (body.decision === 'approve' && request.request_type === 'cancel') {
    c.executionCtx.waitUntil(
      deleteBookingFromGoogleCalendar(c.env.DB, request.booking_id).catch((error) =>
        console.error('booking Google Calendar cancel sync failed:', error),
      ),
    );
  }
  if (
    body.decision === 'approve' &&
    request.request_type === 'change' &&
    request.booking_status === 'confirmed'
  ) {
    c.executionCtx.waitUntil(
      (async () => {
        await deleteBookingFromGoogleCalendar(c.env.DB, request.booking_id);
        await syncBookingToGoogleCalendar(c.env.DB, request.booking_id);
      })().catch((error) =>
        console.error('booking Google Calendar change sync failed:', error),
      ),
    );
  }
  return c.json({ status: nextStatus });
});

// Pending count for sidebar badge.
booking.get('/api/booking/admin/pending-count', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const row = await c.env.DB
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM bookings
           WHERE line_account_id = ?1 AND status = 'requested')
         +
         (SELECT COUNT(*) FROM booking_action_requests
           WHERE line_account_id = ?1 AND status = 'requested') AS cnt`,
    )
    .bind(accountId)
    .first<{ cnt: number }>();
  return c.json({ count: row?.cnt ?? 0 });
});

export default booking;
