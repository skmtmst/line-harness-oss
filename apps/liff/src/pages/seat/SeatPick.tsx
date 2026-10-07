import { useRef } from 'react';
import type { RestaurantCustomerSlot, RestaurantUnavailableReason } from '@line-crm/shared';
import {
  closedNote,
  hasOpenSlot,
  md,
  slotLabel,
  slotState,
  weekday,
  zonedParts,
  type DayChip,
} from '../../lib/seat-reserve.js';

/** 札で選べる人数。5 は「5名以上」で、選ぶと下に人数の選択が出る。 */
const GUESTS = [1, 2, 3, 4, 5] as const;
const MANY_MAX = 20;

export type DaySlots = RestaurantCustomerSlot[] | 'loading' | 'error' | 'closed';

/**
 * ① 人数と日時 (★V8 glL3g)。人数の札・今日から5日の札・ほかの日・時刻の3列。
 * 選べない時刻 (満席) は押せない。空きを1つも持たない日は札を押せない形にし、下に注を出す。
 */
export default function SeatPick({
  timeZone,
  today,
  chips,
  days,
  reasons = {},
  guestCount,
  date,
  startsAt,
  error,
  onGuest,
  onDate,
  onTime,
  onRetry,
}: {
  timeZone: string;
  today: string;
  chips: DayChip[];
  /** 日ごとの空き。札の日＋その次の日を先に読む。 */
  days: Record<string, DaySlots>;
  /** 空きが無い日の理由（臨時休業・貸切・定休日・満席）。 */
  reasons?: Record<string, RestaurantUnavailableReason | undefined>;
  guestCount: number;
  date: string;
  startsAt: string | null;
  error: string | null;
  onGuest: (n: number) => void;
  onDate: (date: string) => void;
  onTime: (startsAt: string) => void;
  onRetry: () => void;
}) {
  const otherRef = useRef<HTMLInputElement>(null);
  const day = days[date];
  const inChips = chips.some((c) => c.date === date);
  // 札の日とその次の日で、空きが1つも無い日を注に出す (今日は営業が終わっただけのことが多いので外す)。
  const noted = [...chips.map((c) => c.date), chips.length ? nextDay(chips) : null]
    .filter((d): d is string => !!d && d !== today)
    .filter((d) => {
      const v = days[d];
      return v === 'closed' || (Array.isArray(v) && !hasOpenSlot(v));
    });
  const note = closedNote(noted, reasons);
  const many = guestCount >= 5;

  function openOther() {
    const el = otherRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.click();
    }
  }

  return (
    <div className="space-y-3.5" data-design-node="glL3g">
      <h2 className="text-xl font-bold text-ink">人数と日時を選んでください</h2>

      <p id="seat-guest" className="text-[13px] leading-5 font-bold text-ink">人数</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="seat-guest">
        {GUESTS.map((n) => {
          const on = n === 5 ? many : guestCount === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onGuest(n === 5 && many ? guestCount : n)}
              className={`liff-hit liff-press rounded-full px-3.5 py-[7px] text-[13px] leading-5 font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-ink ${
                on ? 'bg-ink text-canvas' : 'bg-liff-chip text-ink'
              }`}
            >
              {n === 5 ? '5名以上' : `${n}名`}
            </button>
          );
        })}
        {many && (
          <label className="flex items-center gap-1.5 text-[13px] text-ink">
            <span className="sr-only">人数</span>
            <select
              value={guestCount}
              onChange={(e) => onGuest(Number(e.target.value))}
              className="h-[34px] rounded-full bg-canvas px-3 text-[13px] text-ink outline outline-1 -outline-offset-1 outline-liff-line-strong focus-visible:outline-2 focus-visible:outline-ink"
            >
              {Array.from({ length: MANY_MAX - 4 }, (_, i) => i + 5).map((n) => (
                <option key={n} value={n}>
                  {n}名
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <p id="seat-day" className="text-[13px] leading-5 font-bold text-ink">日にち</p>
      <div className="flex gap-1.5" role="radiogroup" aria-labelledby="seat-day">
        {chips.map((c) => {
          const v = days[c.date];
          const off = v === 'closed' || (Array.isArray(v) && !hasOpenSlot(v));
          const on = c.date === date;
          return (
            <button
              key={c.date}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${md(c.date)}（${weekday(c.date)}）${off ? '・空きなし' : ''}`}
              onClick={() => onDate(c.date)}
              className={`liff-press flex min-w-0 flex-1 flex-col items-center rounded-(--liff-radius) py-2 focus-visible:outline-2 focus-visible:outline-ink ${
                on
                  ? 'bg-liff-soft outline-2 -outline-offset-1 outline-liff-primary'
                  : off
                    ? 'bg-liff-off-bg outline-1 -outline-offset-1 outline-liff-line'
                    : 'bg-canvas outline-1 -outline-offset-1 outline-liff-line'
              }`}
            >
              <span className={`liff-num text-[13px] leading-5 font-bold ${off && !on ? 'text-liff-off-ink' : 'text-ink'}`}>
                {c.top}
              </span>
              <span className={`text-[11px] leading-[17px] ${off && !on ? 'text-liff-off-ink' : 'text-liff-sub'}`}>
                {c.bottom}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex">
        <button
          type="button"
          onClick={openOther}
          className={`liff-hit text-[13px] leading-5 font-semibold text-liff-primary focus-visible:outline-2 focus-visible:outline-ink ${
            inChips ? '' : 'underline underline-offset-2'
          }`}
        >
          {inChips ? 'ほかの日を選ぶ ›' : `ほかの日：${md(date)}（${weekday(date)}） ›`}
        </button>
        <input
          ref={otherRef}
          type="date"
          min={today}
          value={date}
          aria-label="ほかの日"
          tabIndex={-1}
          onChange={(e) => e.target.value && onDate(e.target.value)}
          className="sr-only"
        />
      </div>

      <p className="text-[13px] leading-5 font-bold text-ink">{`時刻（${guestCount}名で空いている時間）`}</p>
      {day === 'loading' || day === undefined ? (
        <div className="grid grid-cols-3 gap-1.5" aria-label="読み込み中">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="liff-shimmer-bone h-[53px] rounded-(--liff-radius) bg-liff-off-bg" />
          ))}
        </div>
      ) : day === 'error' ? (
        <p className="text-[13px] leading-6 text-liff-sub">
          空きを読み込めませんでした。{' '}
          <button type="button" onClick={onRetry} className="font-semibold text-liff-primary underline underline-offset-2">
            もう一度読み込む
          </button>
        </p>
      ) : day === 'closed' || day.length === 0 ? (
        <p className="text-[13px] leading-6 text-liff-sub">この日は予約を受け付けていません。ほかの日を選んでください。</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="時刻">
          {day.map((s) => {
            const st = slotState(s);
            const on = s.startsAt === startsAt;
            const hm = zonedParts(s.startsAt, timeZone).hm;
            return (
              <button
                key={s.startsAt}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`${hm} ${slotLabel(s)}`}
                disabled={st === 'full'}
                onClick={() => onTime(s.startsAt)}
                className={`liff-press flex flex-col items-center rounded-(--liff-radius) py-2 focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-100 ${
                  on
                    ? 'bg-liff-soft outline-2 -outline-offset-1 outline-liff-primary'
                    : st === 'full'
                      ? 'bg-liff-off-bg outline-1 -outline-offset-1 outline-liff-line'
                      : 'bg-canvas outline-1 -outline-offset-1 outline-liff-line'
                }`}
              >
                <span className={`liff-num text-[13px] leading-5 font-bold ${st === 'full' ? 'text-liff-full' : 'text-ink'}`}>
                  {hm}
                </span>
                <span
                  className={`text-[11px] leading-[17px] ${
                    st === 'full' ? 'text-liff-full' : st === 'few' ? 'text-liff-dot-few' : 'text-liff-sub'
                  }`}
                >
                  {slotLabel(s)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {note && <p className="text-xs leading-[18px] text-liff-sub">{note}</p>}
      {error && (
        <p role="alert" className="text-[13px] leading-6 text-danger">
          {error}
        </p>
      )}
      <div className="pb-40" aria-hidden="true" />
    </div>
  );
}

function nextDay(chips: DayChip[]): string {
  const last = chips[chips.length - 1]!.date;
  const d = new Date(`${last}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
