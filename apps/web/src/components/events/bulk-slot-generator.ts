// Bulk slot generator for admin event editor.
// Pure function so it can be unit-tested without a DOM.
//
// Inputs are JST (Asia/Tokyo); outputs are UTC ISO8601 (Z-suffixed) ready
// to POST to /api/events/admin/events/:id/slots.
//
// 時刻変換は ./jst の jstHHMMToUtcIso が正本。ここに二重実装しない
// (点検#520の軽11: 片方だけ9時間ずれると試験・型検査では気づけないため)。

import { jstHHMMToUtcIso } from './jst';

/**
 * 一括作成の画面上限。createSlots(送信側)と同じ数にそろえる。
 * 下見・送信で同じ制限を使うため、ここが唯一の定義(DETAIL-12)。
 */
export const BULK_SLOT_LIMIT = 500;

/**
 * 期間の上限(日数)。上限判定のためだけに何年分もの配列を作らせないため、
 * 期間そのものにも上限を置く(DETAIL-12)。2年＋うるう年分の余裕。
 */
export const BULK_SLOT_MAX_RANGE_DAYS = 731;

export class BulkSlotRangeError extends Error {
  constructor(rangeDays: number) {
    super(
      `期間が長すぎます。開始日から終了日まで${BULK_SLOT_MAX_RANGE_DAYS}日(約2年)以内にしてください` +
        `(現在${rangeDays}日)`,
    );
    this.name = 'BulkSlotRangeError';
  }
}

export interface BulkSlotInput {
  start_date: string; // YYYY-MM-DD (JST)
  end_date: string;   // YYYY-MM-DD (JST), inclusive
  weekdays: number[]; // 0=Sun ... 6=Sat
  time_patterns: Array<{ start: string; end: string }>; // HH:MM JST, start < end
  capacity: number | null;
}

export interface GeneratedSlot {
  starts_at: string; // UTC ISO8601
  ends_at: string;
  capacity: number | null;
}

/**
 * 指定期間の枠を生成する。limit+1 件に達した時点で打ち切るので、
 * 上限を超える入力でも limit+1 件より多いオブジェクトは作らない。
 * 呼び出し側は `result.length > BULK_SLOT_LIMIT` で上限超過を判定する。
 *
 * @throws BulkSlotRangeError 期間が BULK_SLOT_MAX_RANGE_DAYS を超えるとき
 */
export function generateBulkSlots(
  input: BulkSlotInput,
  limit: number = BULK_SLOT_LIMIT,
): GeneratedSlot[] {
  const out: GeneratedSlot[] = [];
  const start = new Date(`${input.start_date}T00:00:00Z`);
  const end = new Date(`${input.end_date}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  if (start.getTime() > end.getTime()) return out;

  // 日数を先に見積もり、上限を超える期間は生成せずに止める(DETAIL-12)。
  const rangeDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (rangeDays > BULK_SLOT_MAX_RANGE_DAYS) throw new BulkSlotRangeError(rangeDays);

  const validPatterns = input.time_patterns.filter((p) => p.start < p.end);
  if (validPatterns.length === 0 || input.weekdays.length === 0) return out;

  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const day = new Date(t);
    const yyyy = day.getUTCFullYear();
    const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(day.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    // Weekday in JST. Since start_date / end_date are interpreted as
    // calendar dates (no TZ semantics), treat them as JST dates and use
    // UTC weekday of the constructed Date — which matches JST weekday
    // because we built the day boundary at 00:00 UTC of YYYY-MM-DD.
    const weekday = day.getUTCDay();
    if (!input.weekdays.includes(weekday)) continue;
    for (const p of validPatterns) {
      out.push({
        starts_at: jstHHMMToUtcIso(dateStr, p.start),
        ends_at: jstHHMMToUtcIso(dateStr, p.end),
        capacity: input.capacity,
      });
      // 上限超過が確定した時点で残りの日を回らない(DETAIL-12)。
      if (out.length > limit) return out;
    }
  }
  return out;
}
