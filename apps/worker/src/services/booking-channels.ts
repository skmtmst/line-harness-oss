import { activeTenantLineAccountSql, isOperationCapabilityStopped, resolveLineCredential } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { clientForConnection, type StaffCalendarConnection } from './booking-calendar-sync.js';
import { GoogleCalendarReadError } from './google-calendar.js';
import { getAccountTimeZone, tzDateStr } from './availability.js';
import { featureJobCanRun } from './feature-enforcement.js';
import type { GoogleServiceAccountCredentials } from './google-service-account.js';

const AUTO_ASSIGN_KEY = 'booking_auto_assign';

/**
 * F-25 人の予約の自動で合わせるルール（7項目）。
 * autoAssign は既存の booking_auto_assign の鍵をそのまま使い、今の動きを変えない。
 */
export interface BookingAutoRules {
  excludeCalendarBlock: boolean
  writeBackToCalendar: boolean
  autoAssign: boolean
  mergeDuplicates: boolean
  conflictNotify: boolean
  unconnectedNotify: boolean
  dailyLimitNotify: boolean
}

const BOOKING_AUTO_RULE_KEYS: Array<{ field: keyof BookingAutoRules; key: string; defaultValue: boolean }> = [
  { field: 'excludeCalendarBlock', key: 'booking_auto_rule_exclude_calendar_block', defaultValue: true },
  { field: 'writeBackToCalendar', key: 'booking_auto_rule_write_back_to_calendar', defaultValue: true },
  { field: 'autoAssign', key: AUTO_ASSIGN_KEY, defaultValue: false },
  { field: 'mergeDuplicates', key: 'booking_auto_rule_merge_duplicates', defaultValue: true },
  { field: 'conflictNotify', key: 'booking_auto_rule_conflict_notify', defaultValue: true },
  { field: 'unconnectedNotify', key: 'booking_auto_rule_unconnected_notify', defaultValue: true },
  { field: 'dailyLimitNotify', key: 'booking_auto_rule_daily_limit_notify', defaultValue: false },
];

export async function getBookingAutoRules(db: D1Database, accountId: string): Promise<BookingAutoRules> {
  const rows = await db.prepare(
    `SELECT key, value FROM account_settings WHERE line_account_id = ? AND key IN (${BOOKING_AUTO_RULE_KEYS.map(() => '?').join(',')})`,
  ).bind(accountId, ...BOOKING_AUTO_RULE_KEYS.map((entry) => entry.key)).all<{ key: string; value: string }>();
  const values = new Map(rows.results.map((row) => [row.key, row.value]));
  const read = (entry: (typeof BOOKING_AUTO_RULE_KEYS)[number]): boolean => {
    const raw = values.get(entry.key);
    return raw === undefined ? entry.defaultValue : raw === 'true';
  };
  return {
    excludeCalendarBlock: read(BOOKING_AUTO_RULE_KEYS[0]),
    writeBackToCalendar: read(BOOKING_AUTO_RULE_KEYS[1]),
    autoAssign: read(BOOKING_AUTO_RULE_KEYS[2]),
    mergeDuplicates: read(BOOKING_AUTO_RULE_KEYS[3]),
    conflictNotify: read(BOOKING_AUTO_RULE_KEYS[4]),
    unconnectedNotify: read(BOOKING_AUTO_RULE_KEYS[5]),
    dailyLimitNotify: read(BOOKING_AUTO_RULE_KEYS[6]),
  };
}

export async function saveBookingAutoRules(db: D1Database, accountId: string, rules: BookingAutoRules): Promise<void> {
  for (const entry of BOOKING_AUTO_RULE_KEYS) {
    await db.prepare(`INSERT INTO account_settings (id, line_account_id, key, value) VALUES (?,?,?,?)
    ON CONFLICT(line_account_id,key) DO UPDATE SET value = excluded.value,
    updated_at = strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')`).bind(crypto.randomUUID(), accountId, entry.key, String(rules[entry.field])).run();
  }
}
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

export interface BookingConflict {
  staffId: string; staffName: string; bookingId: string; otherBookingId: string;
  startsAt: string; endsAt: string; otherStartsAt: string; otherEndsAt: string;
  version: number; otherVersion: number;
}
export async function listBookingConflicts(db: D1Database, accountId: string): Promise<BookingConflict[]> {
  const rows = await db.prepare(`SELECT a.staff_id AS staffId,s.display_name AS staffName,a.id AS bookingId,b.id AS otherBookingId,
    a.starts_at AS startsAt,a.ends_at AS endsAt,b.starts_at AS otherStartsAt,b.ends_at AS otherEndsAt,
    a.lock_version AS version,b.lock_version AS otherVersion
    FROM bookings a INNER JOIN bookings b ON a.id < b.id AND a.line_account_id=b.line_account_id AND a.staff_id=b.staff_id
    INNER JOIN staff s ON s.id=a.staff_id AND s.line_account_id=a.line_account_id
    WHERE a.line_account_id = ? AND a.status IN ('requested','confirmed') AND b.status IN ('requested','confirmed')
      AND julianday(a.starts_at) < julianday(b.ends_at) AND julianday(b.starts_at) < julianday(a.ends_at)
    ORDER BY a.starts_at,a.id,b.id`).bind(accountId).all<BookingConflict>();
  return rows.results;
}

export async function bookingAutomaticNotificationAllowed(db: D1Database, accountId: string): Promise<boolean> {
  const active = await db.prepare(`SELECT la.id FROM line_accounts la WHERE la.id = ? AND ${activeTenantLineAccountSql('la.id')}`).bind(accountId).first();
  return Boolean(active)
    && await featureJobCanRun(db, { accountId, featureId: 'booking', job: 'booking automatic notification' })
    && !await isOperationCapabilityStopped(db, accountId, 'broadcast_dispatch');
}

/** 同じ組合せ・同じ版は再通知しない。失敗時は同じ再試行キーで回復する。 */
export async function notifyBookingConflicts(db: D1Database, accountId: string): Promise<void> {
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
