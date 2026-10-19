import { jstDate as japanDate } from '@line-crm/shared';
import type { TodaySeatRow } from '../booking-today-seat-types.js';
import { sqlIdSet } from '@line-crm/db/id-queries';

/**
 * 今日の予約を1画面で：その日の予約を時刻順に返す。
 *
 * date は店の暦日（YYYY-MM-DD、省いたら今日の日本日付）。
 * いまは日本時間（+09:00）固定で日の範囲を作る。
 */
/**
 * 席（卓）の予約の卓名。席をつなげる予約は同じつなぎ目の卓を両方出す
 * （例：テーブル4・5）。止めている卓は出さない。
 */
export async function seatTableLabels(
  db: D1Database,
  storeId: string,
  tableId: string | null,
): Promise<string | null> {
  if (!tableId) return null;
  const table = await db
    .prepare(`SELECT label, join_group FROM rt_tables
      WHERE id = ? AND store_id = ? AND is_active = 1`)
    .bind(tableId, storeId)
    .first<{ label: string; join_group: string | null }>();
  if (!table) return null;
  if (!table.join_group) return table.label;
  const siblings = await db
    .prepare(`SELECT label FROM rt_tables
      WHERE store_id = ? AND is_active = 1 AND join_group = ?
      ORDER BY code ASC, id ASC`)
    .bind(storeId, table.join_group)
    .all<{ label: string }>();
  const labels = (siblings.results ?? []).map((row) => row.label);
  return labels.length > 0 ? labels.join('・') : table.label;
}

export async function getTodaySeatReservations(
  db: D1Database,
  accountId: string,
  dayStart: string,
  dayEnd: string,
  storeId: string | null,
): Promise<TodaySeatRow[]> {
  const stores = await db
    .prepare(`SELECT id, name, timezone FROM rt_stores
      WHERE line_account_id = ? AND status = 'active' AND (? IS NULL OR id = ?)`)
    .bind(accountId, storeId, storeId)
    .all<{ id: string; name: string; timezone: string }>();
  const rows: TodaySeatRow[] = [];
  for (const store of stores.results ?? []) {
    const reservations = await db
      .prepare(
        `SELECT r.id, r.starts_at, r.ends_at, r.status, r.customer_name,
                r.guest_count, r.table_id, r.customer_version, r.source,
                (SELECT json_group_array(table_id) FROM rt_reservation_table_links WHERE reservation_id=r.id) AS table_ids_json, m.name AS course_name
           FROM rt_reservations r
           LEFT JOIN rt_menu_items m ON m.id = r.course_id
          WHERE r.store_id = ? AND r.starts_at >= ? AND r.starts_at < ?
            AND r.status NOT IN ('cancelled')
          ORDER BY r.starts_at ASC LIMIT 200`,
      )
      .bind(store.id, dayStart, dayEnd)
      .all<{
        id: string;
        starts_at: string;
        ends_at: string;
        status: string;
        customer_name: string;
        guest_count: number;
        customer_version: number;
        source: string;
        table_ids_json: string;
        table_id: string | null;
        course_name: string | null;
      }>();
    const list = reservations.results ?? [];
    const marks = new Map<string, NonNullable<TodaySeatRow['visit_mark']>>();
    if (list.length > 0) {
      const marksRows = await db
        .prepare(
          `SELECT reservation_id, kind, late_minutes, marked_by_name, marked_at
             FROM rt_seat_visit_marks
            WHERE store_id = ? AND undone_at IS NULL AND reservation_id IN (${sqlIdSet(list.map(reservation => reservation.id)).sql})
            ORDER BY marked_at DESC`,
        )
        .bind(store.id, ...sqlIdSet(list.map(reservation => reservation.id)).binds)
        .all<{
          reservation_id: string;
          kind: string;
          late_minutes: number | null;
          marked_by_name: string | null;
          marked_at: string;
        }>();
      for (const mark of marksRows.results ?? []) {
        if (!marks.has(mark.reservation_id)) {
          marks.set(mark.reservation_id, {
            kind: mark.kind,
            late_minutes: mark.late_minutes,
            marked_by_name: mark.marked_by_name,
            marked_at: mark.marked_at,
          });
        }
      }
    }
    for (const reservation of list) {
      rows.push({
        kind: 'seat',
        customer_version: reservation.customer_version, table_id: reservation.table_id, table_ids_json: reservation.table_ids_json, source: reservation.source,
        id: reservation.id,
        store_id: store.id,
        store_name: store.name,
        starts_at: reservation.starts_at,
        ends_at: reservation.ends_at,
        status: reservation.status,
        customer_name: reservation.customer_name,
        guest_count: reservation.guest_count,
        table_label: await seatTableLabels(db, store.id, reservation.table_id),
        course_name: reservation.course_name,
        visit_mark: marks.get(reservation.id) ?? null,
      });
    }
  }
  rows.sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0));
  return rows.slice(0, 200);
}

export function jstDateString(now: Date): string {
  return japanDate(now);
}

export const VISIT_KINDS = ['visited', 'late', 'no_show'] as const;

export type VisitKind = (typeof VISIT_KINDS)[number];
