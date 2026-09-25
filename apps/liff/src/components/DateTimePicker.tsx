import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { jstToday, addDays, formatJp, formatMd, formatWeekday } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from './LoadErrorView.js';
import LoadingView from './LoadingView.js';

export type SlotPick = { date: string; start: string };

/**
 * 1-c 日時を選ぶ。日付は横に並ぶ札 (空きが無い日は灰色で「満席」)、
 * 時間は3列の枠。時刻の札を押すと選ばれるだけで、進むのは下の操作の帯。
 * (撮影: 時刻のボタン名は「10:00」のまま。qa-shots.mjs が名前で押す)
 */
export default function DateTimePicker({
  menuId,
  staffId,
  hint,
  selected,
  onSelect,
}: {
  menuId: string;
  staffId: string;
  hint?: string;
  selected: SlotPick | null;
  onSelect: (s: SlotPick) => void;
}) {
  const [from] = useState(jstToday());
  const [to] = useState(addDays(jstToday(), 13));
  const [byDate, setByDate] = useState<Record<string, string[]> | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    setFailed(false);
    api
      .availability(menuId, staffId, from, to)
      .then((r) => {
        const slots = r.by_staff[0]?.slots ?? [];
        const grouped: Record<string, string[]> = {};
        for (const s of slots) (grouped[s.date] ??= []).push(s.start);
        setByDate(grouped);
        setDay((prev) => (prev && grouped[prev] ? prev : Object.keys(grouped)[0] ?? null));
      })
      .catch((e) => {
        logFailure('availability', e);
        setFailed(true);
      });
  }, [menuId, staffId, from, to, reloadKey]);

  if (failed) return <LoadErrorView onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!byDate) return <LoadingView />;

  // 14日ぶんの日付の札を横に並べる (5枚ぶんが見え、残りは横に動かす)。
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const times = day ? (byDate[day] ?? []) : [];

  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-ink">日時を選んでください</h2>
      {hint && <p className="text-xs leading-5 text-ink-secondary">{hint}</p>}
      {days.every((d) => !(byDate[d]?.length)) ? (
        <p className="text-sm leading-6 text-ink-secondary">この期間に空きはありません。</p>
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto px-4" role="group" aria-label="日付">
            <div className="flex gap-2 pb-1">
              {days.map((d) => {
                const open = (byDate[d]?.length ?? 0) > 0;
                const active = d === day;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDay(d)}
                    disabled={!open}
                    aria-pressed={active}
                    className={`flex min-h-16 w-15 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-2 focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-100 ${
                      active
                        ? 'border-accent-deep bg-accent-deep text-white'
                        : open
                          ? 'border-hairline bg-canvas text-ink'
                          : 'border-hairline bg-canvas text-ink-faint'
                    }`}
                  >
                    <span className={`text-xs ${active ? 'text-white' : open ? 'text-ink-secondary' : 'text-ink-faint'}`}>
                      {formatWeekday(d)}
                    </span>
                    <span className="text-sm font-bold whitespace-nowrap">{formatMd(d)}</span>
                    {!open && <span className="text-[11px]">満席</span>}
                  </button>
                );
              })}
            </div>
          </div>
          {day && (
            <section aria-label={`${formatJp(day)}の空き`}>
              <h3 className="mb-2 text-sm font-bold text-ink">{formatJp(day)} の空き</h3>
              {times.length === 0 ? (
                <p className="text-sm leading-6 text-ink-secondary">この日は満席です。別の日を選んでください。</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {times.map((t) => {
                    const active = selected?.date === day && selected?.start === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onSelect({ date: day, start: t })}
                        aria-pressed={active}
                        className={`min-h-11 rounded-lg border px-1 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ink ${
                          active
                            ? 'border-accent-deep bg-ok-bg font-bold text-accent-deep'
                            : 'border-hairline bg-canvas text-ink'
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
