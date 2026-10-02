/**
 * 日本の祝日（内閣府「国民の祝日について」の規則を計算で再現）。外部通信なし。
 *
 * - 日本時間基準。年1回、法改正があればこのファイルを更新する（決定 2026-09-25）。
 * - 春分・秋分は 2000〜2099 年の近似式。2100年以降は使わない。
 * - 振替休日・国民の休日の規則も含む。
 */

export interface JpHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function nthMonday(year: number, month: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun
  const firstMonday = first === 1 ? 1 : ((8 - first) % 7) + 1;
  return firstMonday + (n - 1) * 7;
}

function vernalEquinox(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnalEquinox(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function dow(date: string): number {
  const [y, m, d] = date.split('-').map((x) => Number.parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map((x) => Number.parseInt(x, 10));
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** その年の祝日（振替休日・国民の休日を含む）を日付順で返す。 */
export function holidaysOfYear(year: number): JpHoliday[] {
  if (year < 2000 || year > 2099) return [];
  const base: JpHoliday[] = [
    { date: ymd(year, 1, 1), name: '元日' },
    { date: ymd(year, 1, nthMonday(year, 1, 2)), name: '成人の日' },
    { date: ymd(year, 2, 11), name: '建国記念の日' },
    { date: ymd(year, 2, 23), name: '天皇誕生日' },
    { date: ymd(year, 3, vernalEquinox(year)), name: '春分の日' },
    { date: ymd(year, 4, 29), name: '昭和の日' },
    { date: ymd(year, 5, 3), name: '憲法記念日' },
    { date: ymd(year, 5, 4), name: 'みどりの日' },
    { date: ymd(year, 5, 5), name: 'こどもの日' },
    { date: ymd(year, 7, nthMonday(year, 7, 3)), name: '海の日' },
    { date: ymd(year, 8, 11), name: '山の日' },
    { date: ymd(year, 9, nthMonday(year, 9, 3)), name: '敬老の日' },
    { date: ymd(year, 9, autumnalEquinox(year)), name: '秋分の日' },
    { date: ymd(year, 10, nthMonday(year, 10, 2)), name: 'スポーツの日' },
    { date: ymd(year, 11, 3), name: '文化の日' },
    { date: ymd(year, 11, 23), name: '勤労感謝の日' },
  ];
  const map = new Map(base.map((h) => [h.date, h.name]));
  // 振替休日：祝日が日曜なら、その後の最初の「祝日でない日」
  for (const h of base) {
    if (dow(h.date) !== 0) continue;
    let d = addDays(h.date, 1);
    while (map.has(d)) d = addDays(d, 1);
    map.set(d, '休日（振替休日）');
  }
  // 国民の休日：前日と翌日が祝日に挟まれた平日
  for (const h of base) {
    const mid = addDays(h.date, 1);
    const after = addDays(h.date, 2);
    if (map.has(after) && !map.has(mid) && dow(mid) !== 0) map.set(mid, '休日（国民の休日）');
  }
  return [...map.entries()].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
}

/** from（含む）から days 日以内の祝日。 */
export function upcomingHolidays(from: string, days: number): JpHoliday[] {
  const to = addDays(from, days);
  const y1 = Number.parseInt(from.slice(0, 4), 10);
  const y2 = Number.parseInt(to.slice(0, 4), 10);
  const all = y1 === y2 ? holidaysOfYear(y1) : [...holidaysOfYear(y1), ...holidaysOfYear(y2)];
  return all.filter((h) => h.date >= from && h.date <= to);
}

export function holidayNameOf(date: string): string | null {
  const y = Number.parseInt(date.slice(0, 4), 10);
  return holidaysOfYear(y).find((h) => h.date === date)?.name ?? null;
}
