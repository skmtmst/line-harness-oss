import Icon from '../../components/ui/icon.js';
import { HiddenDateInput, RestaurantTimeChoices, FieldError } from '../../components/forms/controls.js';
import Button from '../../components/ui/button/index.js';
import { useRef } from 'react';
import type { RestaurantCustomerSlot, RestaurantUnavailableReason } from '@line-crm/shared';
import {
  closedNote,
  longDate,
  hasOpenSlot,
  slotLabel,
  zonedParts,
  type DayChip,
} from '../../lib/seat-reserve.js';





export type DaySlots = RestaurantCustomerSlot[] | 'loading' | 'error' | 'closed';

/**
 * ① 人数・日時・コース (V8)。人数は増減、日にちは端末の選択、時刻は空きの札。
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

  // 札の日とその次の日で、空きが1つも無い日を注に出す (今日は営業が終わっただけのことが多いので外す)。
  const noted = [...chips.map((c) => c.date), chips.length ? nextDay(chips) : null]
    .filter((d): d is string => !!d && d !== today)
    .filter((d) => {
      const v = days[d];
      return v === 'closed' || (Array.isArray(v) && !hasOpenSlot(v));
    });
  const note = closedNote(noted, reasons);


  function openOther() {
    const el = otherRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.click();
    }
  }

  return <div className="space-y-3" data-design-node="KRppA">
    <div className="flex items-center gap-2">
      <span id="seat-guest" className="flex-1 text-xs leading-[18px] font-semibold text-liff-sub">人数</span>
      <Button variant="restaurant-control" aria-label="人数を減らす" disabled={guestCount<=1} onClick={()=>onGuest(guestCount-1)}>−</Button>
      <span aria-live="polite" className="text-[15px] leading-[23px] font-bold text-ink">{`${guestCount}名`}</span>
      <Button variant="restaurant-control" aria-label="人数を増やす" disabled={guestCount>=100} onClick={()=>onGuest(guestCount+1)}>＋</Button>
    </div>
    <Button variant="restaurant-date" type="button" aria-label="日にちを選ぶ" onClick={openOther}>{longDate(date).trim()}</Button>
    <HiddenDateInput ref={otherRef} min={today} value={date} aria-label="ほかの日" tabIndex={-1} onChange={e=>e.target.value&&onDate(e.target.value)} />
    {day==='loading'||day===undefined ? <p role="status" className="text-xs text-liff-sub">空きを読み込んでいます…</p>
      : day==='error' ? <p className="text-[13px] leading-5 text-liff-sub">空きを読み込めませんでした。<Button variant="text" onClick={onRetry}>もう一度読み込む</Button></p>
      : day==='closed'||!day.length ? <p className="text-[13px] leading-5 text-liff-sub">この日は予約を受け付けていません。ほかの日を選んでください。</p>
      : <RestaurantTimeChoices value={startsAt} onChange={onTime} options={day.map(s => ({ value: s.startsAt, label: zonedParts(s.startsAt, timeZone).hm, accessibleLabel: `${zonedParts(s.startsAt, timeZone).hm} ${slotLabel(s)}`, available: s.available }))} />}
    {Array.isArray(day)&&day.some(s=>!s.available) && <p className="flex items-center gap-3 rounded-(--liff-radius) bg-liff-note px-4 py-3 text-[13px] leading-5 text-liff-sub"><Icon name="info" tone="info" className="h-4 w-4 shrink-0" />{day.filter(s=>!s.available).map(s=>zonedParts(s.startsAt,timeZone).hm).join('・')} は満席です</p>}
    {note&&<p className="text-xs leading-[18px] text-liff-sub">{note}</p>}
    {error&&<FieldError>{error}</FieldError>}
  </div>;
}

function nextDay(chips: DayChip[]): string {
  const last = chips[chips.length - 1]!.date;
  const d = new Date(`${last}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
