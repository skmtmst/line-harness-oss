// Bulk slot generator for admin event editor.
// Pure function so it can be unit-tested without a DOM.
//
// Inputs are JST (Asia/Tokyo); outputs are UTC ISO8601 (Z-suffixed) ready
// to POST to /api/events/admin/events/:id/slots.
//
// 時刻変換は ./jst の jstHHMMToUtcIso が正本。ここに二重実装しない
// (点検#520の軽11: 片方だけ9時間ずれると試験・型検査では気づけないため)。

import { jstHHMMToUtcIso } from './jst';

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

export function generateBulkSlots(input: BulkSlotInput): GeneratedSlot[] {
  const out: GeneratedSlot[] = [];
  const start = new Date(`${input.start_date}T00:00:00Z`);
  const end = new Date(`${input.end_date}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  if (start.getTime() > end.getTime()) return out;

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
    for (const p of input.time_patterns) {
      if (p.start >= p.end) continue;
      out.push({
        starts_at: jstHHMMToUtcIso(dateStr, p.start),
        ends_at: jstHHMMToUtcIso(dateStr, p.end),
        capacity: input.capacity,
      });
    }
  }
  return out;
}
