import { jstNow } from './utils.js';

/**
 * 予約の追加機能のデータ層。
 *
 * 7 売上：期間・メニュー別・曜日別の件数と売上（料金×確定数）、
 *    キャンセル率、来なかった率。
 * 8 無断キャンセル：来なかった（bookings.status = 'no_show'）の回数を数え、
 *    基準を超えたら前払いのみ。店が手で付け外しできる。
 */

export type NoshowFlagMode = 'auto' | 'manual_on' | 'manual_off';

export async function getNoshowThreshold(db: D1Database, lineAccountId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT threshold FROM booking_noshow_thresholds WHERE line_account_id = ?`,
  ).bind(lineAccountId).first<{ threshold: number }>();
  const value = Number(row?.threshold);
  return Number.isInteger(value) && value >= 1 && value <= 100 ? value : 3;
}

export async function saveNoshowThreshold(
  db: D1Database,
  lineAccountId: string,
  threshold: number,
): Promise<number> {
  const now = jstNow();
  await db.prepare(
    `INSERT INTO booking_noshow_thresholds (line_account_id, threshold, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(line_account_id) DO UPDATE SET threshold = excluded.threshold, updated_at = excluded.updated_at`,
  ).bind(lineAccountId, threshold, now, now).run();
  return threshold;
}

/** 来なかった回数（friend_id がある予約だけ数える）。 */
export async function countFriendNoshows(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM bookings
      WHERE line_account_id = ? AND friend_id = ? AND status = 'no_show'`,
  ).bind(lineAccountId, friendId).first<{ count: number }>();
  return Number(row?.count ?? 0);
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

export interface PrepayDecision {
  /** 来なかった回数 */
  noshowCount: number;
  /** 基準（既定3） */
  threshold: number;
  /** 前払いのみか */
  prepayOnly: boolean;
  /** 手動の印か（店が付けた・外した） */
  manual: boolean;
}

/** 前払いのみの判定。手動があれば手動、なければ回数と基準。 */
export async function decidePrepayOnly(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
): Promise<PrepayDecision> {
  const [count, threshold, mode] = await Promise.all([
    countFriendNoshows(db, lineAccountId, friendId),
    getNoshowThreshold(db, lineAccountId),
    getNoshowFlagMode(db, lineAccountId, friendId),
  ]);
  if (mode === 'manual_on') return { noshowCount: count, threshold, prepayOnly: true, manual: true };
  if (mode === 'manual_off') return { noshowCount: count, threshold, prepayOnly: false, manual: true };
  return { noshowCount: count, threshold, prepayOnly: count > threshold, manual: false };
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

export interface SalesSummary {
  from: string;
  to: string;
  total: { bookings: number; confirmed: number; revenue: number; cancelRate: number; noshowRate: number };
  menus: SalesSummaryMenu[];
  weekdays: SalesSummaryWeekday[];
}

const CANCELLED = ['cancelled', 'rejected'];

/**
 * 予約からの売上。売上は予約時の料金×確定数。
 * キャンセル率は取消・拒否の割合、来なかった率は無断の割合。
 */
export async function getBookingSalesSummary(
  db: D1Database,
  lineAccountId: string,
  from: string,
  to: string,
): Promise<SalesSummary> {
  const rows = await db.prepare(
    `SELECT b.menu_id, m.name AS menu_name, b.status,
            COALESCE(b.price_at_booking, m.base_price, 0) AS price,
            CAST(strftime('%w', b.starts_at) AS INTEGER) AS weekday
       FROM bookings b
       LEFT JOIN menus m ON m.id = b.menu_id
      WHERE b.line_account_id = ? AND b.starts_at >= ? AND b.starts_at < ?`,
  ).bind(lineAccountId, from, to).all<{
    menu_id: string; menu_name: string | null; status: string; price: number; weekday: number;
  }>();
  const byMenu = new Map<string, SalesSummaryMenu & { cancelled: number; noshow: number }>();
  const byWeekday = new Map<number, SalesSummaryWeekday>();
  let bookings = 0;
  let confirmed = 0;
  let revenue = 0;
  let cancelled = 0;
  let noshow = 0;
  for (const row of rows.results ?? []) {
    const price = Number(row.price ?? 0);
    const menuId = row.menu_id ?? '';
    let menu = byMenu.get(menuId);
    if (!menu) {
      menu = {
        menu_id: menuId, menu_name: row.menu_name ?? '', bookings: 0,
        confirmed: 0, revenue: 0, cancelRate: 0, noshowRate: 0, cancelled: 0, noshow: 0,
      };
      byMenu.set(menuId, menu);
    }
    let day = byWeekday.get(Number(row.weekday));
    if (!day) {
      day = { weekday: Number(row.weekday), bookings: 0, confirmed: 0, revenue: 0 };
      byWeekday.set(Number(row.weekday), day);
    }
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
  const rate = (part: number) => (bookings > 0 ? part / bookings : 0);
  return {
    from,
    to,
    total: {
      bookings, confirmed, revenue,
      cancelRate: rate(cancelled), noshowRate: rate(noshow),
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
