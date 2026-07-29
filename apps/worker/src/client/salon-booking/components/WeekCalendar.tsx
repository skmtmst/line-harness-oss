// 週カレンダー: 横軸に7日、縦軸に管理画面で設定した時間単位。
// availability で受け取った {date → [HH:MM, ...]} を grid セルにマップして
// タップ可能なものは○、空いてないものは×で示す。

import { useMemo } from 'react';
import { addDays, formatJp } from '../lib/datetime.js';

export interface WeekCalendarProps {
  byDate: Record<string, string[]>; // 'YYYY-MM-DD' → ['10:00', '10:30', ...]
  workingByDate: Record<string, { start: string; end: string }>;
  weekStart: string;                  // 表示開始日 (YYYY-MM-DD JST)
  onPick: (slot: { date: string; start: string }) => void;
  selectedDate?: string;
  selectedStart?: string;
  slotIntervalMinutes: number;
}

// HH:MM ↔ 分数の変換
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function fromMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function WeekCalendar({
  byDate,
  workingByDate,
  weekStart,
  onPick,
  selectedDate,
  selectedStart,
  slotIntervalMinutes,
}: WeekCalendarProps) {
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const rows = useMemo(() => {
    const ranges = Object.values(workingByDate);
    const min = ranges.length > 0
      ? Math.min(...ranges.map((range) => toMin(range.start)))
      : 11 * 60;
    const max = ranges.length > 0
      ? Math.max(...ranges.map((range) => toMin(range.end) - slotIntervalMinutes))
      : 19 * 60;
    const arr: string[] = [];
    for (let m = min; m <= max; m += slotIntervalMinutes) arr.push(fromMin(m));
    return arr;
  }, [slotIntervalMinutes, workingByDate]);

  const todayJst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  return (
    <div
      className="bg-white rounded-2xl overflow-auto"
      style={{
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        padding: 4,
        maxHeight: 560,
      }}
    >
      <div
        className="grid text-center"
        style={{
          gridTemplateColumns: `52px repeat(7, minmax(42px, 1fr))`,
          gap: 0,
          minWidth: 350,
        }}
      >
        {/* ヘッダー行: 空白セル + 7 日付 */}
        <div className="sticky left-0 top-0 z-30 bg-gray-100 border-b border-r border-gray-200" />
        {dates.map((d) => {
          const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
          const isToday = d === todayJst;
          const tone = dow === 0 ? '#ef4444' : dow === 6 ? '#3b82f6' : '#374151';
          return (
            <div
              key={d}
              className="sticky top-0 z-20 border-b border-gray-200 py-2 px-1"
              style={{
                color: tone,
                background: dow === 0 ? '#ffe4e6' : dow === 6 ? '#dbeafe' : '#f3f4f6',
              }}
            >
              <div className="text-[10px] leading-none font-medium">
                {'日月火水木金土'[dow]}
              </div>
              <div
                className="text-sm font-bold mt-1 leading-none"
                style={
                  isToday
                    ? {
                        color: '#fff',
                        background: '#06C755',
                        borderRadius: 9999,
                        width: 22,
                        height: 22,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }
                    : undefined
                }
              >
                {Number(d.slice(8))}
              </div>
            </div>
          );
        })}

        {/* 時間行 */}
        {rows.map((t) => {
          return (
            <div key={`row-${t}`} style={{ display: 'contents' }}>
              <div
                className="sticky left-0 z-10 border-r border-t border-gray-200 bg-gray-100 text-[11px] font-semibold text-gray-600 tabular-nums flex items-center justify-center"
                style={{
                  height: 42,
                }}
              >
                {t}
              </div>
              {dates.map((d) => {
                const slots = byDate[d] ?? [];
                const available = slots.includes(t);
                const isSelected =
                  available && selectedDate === d && selectedStart === t;
                const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
                const background = dow === 0 ? '#fff1f2' : dow === 6 ? '#eff6ff' : '#fff';
                return (
                  <div
                    key={`${d}-${t}`}
                    className="border-r border-t border-gray-200"
                    style={{
                      height: 42,
                      padding: 3,
                      background,
                    }}
                  >
                    {available ? (
                      <button
                        onClick={() => onPick({ date: d, start: t })}
                        className="rounded-md transition-transform active:scale-90 tabular-nums"
                        style={{
                          width: '100%',
                          height: '100%',
                          background: isSelected ? '#2f9e1d' : '#fff',
                          border: '1.5px solid #2f9e1d',
                          color: isSelected ? '#fff' : '#2f9e1d',
                          fontSize: 20,
                          fontWeight: 700,
                          lineHeight: 1,
                        }}
                        aria-label={`${formatJp(d)} ${t}`}
                      >
                        {isSelected ? '✓' : '○'}
                      </button>
                    ) : (
                      <span
                        className="flex h-full w-full items-center justify-center text-lg font-medium text-gray-500"
                        aria-label={`${formatJp(d)} ${t} 予約不可`}
                      >
                        ×
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
