/**
 * 出荷予定日の算出。
 *
 * 現時点の業務ルール（暫定）:
 *   - 日本時間を基準にする
 *   - 営業日の午前中（12:00未満）の注文 … 当日発送予定
 *   - 営業日の午後（12:00以降）の注文   … 翌営業日発送予定
 *   - 土日祝日の注文                     … 翌営業日発送予定
 *   - 算出結果が土日祝日に当たる場合     … 次の営業日へ繰り越す
 *
 * 将来、お届け希望日と倉庫会社の運用を踏まえた正式なロジックへ差し替える。
 * そのため画面や個別のルートには埋め込まず、このモジュールに閉じている。
 * 算出結果はDBへ保存せず、都度計算する。
 */

import { isJapaneseHoliday } from './japanese-holidays';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 午前・午後の境目（JSTの時）。この時刻以降は翌営業日扱い。 */
export const SAME_DAY_CUTOFF_HOUR = 12;

/** JSTの暦日（YYYY-MM-DD）と時（0-23）。タイムゾーンを持たない素の値。 */
export type JstMoment = { date: string; hour: number };

/**
 * ISO8601 文字列を JST の暦日と時に直す。
 * オフセット付き・Z付きのどちらでも同じ結果になる。
 * 解釈できない文字列は null を返し、呼び出し側で「算出不可」を選ばせる。
 */
export function toJstMoment(iso: string): JstMoment | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const shifted = new Date(ms + JST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return { date: `${y}-${m}-${d}`, hour: shifted.getUTCHours() };
}

/** YYYY-MM-DD に日数を足す。月またぎ・年またぎ・閏年はUTC計算に任せる。 */
export function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(ms)) return isoDate;
  const next = new Date(ms + days * 24 * 60 * 60 * 1000);
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, '0');
  const d = String(next.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 土日か。0=日曜, 6=土曜。 */
export function isWeekend(isoDate: string): boolean {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(ms)) return false;
  const day = new Date(ms).getUTCDay();
  return day === 0 || day === 6;
}

/** 営業日か（土日でも祝日でもない）。 */
export function isBusinessDay(isoDate: string): boolean {
  return !isWeekend(isoDate) && !isJapaneseHoliday(isoDate);
}

/**
 * その日を含めて、最初の営業日を返す。
 * 年末年始のように連休が続く場合も、営業日に当たるまで進む。
 * 万一ずっと営業日が見つからない入力でも止まらないよう上限を設ける。
 */
export function nextBusinessDayOnOrAfter(isoDate: string): string {
  let cursor = isoDate;
  for (let i = 0; i < 31; i += 1) {
    if (isBusinessDay(cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

/** その日の翌日以降で、最初の営業日を返す。 */
export function nextBusinessDayAfter(isoDate: string): string {
  return nextBusinessDayOnOrAfter(addDays(isoDate, 1));
}

/**
 * 注文日時から出荷予定日を算出する（通常注文むけ）。
 * 解釈できない日時は null。呼び出し側で「予定日なし」として扱う。
 */
export function calculateShipDateFromOrderedAt(orderedAtIso: string): string | null {
  const moment = toJstMoment(orderedAtIso);
  if (!moment) return null;
  // 営業日の午前中だけが当日出荷。それ以外（午後・土日祝）は翌営業日。
  if (isBusinessDay(moment.date) && moment.hour < SAME_DAY_CUTOFF_HOUR) {
    return moment.date;
  }
  return nextBusinessDayAfter(moment.date);
}

/**
 * 定期便の出荷予定日。EC側が確定させた日付をそのまま使う。
 * こちらで営業日へ寄せると、EC側の予定とずれるため動かさない。
 */
export function normalizeSubscriptionShipDate(scheduled: string | null | undefined): string | null {
  if (!scheduled) return null;
  const trimmed = scheduled.trim();
  // `YYYY-MM-DD` と、日時つきの両方が届きうる。暦日だけを取り出す。
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const moment = toJstMoment(trimmed);
  return moment ? moment.date : null;
}

export type ShipDateSource = 'subscription' | 'ordered_at';

export type ShipDateResult = {
  /** JSTの暦日（YYYY-MM-DD）。算出できなければ null。 */
  date: string | null;
  /** どちらの根拠で決まったか。画面と調査の両方で使う。 */
  source: ShipDateSource;
};

/**
 * 出荷予定日を決める入口。
 * 定期便は EC 側の予定日を優先し、無ければ注文日時から算出する。
 */
export function resolveShipDate(input: {
  scheduledShippingDate?: string | null;
  orderedAt?: string | null;
}): ShipDateResult {
  const scheduled = normalizeSubscriptionShipDate(input.scheduledShippingDate);
  if (scheduled) return { date: scheduled, source: 'subscription' };
  return {
    date: input.orderedAt ? calculateShipDateFromOrderedAt(input.orderedAt) : null,
    source: 'ordered_at',
  };
}
