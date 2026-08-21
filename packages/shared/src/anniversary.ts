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
 * 毎年くり返す日付が、今年（または来年）のいつになるかを返す。`YYYY-MM-DD`。
 *
 * 今日を含めて、これから来る最初のその日を返す。今日が誕生日なら今日。
 * 過ぎていれば来年。
 *
 * 2月29日は、うるう年でない年は**3月1日**として扱う。2月28日にすると、
 * 平年に2月28日生まれの人と同じ日に届く。「うるう日生まれの人は3月1日に
 * 祝う」ほうが一般的で、前倒しより自然。
 */
export function nextAnniversary(value: string, today: Date): string | null {
  const monthDay = parseMonthDay(value);
  if (!monthDay) return null;
  const { date } = toJstParts(today);
  const [todayYear, todayMonth, todayDay] = date.split('-').map(Number);

  const forYear = (year: number): string => {
    const { month, day } = monthDay;
    if (month === 2 && day === 29 && !isLeapYear(year)) {
      return `${year}-03-01`;
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const thisYear = forYear(todayYear);
  const [, tm, td] = thisYear.split('-').map(Number);
  // 今日を含めて、まだ来ていなければ今年。過ぎていれば来年。
  if (tm > todayMonth || (tm === todayMonth && td >= todayDay)) return thisYear;
  return forYear(todayYear + 1);
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
