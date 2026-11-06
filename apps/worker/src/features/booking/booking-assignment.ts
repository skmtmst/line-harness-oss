import type { RestaurantSeatAvailability } from '@line-crm/shared';
import { tzDateStr } from '../../services/availability.js';
import { restaurantCivilTime } from '../../services/restaurant-booking.js';
import { defaultAssignmentResource, d1AssignmentSettingsStore, type AssignmentScope, type AssignmentSettingsStore } from './booking-assignment-settings.js';
import { selectAssignment, type AssignmentCandidate } from './booking-assignment-selector.js';

/** 暦日の加減で週を作る。夏時間の日にも24時間を足して境界をずらさない。 */
export function assignmentWindows(startsAt: string, timezone: string, period: 'day' | 'week') {
  const date = tzDateStr(timezone, new Date(startsAt));
  const civil = new Date(`${date}T00:00:00Z`);
  const shift = (days: number) => new Date(civil.getTime() + days * 86400000).toISOString().slice(0, 10);
  const monday = (civil.getUTCDay() + 6) % 7;
  return {
    dayFrom: restaurantCivilTime(date, 0, timezone), dayTo: restaurantCivilTime(shift(1), 0, timezone),
    from: restaurantCivilTime(period === 'week' ? shift(-monday) : date, 0, timezone),
    to: restaurantCivilTime(period === 'week' ? shift(7 - monday) : shift(1), 0, timezone),
  };
}

type Counts = { id: string; periodCount: number; dailyCount: number; lastAssignedAt: string | null };
type SelectionOptions = { store?: AssignmentSettingsStore; random?: () => number; excludeReservationId?: string };

async function assignmentCandidates(db: D1Database, scope: AssignmentScope, startsAt: string, timezone: string, ids: string[], options: SelectionOptions) {
  const settings = await (options.store ?? d1AssignmentSettingsStore(db)).read(scope);
  const rules = new Map(settings.resources.map(r => [r.resourceId, r]));
  if (!settings.storageReady) return { method: 'legacy_first' as const, candidates: ids.map(id => ({
    id, ...defaultAssignmentResource(id), dailyCount: 0, periodCount: 0, lastAssignedAt: null,
  })) };
  const w = assignmentWindows(startsAt, timezone, settings.balancePeriod);
  const countSql = `SUM(CASE WHEN julianday(r.starts_at)>=julianday(?) AND julianday(r.starts_at)<julianday(?) THEN 1 ELSE 0 END) AS periodCount,strftime('%Y-%m-%dT%H:%M:%fZ',MAX(julianday(r.requested_at))) AS lastAssignedAt,SUM(CASE WHEN julianday(r.starts_at)>=julianday(?) AND julianday(r.starts_at)<julianday(?) THEN 1 ELSE 0 END) AS dailyCount`;
  const rows = scope.kind === 'staff'
    ? await db.prepare(`SELECT r.staff_id AS id,${countSql} FROM bookings r WHERE r.line_account_id=?
        AND r.status IN ('requested','confirmed','completed') AND r.id<>?
        GROUP BY r.staff_id`)
      .bind(w.from, w.to, w.dayFrom, w.dayTo, scope.id, options.excludeReservationId ?? '').all<Counts>()
    : await db.prepare(`SELECT l.table_id AS id,${countSql.replace('r.requested_at', 'r.created_at')} FROM rt_reservations r
        JOIN rt_reservation_table_links l ON l.reservation_id=r.id WHERE r.store_id=? AND r.id<>?
        AND r.status IN ('pending','confirmed','seated','visited')
        AND (r.status<>'pending' OR r.hold_expires_at IS NULL OR julianday(r.hold_expires_at)>julianday('now'))
        GROUP BY l.table_id`)
      .bind(w.from, w.to, w.dayFrom, w.dayTo, scope.id, options.excludeReservationId ?? '').all<Counts>();
  const counts = new Map(rows.results.map(r => [r.id, r]));
  return { method: settings.method, candidates: ids.map(id => ({ id, ...(rules.get(id) ?? defaultAssignmentResource(id)),
    dailyCount: counts.get(id)?.dailyCount ?? 0, periodCount: counts.get(id)?.periodCount ?? 0, lastAssignedAt: counts.get(id)?.lastAssignedAt ?? null })) };
}

/** 空き枠に存在する本当の担当者IDだけを受け取る。 */
export async function assignBookingStaff(db: D1Database, accountId: string, startsAt: string, timezone: string, availableIds: string[], options: SelectionOptions = {}) {
  if (!availableIds.length) return null;
  const { method, candidates } = await assignmentCandidates(db, { kind: 'staff', id: accountId }, startsAt, timezone, availableIds, options);
  return selectAssignment(candidates, { method, random: options.random })?.id ?? null;
}

/** 空いている候補のサイズ・結合組を保ち、構成する全卓の設定と実績を見る。 */
export async function assignRestaurantTable(db: D1Database, storeId: string, startsAt: string, guestCount: number,
  tables: RestaurantSeatAvailability['tables'], options: SelectionOptions = {}) {
  if (!tables.length) return null;
  // 保存先がない間は追加の店舗/実績読取も行わず、既存の先頭をそのまま使う。
  const store = options.store ?? d1AssignmentSettingsStore(db);
  const scope: AssignmentScope = { kind: 'table', id: storeId };
  const settings = await store.read(scope);
  if (!settings.storageReady) return selectAssignment(tables.map(t => ({ ...t, ...defaultAssignmentResource(t.id),
    periodCount: 0, dailyCount: 0 })), { method: 'legacy_first', guestCount });
  const row = await db.prepare('SELECT timezone FROM rt_stores WHERE id=?').bind(storeId).first<{ timezone: string }>();
  if (!row) return null;
  const ids = [...new Set(tables.flatMap(t => t.tableIds ?? [t.id]))];
  const { method, candidates } = await assignmentCandidates(db, scope, startsAt, row.timezone, ids, { ...options, store: { ...store, read: async () => settings } });
  const byId = new Map(candidates.map(c => [c.id, c]));
  const rank = { preferred: 0, normal: 1, low: 2 } as const;
  const choices = tables.map(t => {
    const members = (t.tableIds ?? [t.id]).map(id => byId.get(id)!);
    const weakest = members.reduce((a, b) => rank[a.priority] >= rank[b.priority] ? a : b);
    return { ...t, priority: weakest.priority, sortOrder: Math.max(...members.map(m => m.sortOrder)),
      lastAssignedAt: members.map(m => m.lastAssignedAt).filter((t): t is string => !!t).sort((a,b) => Date.parse(b)-Date.parse(a))[0] ?? null,
      periodCount: members.reduce((sum, m) => sum + m.periodCount, 0), dailyCount: 0, dailyLimit: null, members } satisfies AssignmentCandidate;
  });
  return selectAssignment(choices, { method, guestCount, random: options.random });
}
