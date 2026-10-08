import { getBookingSyncRules } from '@line-crm/db';
import { activeTenantLineAccountSql, isOperationCapabilityStopped, resolveLineCredential } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { clientForConnection, type StaffCalendarConnection } from './booking-calendar-sync.js';
import { GoogleCalendarReadError } from './google-calendar.js';
import { getAccountTimeZone, tzDateStr } from './availability.js';
import { featureJobCanRun } from './feature-enforcement.js';
import type { GoogleServiceAccountCredentials } from './google-service-account.js';
import type { BookingConflict, BookingReceptionSource } from '@line-crm/shared';
export type { BookingConflict } from '@line-crm/shared';

const AUTO_ASSIGN_KEY = 'booking_auto_assign';
export async function getBookingAutoAssign(db: D1Database, accountId: string): Promise<boolean> {
  const row = await db.prepare('SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?').bind(accountId, AUTO_ASSIGN_KEY).first<{ value: string }>();
  return row?.value === 'true';
}
export async function saveBookingAutoAssign(db: D1Database, accountId: string, autoAssign: boolean): Promise<void> {
  await db.prepare(`INSERT INTO account_settings (id, line_account_id, key, value) VALUES (?,?,?,?)
    ON CONFLICT(line_account_id,key) DO UPDATE SET value = excluded.value,
    updated_at = strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')`).bind(crypto.randomUUID(), accountId, AUTO_ASSIGN_KEY, String(autoAssign)).run();
}

/** 店舗の暦日から UTC 境界を作る。週は月曜開始、夏時間もその日のずれで読む。 */
export function bookingChannelBounds(timeZone: string, now: Date) {
  const today = tzDateStr(timeZone, now);
  const date = new Date(`${today}T00:00:00Z`);
  const shift = (days: number) => new Date(date.getTime() + days * 86400000).toISOString().slice(0, 10);
  const midnight = (day: string) => {
    const wall = Date.parse(`${day}T00:00:00Z`);
    let guess = wall;
    for (let i = 0; i < 3; i++) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
      const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      guess += wall - asUtc;
    }
    return new Date(guess).toISOString();
  };
  const monday = -((date.getUTCDay() + 6) % 7);
  return { todayFrom: midnight(today), todayTo: midnight(shift(1)), weekFrom: midnight(shift(monday)), weekTo: midnight(shift(monday + 7)) };
}

export async function getBookingChannels(db: D1Database, accountId: string, credentials: GoogleServiceAccountCredentials, now = new Date()) {
  const timeZone = await getAccountTimeZone(db, accountId);
  const bounds = bookingChannelBounds(timeZone, now);
  const rows = await db.prepare(`SELECT s.id AS staff_id, s.display_name, gc.id, gc.calendar_id, gc.auth_type, gc.access_token,
    (SELECT value FROM account_settings WHERE line_account_id = s.line_account_id AND key = 'booking_calendar_last_read:' || s.id) AS last_read_at
    FROM staff s LEFT JOIN google_calendar_connections gc ON gc.staff_id = s.id AND gc.line_account_id = s.line_account_id AND gc.is_active = 1
    WHERE s.line_account_id = ? AND s.deleted_at IS NULL AND s.is_active = 1 ORDER BY s.sort_order,s.id`).bind(accountId).all<StaffCalendarConnection & { staff_id: string; display_name: string; last_read_at: string | null }>();
  const staff = [];
  for (const row of rows.results) {
    let status: 'connected' | 'disconnected' | 'expired' = row.id ? 'connected' : 'disconnected';
    let externalEventsThisWeek: number | null = null;
    let lastReadAt = row.last_read_at;
    let readError: string | null = null;
    if (row.id) {
      try {
        const client = await clientForConnection(row, credentials);
        const ids = await client.listEventIds(bounds.weekFrom, bounds.weekTo);
        // 自社から書き出した予約は「外の予定」に含めない。
        const internal = await db.prepare('SELECT external_event_id FROM bookings WHERE line_account_id = ? AND external_calendar_id = ? AND external_event_id IS NOT NULL').bind(accountId, row.calendar_id).all<{ external_event_id: string }>();
        const own = new Set(internal.results.map((booking) => booking.external_event_id));
        externalEventsThisWeek = ids.filter((id) => !own.has(id)).length;
        lastReadAt = now.toISOString();
        await db.prepare(`INSERT INTO account_settings (id,line_account_id,key,value) VALUES (?,?,?,?)
          ON CONFLICT(line_account_id,key) DO UPDATE SET value=excluded.value`).bind(crypto.randomUUID(), accountId, `booking_calendar_last_read:${row.staff_id}`, lastReadAt).run();
      } catch (error) {
        if ((error instanceof GoogleCalendarReadError && error.status === 401) || (row.auth_type !== 'service_account' && !row.access_token)) status = 'expired';
        readError = status === 'expired' ? 'calendar_auth_expired' : 'calendar_read_unavailable';
      }
    }
    staff.push({ staffId: row.staff_id, displayName: row.display_name, status, externalEventsThisWeek, lastReadAt, readError });
  }
  const counts = await db.prepare(`SELECT source,COUNT(*) AS count FROM bookings WHERE line_account_id = ? AND requested_at >= ? AND requested_at < ? GROUP BY source`).bind(accountId, bounds.todayFrom, bounds.todayTo).all<{ source: string; count: number }>();
  const count = (sources: string[]) => counts.results.filter((row) => sources.includes(row.source)).reduce((sum,row) => sum + row.count,0);
  return { timeZone, ...bounds, staff, autoAssign: await getBookingAutoAssign(db, accountId), channels: [
    { key: 'line', status: 'active', todayCount: count(['liff']) },
    { key: 'manual', status: 'active', todayCount: count(['phone','counter','operator']) },
    ...['hot_pepper_beauty','google_reserve','epark'].map((key) => ({ key, status: 'preparing', todayCount: null })),
  ] };
}

const BOOKING_SOURCE_LABELS: Record<BookingReceptionSource, string> = {
  liff: 'LINE（musubo）', phone: '電話', counter: '店頭', operator: 'スタッフによる登録', import: '外部取り込み',
};

export async function listBookingConflicts(db: D1Database, accountId: string): Promise<BookingConflict[]> {
  const rows = await db.prepare(`SELECT a.staff_id AS staffId,s.display_name AS staffName,a.id AS bookingId,b.id AS otherBookingId,
    a.starts_at AS startsAt,a.ends_at AS endsAt,b.starts_at AS otherStartsAt,b.ends_at AS otherEndsAt,
    a.lock_version AS version,b.lock_version AS otherVersion,
    COALESCE(NULLIF(af.display_name,''),NULLIF(ac.display_name,''),'名前未設定') AS customerName,
    COALESCE(NULLIF(bf.display_name,''),NULLIF(bc.display_name,''),'名前未設定') AS otherCustomerName,
    am.name AS menuName,bm.name AS otherMenuName,a.source AS source,b.source AS otherSource,
    EXISTS(SELECT 1 FROM google_calendar_connections gc
      WHERE gc.staff_id=a.staff_id AND gc.line_account_id=a.line_account_id AND gc.is_active=1) AS calendarConnected
    FROM bookings a INNER JOIN bookings b ON a.id < b.id AND a.line_account_id=b.line_account_id AND a.staff_id=b.staff_id
    INNER JOIN staff s ON s.id=a.staff_id AND s.line_account_id=a.line_account_id
    INNER JOIN menus am ON am.id=a.menu_id AND am.line_account_id=a.line_account_id
    INNER JOIN menus bm ON bm.id=b.menu_id AND bm.line_account_id=b.line_account_id
    LEFT JOIN friends af ON af.id=a.friend_id AND af.line_account_id=a.line_account_id
    LEFT JOIN friends bf ON bf.id=b.friend_id AND bf.line_account_id=b.line_account_id
    LEFT JOIN booking_customers ac ON ac.id=a.booking_customer_id AND ac.line_account_id=a.line_account_id
    LEFT JOIN booking_customers bc ON bc.id=b.booking_customer_id AND bc.line_account_id=b.line_account_id
    WHERE a.line_account_id = ? AND a.status IN ('requested','confirmed') AND b.status IN ('requested','confirmed')
      AND julianday(a.starts_at) < julianday(b.ends_at) AND julianday(b.starts_at) < julianday(a.ends_at)
    ORDER BY a.starts_at,a.id,b.id`).bind(accountId).all<Omit<BookingConflict, 'bookings' | 'reasonCode' | 'reason' | 'calendarConnected' | 'guidance'> & {
      customerName: string; otherCustomerName: string; menuName: string; otherMenuName: string;
      source: BookingReceptionSource; otherSource: BookingReceptionSource; calendarConnected: number;
    }>();
  return rows.results.map(({ customerName, otherCustomerName, menuName, otherMenuName, source, otherSource, calendarConnected, ...pair }) => ({
    ...pair,
    bookings: [
      { bookingId: pair.bookingId, customerName, menuName, staffId: pair.staffId, staffName: pair.staffName,
        startsAt: pair.startsAt, endsAt: pair.endsAt, source, sourceLabel: BOOKING_SOURCE_LABELS[source], version: pair.version },
      { bookingId: pair.otherBookingId, customerName: otherCustomerName, menuName: otherMenuName, staffId: pair.staffId, staffName: pair.staffName,
        startsAt: pair.otherStartsAt, endsAt: pair.otherEndsAt, source: otherSource, sourceLabel: BOOKING_SOURCE_LABELS[otherSource], version: pair.otherVersion },
    ],
    reasonCode: 'same_staff_time_overlap',
    reason: '同じ担当の予約時間が重なっています。',
    calendarConnected: Boolean(calendarConnected),
    guidance: calendarConnected ? null : '担当のGoogleカレンダーをつなぎ、外の予約もカレンダーへ書き出すと、次から重なりを防げます。',
  }));
}

export async function bookingAutomaticNotificationAllowed(db: D1Database, accountId: string): Promise<boolean> {
  const active = await db.prepare(`SELECT la.id FROM line_accounts la WHERE la.id = ? AND ${activeTenantLineAccountSql('la.id')}`).bind(accountId).first();
  return Boolean(active)
    && await featureJobCanRun(db, { accountId, featureId: 'booking', job: 'booking automatic notification' })
    && !await isOperationCapabilityStopped(db, accountId, 'broadcast_dispatch');
}

/** 同じ組合せ・同じ版は再通知しない。失敗時は同じ再試行キーで回復する。 */
export async function notifyBookingConflicts(db: D1Database, accountId: string): Promise<void> {
  if(!(await getBookingSyncRules(db,accountId)).notifyConflicts)return;
  const conflicts = await listBookingConflicts(db, accountId);
  for (const conflict of conflicts) {
    const recipient = await db.prepare(`SELECT sm.line_user_id,sm.notification_preferences,la.channel_access_token,la.channel_access_token_encrypted
      FROM staff s INNER JOIN staff_members sm ON sm.id=s.staff_member_id
      INNER JOIN line_accounts la ON la.id=s.line_account_id AND la.tenant_id=sm.tenant_id
      WHERE s.id=? AND s.line_account_id=? AND sm.is_active=1 AND sm.line_user_id IS NOT NULL
      AND (COALESCE(sm.account_scope,'all')='all' OR sm.assigned_line_account_id=s.line_account_id)
      AND ${activeTenantLineAccountSql('s.line_account_id')}`).bind(conflict.staffId, accountId).first<{ notification_preferences: string; line_user_id: string; channel_access_token: string; channel_access_token_encrypted: string | null }>();
    if (!recipient || !await bookingAutomaticNotificationAllowed(db, accountId)) continue;
    try {
      const preferences = JSON.parse(recipient.notification_preferences);
      if (preferences?.operator?.line === false) continue;
    } catch { /* 旧設定の空欄は既定値 */ }
    const key = `booking_conflict:${conflict.bookingId}:${conflict.version}:${conflict.otherBookingId}:${conflict.otherVersion}`;
    const now = Date.now();
    const stored = await db.prepare('SELECT value FROM account_settings WHERE line_account_id=? AND key=?').bind(accountId,key).first<{ value: string }>();
    let retryKey = crypto.randomUUID();
    if (stored) {
      try {
        const previous = JSON.parse(stored.value) as { status: string; retryKey: string; claimedAt: number };
        if (previous.status === 'sent' || (previous.status === 'sending' && previous.claimedAt > now - 300000)) continue;
        if (!previous.retryKey) continue;
        retryKey = previous.retryKey;
      } catch { continue; }
    }
    const claimedValue = JSON.stringify({ status:'sending',retryKey,claimedAt:now });
    const claim = stored
      ? await db.prepare('UPDATE account_settings SET value=? WHERE line_account_id=? AND key=? AND value=?').bind(claimedValue,accountId,key,stored.value).run()
      : await db.prepare('INSERT OR IGNORE INTO account_settings (id,line_account_id,key,value) VALUES (?,?,?,?)').bind(crypto.randomUUID(),accountId,key,claimedValue).run();
    if (!claim.meta.changes) continue;
    const finish = async (status: 'sent' | 'retry_wait') => {
      await db.prepare('UPDATE account_settings SET value=? WHERE line_account_id=? AND key=? AND value=?')
        .bind(JSON.stringify({ status,retryKey,claimedAt:now }),accountId,key,claimedValue).run();
    };
    try {
      const token = await resolveLineCredential(recipient.channel_access_token_encrypted,recipient.channel_access_token,{ lineAccountId: accountId, field: 'channel_access_token' });
      // 送信直前にも停止を確認する。自動通知に manual は付けない。
      if (!await bookingAutomaticNotificationAllowed(db, accountId)) {
        await finish('retry_wait');
        continue;
      }
      await new LineClient(token).pushMessage(recipient.line_user_id,[{ type: 'text', text: `${conflict.staffName}さんの予約が重なっています。予約管理で別のスタッフへの変更を確認してください。` }],retryKey);
      await finish('sent');
    } catch {
      await finish('retry_wait');
      throw new Error('booking_conflict_notification_failed');
    }
  }
}
