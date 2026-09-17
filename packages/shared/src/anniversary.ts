import { toJstParts } from './response-window';

/**
 * 友だち情報欄の日付から、「次に来るその日」を決める。
 *
 * 誕生日リマインダのための計算。**年で比べてはいけない。** 誕生日は
 * `1990-05-03` のように過去の日付で入っているので、年ごと比べると一度も
 * 当たらない。見るのは月日だけ。
 *
 * 計算は日本時間で行う。Workers は UTC で動くので、ローカルの日付を使うと
 * 深夜0時前後で1日ずれる。
 */

/** `YYYY-MM-DD` を月日に分ける。読めなければ null。 */
export function parseMonthDay(value: string): { month: number; day: number } | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!matched) return null;
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

/**
 * 2月29日を基準日にする毎年くり返しで、うるう年でない年にいつ扱うか。
 * リマインダ（機能07）が正本で、NEN配信（機能21）も同じ規則を参照する。
 *
 * - `feb28`: 平年は2月28日に届ける（設定の既定）
 * - `mar1`: 平年は3月1日に届ける（この設定ができる前の固定動作。既存設定はこちらを維持）
 * - `skip`: その年は送らない（うるう年だけに届く）
 */
export type LeapYearPolicy = 'feb28' | 'mar1' | 'skip';

export const LEAP_YEAR_POLICIES: readonly LeapYearPolicy[] = ['feb28', 'mar1', 'skip'];

/**
 * その年における記念日の実効月日を `MM-DD` で返す。その年に来なければ null。
 * 2月29日以外は毎年同じ月日。2月29日は、うるう年なら `02-29`、
 * 平年なら policy に従って `02-28` / `03-01` / null（送らない）になる。
 */
export function effectiveAnniversaryMonthDay(
  month: number,
  day: number,
  year: number,
  policy: LeapYearPolicy,
): string | null {
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    if (policy === 'feb28') return '02-28';
    if (policy === 'mar1') return '03-01';
    return null;
  }
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 毎年くり返す日付が、今年（または来年）のいつになるかを返す。`YYYY-MM-DD`。
 *
 * 今日を含めて、これから来る最初のその日を返す。今日が誕生日なら今日。
 * 過ぎていれば来年。
 *
 * 2月29日はうるう年に2月29日。平年の扱いは `policy` で決める。
 * `skip` の年はその年を飛ばして、次に来る年（うるう年）を返す。
 */
export function nextAnniversary(
  value: string,
  today: Date,
  policy: LeapYearPolicy,
): string | null {
  const monthDay = parseMonthDay(value);
  if (!monthDay) return null;
  const { date } = toJstParts(today);
  const [todayYear, todayMonth, todayDay] = date.split('-').map(Number);

  // skip の平年は「その年は無い」ので、実際に来る年まで進める。
  // うるう年は4年周期だから、4年先まで見れば必ず見つかる。
  for (let year = todayYear; year <= todayYear + 4; year++) {
    const effective = effectiveAnniversaryMonthDay(monthDay.month, monthDay.day, year, policy);
    if (!effective) continue;
    const [em, ed] = effective.split('-').map(Number);
    // 今日を含めて、まだ来ていなければその年。過ぎていれば次の年へ。
    if (em > todayMonth || (em === todayMonth && ed >= todayDay) || year > todayYear) {
      return `${year}-${effective}`;
    }
  }
  return null;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * その日付が「今日」かどうか（日本時間）。
 * くり返さない日付（契約更新日など）で使う。
 */
export function isSameJstDay(value: string, today: Date): boolean {
  const matched = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!matched) return false;
  return matched[1] === toJstParts(today).date;
}
