import { isJapaneseHoliday } from './japanese-holidays';

/**
 * 「いま応答してよい時刻か」を決めるための設定。
 *
 * 自動応答の「応答する時間帯」で使う。一斉配信の「送る時間」でも同じ形を
 * 使えるように、React にも D1 にも依らない場所へ置いてある。
 *
 * **判定は必ず日本時間で行う。** 実行環境の時計に合わせると、深夜0時前後で
 * 曜日が1日ずれる（Cloudflare Workers は UTC で動く）。この形を使うところは
 * すべて、ここの関数を通すこと。
 */

/** 祝日をどう扱うか。 */
export type HolidayRule =
  /** 祝日は考慮しない。曜日だけで決める。 */
  | 'ignore'
  /** チェックした曜日に加えて、祝日も応答する。 */
  | 'include'
  /** チェックした曜日でも、その日が祝日なら応答しない。 */
  | 'exclude';

export interface TimeRange {
  /** 日本時間の "HH:MM"。 */
  start: string;
  /**
   * 日本時間の "HH:MM"。**この時刻は含まない。**
   *
   * 既にある自動応答の時間帯判定（auto-reply-conditions.ts の
   * isWithinActiveWindow）が「終わりを含まない」で動いているので、そちらに
   * そろえる。同じアプリの中に2つの規則があると、運用者が「18:00まで」の
   * 意味を画面ごとに覚え直すことになる。
   *
   * この決め方だと「18:00まで応答」と書いた人が 18:00 ちょうどに応答しない。
   * そこは画面側の言葉で補う（終わりの時刻は「その直前まで」と読める書き方に
   * する）。判定の規則をそろえることを優先した。
   *
   * 隣り合う帯（9:00-18:00 と 18:00-22:00）を並べたとき、18:00 が両方に
   * 入らないという利点もある。
   */
  end: string;
}

export interface ResponseWindow {
  /** 0=日 … 6=土。空なら「すべての曜日」。 */
  weekdays: number[];
  holiday: HolidayRule;
  /** 空なら「すべての時間」。 */
  ranges: TimeRange[];
}

/** 何も絞らない設定（いつでも応答する）。 */
export const ALWAYS_OPEN: ResponseWindow = { weekdays: [], holiday: 'ignore', ranges: [] };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** UTC の Date を、日本時間の暦日・曜日・その日の何分目かに分解する。 */
export function toJstParts(at: Date): { date: string; weekday: number; minutes: number } {
  // getUTC* を使うのが肝。ローカルの getDay() を使うと実行環境の時計に引きずられる。
  const jst = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`,
    weekday: jst.getUTCDay(),
    minutes: jst.getUTCHours() * 60 + jst.getUTCMinutes(),
  };
}

/** "HH:MM" を「その日の何分目か」に直す。読めなければ null。 */
export function parseHhMm(value: string): number | null {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!matched) return null;
  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** その日（曜日・祝日）が対象か。 */
function dayMatches(window: ResponseWindow, date: string, weekday: number): boolean {
  const weekdayOk = window.weekdays.length === 0 || window.weekdays.includes(weekday);
  if (window.holiday === 'ignore') return weekdayOk;
  const holiday = isJapaneseHoliday(date);
  if (window.holiday === 'include') return weekdayOk || holiday;
  return weekdayOk && !holiday;
}

/**
 * いま応答してよい時刻か。
 *
 * 日をまたぐ帯（22:00〜02:00 のような、start が end より後ろのもの）は、
 * **始まった側の曜日**で判定する。「金曜 22:00〜02:00」なら土曜の 01:00 も
 * 応答する。店主の頭の中では「金曜の夜」なので、そちらに合わせる。
 * 逆にすると、金土の夜だけ対応したい人が土日にチェックを入れることになる。
 *
 * 読めない時刻（"25:00" など）の帯は無いものとして飛ばす。設定を保存する側で
 * 弾くのが本筋だが、既に入っている値で判定が落ちるのは避ける。
 */
export function isWithinWindow(window: ResponseWindow, at: Date): boolean {
  const today = toJstParts(at);

  // 時間帯の指定なし＝その日いっぱい。曜日と祝日だけを見る。
  if (window.ranges.length === 0) {
    return dayMatches(window, today.date, today.weekday);
  }

  const yesterday = toJstParts(new Date(at.getTime() - 24 * 60 * 60 * 1000));

  for (const range of window.ranges) {
    const start = parseHhMm(range.start);
    const end = parseHhMm(range.end);
    if (start === null || end === null) continue;

    if (start <= end) {
      if (
        today.minutes >= start &&
        today.minutes < end &&
        dayMatches(window, today.date, today.weekday)
      ) {
        return true;
      }
      continue;
    }

    // 日をまたぐ。今日の start 以降か、昨日から続いている end までか。
    if (today.minutes >= start && dayMatches(window, today.date, today.weekday)) return true;
    if (today.minutes < end && dayMatches(window, yesterday.date, yesterday.weekday)) return true;
  }

  return false;
}

/** 画面や保存の前に、設定として成り立っているかを見る。 */
export function validateResponseWindow(window: ResponseWindow): string | null {
  if (window.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return '曜日は0（日）から6（土）で指定してください';
  }
  for (const range of window.ranges) {
    if (parseHhMm(range.start) === null || parseHhMm(range.end) === null) {
      return `時刻は「9:00」の形で指定してください（${range.start}〜${range.end}）`;
    }
  }
  // 曜日を1つも選ばず、時間帯だけ指定した場合は「毎日その時間」の意味になる。
  // これは自然なので通す。
  return null;
}
