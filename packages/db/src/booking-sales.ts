import { jstNow } from './utils.js';
import { getBookingPaymentConfig } from './booking-payments.js';

/**
 * 予約の追加機能のデータ層。
 *
 * 7 売上：期間・メニュー別・曜日別の件数と売上（料金×確定数）、
 *    キャンセル率、来なかった率。
 * 8 無断キャンセル：来なかった（bookings.status = 'no_show'）の回数を数え、
 *    基準を超えたら前払いのみ。店が手で付け外しできる。
 */

export type NoshowFlagMode = 'auto' | 'manual_on' | 'manual_off';

export type NoshowNoPaymentMode = 'notice' | 'notice_call';

export interface NoshowSettings {
  /** 印の仕組み全体のオン／オフ */
  enabled: boolean;
  /** 何回目から前払いのみか（既定3） */
  threshold: number;
  /** 数える期間（直近○か月、既定6） */
  windowMonths: number;
  /** 決済が無い店の扱い */
  noPaymentMode: NoshowNoPaymentMode;
}

function normalizeNoshowSettings(row: {
  enabled?: unknown; threshold?: unknown; window_months?: unknown; no_payment_mode?: unknown;
} | null): NoshowSettings {
  const threshold = Number(row?.threshold);
  const windowMonths = Number(row?.window_months);
  const noPaymentMode = row?.no_payment_mode;
  return {
    enabled: row?.enabled === null || row?.enabled === undefined ? true : Number(row.enabled) === 1,
    threshold: Number.isInteger(threshold) && threshold >= 1 && threshold <= 100 ? threshold : 3,
    windowMonths: Number.isInteger(windowMonths) && windowMonths >= 1 && windowMonths <= 120
      ? windowMonths
      : 6,
    noPaymentMode: noPaymentMode === 'notice' ? 'notice' : 'notice_call',
  };
}

export async function getNoshowSettings(db: D1Database, lineAccountId: string): Promise<NoshowSettings> {
  const row = await db.prepare(
    `SELECT enabled, threshold, window_months, no_payment_mode
       FROM booking_noshow_thresholds WHERE line_account_id = ?`,
  ).bind(lineAccountId).first<{
    enabled: number; threshold: number; window_months: number; no_payment_mode: string;
  }>();
  return normalizeNoshowSettings(row);
}

export async function saveNoshowSettings(
  db: D1Database,
  lineAccountId: string,
  settings: NoshowSettings,
): Promise<NoshowSettings> {
  const now = jstNow();
  await db.prepare(
    `INSERT INTO booking_noshow_thresholds
       (line_account_id, enabled, threshold, window_months, no_payment_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(line_account_id) DO UPDATE SET
       enabled = excluded.enabled,
       threshold = excluded.threshold,
       window_months = excluded.window_months,
       no_payment_mode = excluded.no_payment_mode,
       updated_at = excluded.updated_at`,
  ).bind(
    lineAccountId,
    settings.enabled ? 1 : 0,
    settings.threshold,
    settings.windowMonths,
    settings.noPaymentMode,
    now,
    now,
  ).run();
  return settings;
}

/** 数える期間の始まり（JSTの今から○か月前）。 */
export function noshowWindowSince(windowMonths: number, nowMs = Date.now()): string {
  const now = new Date(nowMs + 9 * 3600_000);
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - windowMonths, now.getUTCDate()));
  return since.toISOString();
}

/** 来なかった回数（friend_id がある予約だけ数える。期間つき）。 */
export async function countFriendNoshows(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
  since?: string,
): Promise<number> {
  const row = since
    ? await db.prepare(
      `SELECT COUNT(*) AS count FROM bookings
        WHERE line_account_id = ? AND friend_id = ? AND status = 'no_show' AND starts_at >= ?`,
    ).bind(lineAccountId, friendId, since).first<{ count: number }>()
    : await db.prepare(
      `SELECT COUNT(*) AS count FROM bookings
        WHERE line_account_id = ? AND friend_id = ? AND status = 'no_show'`,
    ).bind(lineAccountId, friendId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

/** 来なかった日（新しい順、印に並べる分だけ）。 */
export async function listFriendNoshowDates(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
  since: string,
  limit = 5,
): Promise<string[]> {
  const rows = await db.prepare(
    `SELECT starts_at FROM bookings
      WHERE line_account_id = ? AND friend_id = ? AND status = 'no_show' AND starts_at >= ?
      ORDER BY starts_at DESC LIMIT ?`,
  ).bind(lineAccountId, friendId, since, limit).all<{ starts_at: string }>();
  return (rows.results ?? []).map((row) => row.starts_at);
}

export async function getNoshowFlagMode(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
): Promise<NoshowFlagMode> {
  const row = await db.prepare(
    `SELECT mode FROM booking_noshow_flags WHERE line_account_id = ? AND friend_id = ?`,
  ).bind(lineAccountId, friendId).first<{ mode: string }>();
  return row?.mode === 'manual_on' || row?.mode === 'manual_off' ? row.mode : 'auto';
}

export async function setNoshowFlagMode(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
  mode: NoshowFlagMode,
): Promise<void> {
  const now = jstNow();
  if (mode === 'auto') {
    await db.prepare(
      `DELETE FROM booking_noshow_flags WHERE line_account_id = ? AND friend_id = ?`,
    ).bind(lineAccountId, friendId).run();
    return;
  }
  await db.prepare(
    `INSERT INTO booking_noshow_flags (line_account_id, friend_id, mode, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(line_account_id, friend_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`,
  ).bind(lineAccountId, friendId, mode, now).run();
}

export interface NoshowFlagEvent {
  action: 'manual_on' | 'manual_off';
  reason: string | null;
  staffId: string | null;
  staffName: string | null;
  at: string;
}

/** 印を付け外しした記録（理由は1行、だれがいつしたか残す）。 */
export async function logNoshowFlagEvent(
  db: D1Database,
  args: {
    lineAccountId: string;
    friendId: string;
    action: 'manual_on' | 'manual_off';
    reason?: string | null;
    staffId?: string | null;
    staffName?: string | null;
  },
): Promise<void> {
  const id = args.action === 'manual_on'
    ? `noshow-on-${args.friendId}-${Date.now()}`
    : `noshow-off-${args.friendId}-${Date.now()}`;
  await db.prepare(
    `INSERT INTO booking_noshow_flag_events
       (id, line_account_id, friend_id, action, reason, staff_id, staff_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    args.lineAccountId,
    args.friendId,
    args.action,
    args.reason ?? null,
    args.staffId ?? null,
    args.staffName ?? null,
    jstNow(),
  ).run();
}

/** その人の印の記録のうち最新の1つ。 */
export async function getLastNoshowFlagEvent(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
): Promise<NoshowFlagEvent | null> {
  const row = await db.prepare(
    `SELECT action, reason, staff_id, staff_name, created_at
       FROM booking_noshow_flag_events
      WHERE line_account_id = ? AND friend_id = ?
      ORDER BY created_at DESC LIMIT 1`,
  ).bind(lineAccountId, friendId).first<{
    action: string; reason: string | null; staff_id: string | null; staff_name: string | null;
    created_at: string;
  }>();
  if (!row || (row.action !== 'manual_on' && row.action !== 'manual_off')) return null;
  return {
    action: row.action, reason: row.reason, staffId: row.staff_id, staffName: row.staff_name, at: row.created_at,
  };
}

export interface PrepayDecision {
  /** 来なかった回数（数える期間の中） */
  noshowCount: number;
  /** 基準（既定3） */
  threshold: number;
  /** 印の仕組み全体のオン／オフ */
  enabled: boolean;
  /** 数える期間（直近○か月） */
  windowMonths: number;
  /** 決済が無い店の扱い */
  noPaymentMode: NoshowNoPaymentMode;
  /** 前払いのみか */
  prepayOnly: boolean;
  /** 手動の印か（店が付けた・外した） */
  manual: boolean;
  /** 来なかった日（新しい順、印に並べる分） */
  recentDates: string[];
  /** 印の記録のうち最新の1つ */
  lastEvent: NoshowFlagEvent | null;
}

/**
 * 前払いの人への案内文。決済を入れた店は支払いの案内、
 * 決済が無い店は店の決めた扱い（印だけ・電話で確認）に合わせる。
 */
export async function prepayNoticeFor(
  db: D1Database,
  lineAccountId: string,
  decision: PrepayDecision,
): Promise<string | null> {
  if (!decision.prepayOnly) return null;
  const config = await getBookingPaymentConfig(db, lineAccountId);
  if (config.mode === 'online') {
    return '無断キャンセルが続いているため、この予約は前払いのみです。お支払いが終わるまで確定しません。';
  }
  if (decision.noPaymentMode === 'notice_call') {
    return '無断キャンセルが続いているため、この予約は前払いのみです。来店前に店舗から電話で確認します。';
  }
  return '無断キャンセルが続いているため、この予約は前払いのみです。';
}

/** 前払いのみの判定。仕組みがオフなら前払いのみにしない。手動があれば手動、なければ回数と基準。 */
export async function decidePrepayOnly(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
): Promise<PrepayDecision> {
  const [settings, mode] = await Promise.all([
    getNoshowSettings(db, lineAccountId),
    getNoshowFlagMode(db, lineAccountId, friendId),
  ]);
  const since = noshowWindowSince(settings.windowMonths);
  const [count, recentDates, lastEvent] = await Promise.all([
    countFriendNoshows(db, lineAccountId, friendId, since),
    listFriendNoshowDates(db, lineAccountId, friendId, since),
    getLastNoshowFlagEvent(db, lineAccountId, friendId),
  ]);
  const base = {
    noshowCount: count,
    threshold: settings.threshold,
    enabled: settings.enabled,
    windowMonths: settings.windowMonths,
    noPaymentMode: settings.noPaymentMode,
    recentDates,
    lastEvent,
  };
  if (!settings.enabled) return { ...base, prepayOnly: false, manual: mode !== 'auto' };
  if (mode === 'manual_on') return { ...base, prepayOnly: true, manual: true };
  if (mode === 'manual_off') return { ...base, prepayOnly: false, manual: true };
  return { ...base, prepayOnly: count > settings.threshold, manual: false };
}

export interface SalesSummaryMenu {
  menu_id: string;
  menu_name: string;
  bookings: number;
  confirmed: number;
  revenue: number;
  cancelRate: number;
  noshowRate: number;
}

export interface SalesSummaryWeekday {
  weekday: number;
  bookings: number;
  confirmed: number;
  revenue: number;
}

export interface SalesSummaryTotal {
  bookings: number;
  confirmed: number;
  revenue: number;
  cancelRate: number;
  noshowRate: number;
  cancelled: number;
  noshow: number;
}

export interface SalesSummary {
  from: string;
  to: string;
  total: SalesSummaryTotal;
  menus: SalesSummaryMenu[];
  weekdays: SalesSummaryWeekday[];
  /** 直前の同じ長さの期間（「先月より」の表示用）。 */
  previous: { revenue: number; bookings: number; cancelRate: number; noshowRate: number };
  /** 売上の数え方。決済を入れた店は実際の入金で数える。 */
  revenueSource: 'menu' | 'paid';
}

const CANCELLED = ['cancelled', 'rejected'];

interface SalesRow {
  menu_id: string; menu_name: string | null; status: string; price: number; weekday: number;
}

async function fetchSalesRows(
  db: D1Database,
  lineAccountId: string,
  from: string,
  to: string,
): Promise<SalesRow[]> {
  const rows = await db.prepare(
    `SELECT b.menu_id, m.name AS menu_name, b.status,
            COALESCE(b.price_at_booking, m.base_price, 0) AS price,
            CAST(strftime('%w', b.starts_at) AS INTEGER) AS weekday
       FROM bookings b
       LEFT JOIN menus m ON m.id = b.menu_id
      WHERE b.line_account_id = ? AND b.starts_at >= ? AND b.starts_at < ?`,
  ).bind(lineAccountId, from, to).all<SalesRow>();
  return rows.results ?? [];
}

interface PaidRevenue {
  menuId: string;
  menuName: string;
  weekday: number;
  amount: number;
}

/** 期間内の支払い済みの入金（決済を入れた店の売上用）。予約のメニュー・曜日に分ける。 */
async function fetchPaidRevenue(
  db: D1Database,
  lineAccountId: string,
  from: string,
  to: string,
): Promise<PaidRevenue[]> {
  const rows = await db.prepare(
    `SELECT b.menu_id, m.name AS menu_name, p.amount,
            CAST(strftime('%w', b.starts_at) AS INTEGER) AS weekday
       FROM booking_payments p
       JOIN bookings b ON b.id = p.booking_id
       LEFT JOIN menus m ON m.id = b.menu_id
      WHERE p.line_account_id = ? AND p.status = 'paid'
        AND p.paid_at IS NOT NULL AND p.paid_at >= ? AND p.paid_at < ?`,
  ).bind(lineAccountId, from, to).all<{
    menu_id: string; amount: number; menu_name: string | null; weekday: number;
  }>();
  return (rows.results ?? []).map((row) => ({
    menuId: row.menu_id ?? '',
    menuName: row.menu_name ?? '',
    weekday: Number(row.weekday),
    amount: Number(row.amount ?? 0),
  }));
}

function summarizeRows(
  rows: SalesRow[],
  paidRevenues?: PaidRevenue[],
): {
  total: SalesSummaryTotal;
  menus: SalesSummaryMenu[];
  weekdays: SalesSummaryWeekday[];
} {
  const byMenu = new Map<string, SalesSummaryMenu & { cancelled: number; noshow: number }>();
  const byWeekday = new Map<number, SalesSummaryWeekday>();
  let bookings = 0;
  let confirmed = 0;
  let revenue = 0;
  let cancelled = 0;
  let noshow = 0;
  const ensureMenu = (menuId: string, menuName: string) => {
    let menu = byMenu.get(menuId);
    if (!menu) {
      menu = {
        menu_id: menuId, menu_name: menuName, bookings: 0,
        confirmed: 0, revenue: 0, cancelRate: 0, noshowRate: 0, cancelled: 0, noshow: 0,
      };
      byMenu.set(menuId, menu);
    }
    return menu;
  };
  const ensureDay = (weekday: number) => {
    let day = byWeekday.get(weekday);
    if (!day) {
      day = { weekday, bookings: 0, confirmed: 0, revenue: 0 };
      byWeekday.set(weekday, day);
    }
    return day;
  };
  for (const row of rows) {
    const price = Number(row.price ?? 0);
    const menuId = row.menu_id ?? '';
    const menu = ensureMenu(menuId, row.menu_name ?? '');
    const day = ensureDay(Number(row.weekday));
    bookings += 1;
    menu.bookings += 1;
    day.bookings += 1;
    if (row.status === 'confirmed') {
      confirmed += 1;
      menu.confirmed += 1;
      day.confirmed += 1;
      revenue += price;
      menu.revenue += price;
      day.revenue += price;
    } else if (CANCELLED.includes(row.status)) {
      cancelled += 1;
      menu.cancelled += 1;
    } else if (row.status === 'no_show') {
      noshow += 1;
      menu.noshow += 1;
    }
  }
  // 決済を入れた店は、確定数×料金ではなく実際の入金で数え直す。
  if (paidRevenues) {
    revenue = 0;
    for (const menu of byMenu.values()) menu.revenue = 0;
    for (const day of byWeekday.values()) day.revenue = 0;
    for (const paid of paidRevenues) {
      revenue += paid.amount;
      ensureMenu(paid.menuId, paid.menuName).revenue += paid.amount;
      ensureDay(paid.weekday).revenue += paid.amount;
    }
  }
  const rate = (part: number) => (bookings > 0 ? part / bookings : 0);
  return {
    total: {
      bookings, confirmed, revenue,
      cancelRate: rate(cancelled), noshowRate: rate(noshow),
      cancelled, noshow,
    },
    menus: [...byMenu.values()].map((menu) => ({
      menu_id: menu.menu_id,
      menu_name: menu.menu_name,
      bookings: menu.bookings,
      confirmed: menu.confirmed,
      revenue: menu.revenue,
      cancelRate: menu.bookings > 0 ? menu.cancelled / menu.bookings : 0,
      noshowRate: menu.bookings > 0 ? menu.noshow / menu.bookings : 0,
    })),
    weekdays: [...byWeekday.values()].sort((a, b) => a.weekday - b.weekday),
  };
}

/**
 * 予約からの売上。決済を入れていない店は予約時の料金×確定数、
 * 決済を入れた店は実際の入金で数える。
 * キャンセル率は取消・拒否の割合、来なかった率は無断の割合。
 */
export async function getBookingSalesSummary(
  db: D1Database,
  lineAccountId: string,
  from: string,
  to: string,
): Promise<SalesSummary> {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const span = toMs - fromMs;
  const prevTo = new Date(fromMs).toISOString();
  const prevFrom = new Date(fromMs - span).toISOString();
  const [rows, prevRows, paymentConfig] = await Promise.all([
    fetchSalesRows(db, lineAccountId, from, to),
    fetchSalesRows(db, lineAccountId, prevFrom, prevTo),
    getBookingPaymentConfig(db, lineAccountId),
  ]);
  const usePaid = paymentConfig.mode === 'online';
  const paidRevenues = usePaid
    ? await fetchPaidRevenue(db, lineAccountId, from, to)
    : undefined;
  const current = summarizeRows(rows, paidRevenues);
  const previous = summarizeRows(prevRows);
  return {
    from,
    to,
    total: current.total,
    menus: current.menus,
    weekdays: current.weekdays,
    previous: {
      revenue: previous.total.revenue,
      bookings: previous.total.bookings,
      cancelRate: previous.total.cancelRate,
      noshowRate: previous.total.noshowRate,
    },
    revenueSource: usePaid ? 'paid' : 'menu',
  };
}
