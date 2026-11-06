export type OpeningDay = { weekday: number; periods: Array<{ opensAt: string; closesAt: string }> };

export function validateRestaurantOpeningHours(value: unknown): OpeningDay[] | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const days: OpeningDay[] = [];
  const intervals: Array<[number, number]> = [];
  const weekdays = new Set<number>();
  const minutes = (time: unknown, closing = false): number | null => {
    if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return null;
    const [hour, minute] = time.split(':').map(Number);
    if (closing && hour === 24 && minute === 0) return 1440;
    return hour < 24 && minute < 60 ? hour * 60 + minute : null;
  };
  for (const day of value) {
    if (!day || !Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6
      || weekdays.has(day.weekday) || !Array.isArray(day.periods) || day.periods.length > 24) return null;
    weekdays.add(day.weekday);
    const periods: OpeningDay['periods'] = [];
    for (const period of day.periods) {
      if (!period) return null;
      const start = minutes(period.opensAt);
      const end = minutes(period.closesAt, true);
      if (start === null || end === null || start === end) return null;
      // 翌朝に閉める店にも対応し、曜日をまたぐ重なりを週全体で検査する。
      const absoluteStart = day.weekday * 1440 + start;
      const absoluteEnd = day.weekday * 1440 + end + (end < start ? 1440 : 0);
      intervals.push([absoluteStart, absoluteEnd]);
      if (absoluteEnd > 7 * 1440) intervals.push([absoluteStart - 7 * 1440, absoluteEnd - 7 * 1440]);
      periods.push({ opensAt: period.opensAt, closesAt: period.closesAt });
    }
    days.push({ weekday: day.weekday, periods: periods.sort((a, b) => a.opensAt.localeCompare(b.opensAt)) });
  }
  intervals.sort((a, b) => a[0] - b[0]);
  if (intervals.some((range, i) => i > 0 && range[0] < intervals[i - 1][1])) return null;
  return days.sort((a, b) => a.weekday - b.weekday);
}

export async function restaurantTableCapacity(db: D1Database, storeId: string): Promise<number> {
  const row = await db.prepare('SELECT COALESCE(SUM(max_capacity), 0) AS total FROM rt_tables WHERE store_id = ? AND is_active = 1')
    .bind(storeId).first<{ total: number }>();
  return row!.total;
}
