export const HOURS_WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
export type HoursWeekday = typeof HOURS_WEEKDAYS[number];
export type OpeningPeriod = { open: string; close: string };
export type OpeningWeek = Record<HoursWeekday, OpeningPeriod[]>;
export type OpeningDate = { date: string; closed: boolean; periods: OpeningPeriod[]; remove?: boolean };
export type HolidayHoursRule = { mode: 'weekly' | 'custom' | 'closed'; periods: OpeningPeriod[]; overrideClosedWeekday: boolean };
export const HOURS_SERVICE_LABELS = { lunch: 'ランチ', dinner: 'ディナー', cafe: 'カフェタイム', takeout: 'テイクアウト', happy_hour: 'ハッピーアワー', other: 'その他' } as const;
export type HoursServiceKind = keyof typeof HOURS_SERVICE_LABELS;
export type HoursService = { id: string; kind: HoursServiceKind; label: string; googleTypeId: string | null; sameWeekdays: boolean; weekdays: HoursWeekday[]; periods: OpeningPeriod[]; orderDeadline: string; menu: string };
export type HoursWorkspace = {
  holiday: HolidayHoursRule;
  holidayManagedDates?: string[];
  services: HoursService[];
  notes: Record<string, string>;
  draft: { weekly: OpeningWeek | null; days: OpeningDate[]; holidayChanged: boolean; serviceIds: string[]; reviewIds: string[] };
};
export type HoursWorkspaceEvent = { at: string; staffName: string; summary: string };
export type HoursWorkspaceData = { version: number; data: HoursWorkspace; history: HoursWorkspaceEvent[]; holidays: Array<{ date: string; name: string }>; serviceTypes: Array<{ id: string; label: string }> };

export function emptyHoursWorkspace(): HoursWorkspace {
  return { holiday: { mode: 'weekly', periods: [{ open: '11:00', close: '22:00' }], overrideClosedWeekday: true }, services: [], notes: {}, draft: { weekly: null, days: [], holidayChanged: false, serviceIds: [], reviewIds: [] } };
}

export function hoursDateAdd(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}
export function hoursWeekday(date: string): HoursWeekday {
  return HOURS_WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];
}
export function validHoursDate(date: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(date) && hoursDateAdd(date, 0) === date; }
export function hoursDateRange(start: string, end: string): string[] {
  if (!validHoursDate(start) || !validHoursDate(end) || end < start) return [];
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 367; d = hoursDateAdd(d, 1)) out.push(d);
  return out;
}
export function hoursPeriodsProblem(periods: OpeningPeriod[]): string | null {
  if (periods.length > 3) return '時間帯は1日3つまでです。';
  const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const sorted = [...periods].sort((a, b) => a.open.localeCompare(b.open));
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(p.open) || !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(p.close)) return '時刻は15分刻みで選んでください。';
    if (p.open === p.close) return '開店と閉店は異なる時刻にしてください。';
    const end = p.close === '00:00' ? 1440 : minutes(p.close);
    if (end <= minutes(p.open) && i < sorted.length - 1) return '翌日までの営業は最後の時間帯にしてください。';
    if (sorted[i + 1] && end > minutes(sorted[i + 1].open)) return '営業時間が重なっています。';
  }
  return null;
}
export function effectiveOpeningDate(date: string, weekly: OpeningWeek, special: OpeningDate[], rule: HolidayHoursRule, holiday: boolean): OpeningDate {
  const individual = special.find(d => d.date === date && !d.remove);
  if (individual) return individual;
  const normal = weekly[hoursWeekday(date)] ?? [];
  const periods = holiday && rule.mode !== 'weekly' && (normal.length > 0 || rule.overrideClosedWeekday)
    ? rule.mode === 'closed' ? [] : rule.periods : normal;
  return { date, closed: periods.length === 0, periods };
}
export function upcomingHolidayGroups(holidays: Array<{ date: string; name: string }>, today: string): Array<{ start: string; end: string; dates: string[]; holidays: Array<{ date: string; name: string }> }> {
  const dates = new Set(holidays.map(h => h.date));
  const off = (d: string) => dates.has(d) || ['SATURDAY', 'SUNDAY'].includes(hoursWeekday(d));
  const next = holidays.filter(h => h.date >= today).slice(0, 3);
  const groups: ReturnType<typeof upcomingHolidayGroups> = [];
  for (const h of next) {
    let start = h.date, end = h.date;
    for (let i = 0; i < 14 && off(hoursDateAdd(start, -1)); i++) start = hoursDateAdd(start, -1);
    for (let i = 0; i < 14 && off(hoursDateAdd(end, 1)); i++) end = hoursDateAdd(end, 1);
    start = start < today ? today : start;
    if (!groups.some(g => g.start === start && g.end === end)) groups.push({ start, end, dates: hoursDateRange(start, end), holidays: holidays.filter(d => d.date >= start && d.date <= end) });
  }
  return groups;
}
