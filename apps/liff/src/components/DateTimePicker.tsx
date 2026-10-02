import { useEffect, useRef, useState } from 'react';
import { api, type MenuItem, type StaffItem } from '../lib/api.js';
import { jstToday, addDays, formatJpLong, formatWeekday, addMinutesHm } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from './LoadErrorView.js';
import LoadingView from './LoadingView.js';
import Icon from './ui/Icon.js';
import BottomBar from './ui/BottomBar.js';
import Button from './ui/Button.js';

export type SlotPick = { date: string; start: string };

/** 日時を選ぶ段の見せ方。'list' が週5日の並び (M2p63S)、'calendar' が月の表 (k3aJKU)。 */
export type DateView = 'list' | 'calendar';

const VIEW_STORAGE_KEY = 'liff-booking-date-view';
/** 週の並びは5日ぶんずつ。送ると次の5日へ。 */
const WEEK_DAYS = 5;
/** 空き枠の口は28日までしか受けないので、月ぶんは割って呼ぶ。 */
const CHUNK_DAYS = 28;
const WEEKDAY_JP = '日月火水木金土';

/** 端末に覚えた見せ方。読めないときは黙って null（設定の値に戻る）。 */
function storedView(): DateView | null {
  try {
    const value = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return value === 'list' || value === 'calendar' ? value : null;
  } catch {
    return null;
  }
}

/** 切り替えた見せ方を端末に覚える。書けないときは黙って諦める。 */
function rememberView(view: DateView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* 書けない端末では次回も設定の値で開く */
  }
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

type AvailSlot = { date: string; start: string; remaining?: number; state?: string };
/** 時刻の枠。open=false は埋まった枠 (灰色で出す・押せない)。 */
export type TimeSlot = { start: string; open: boolean };

/**
 * 空き読み出しのまとめ役（週・カレンダー共通）。
 * 月をまたいで28日ずつに割って読むと、同じ日の同じ枠が二重に入ることが
 * ある（口が期間を広めに返す・同じ枠を二口が返す）。同じ枠（担当＋開始
 * 時刻）は1つにまとめる。埋まった枠（残り0）も時刻の札には出すが
 * 押せない灰色にし、「満」の判定にも使う。
 */
function groupSlots(
  buckets: Array<{ staff_id: string; slots: AvailSlot[] }>,
): { byDate: Record<string, TimeSlot[]>; fullDates: Record<string, true> } {
  const seen = new Map<string, TimeSlot>();
  const hasSlot: Record<string, true> = {};
  for (const bucket of buckets) {
    for (const s of bucket.slots ?? []) {
      hasSlot[s.date] = true;
      const open = !((s.remaining ?? 1) <= 0 || s.state === 'full' || s.state === 'closed');
      const key = `${bucket.staff_id}\0${s.date}\0${s.start}`;
      const prev = seen.get(`${s.date}\0${s.start}`);
      if (prev) {
        prev.open ||= open;
      } else {
        seen.set(`${s.date}\0${s.start}`, { start: s.start, open });
      }
    }
  }
  const byDate: Record<string, TimeSlot[]> = {};
  for (const [key, t] of seen) {
    const d = key.split('\0')[0];
    (byDate[d] ??= []).push(t);
  }
  for (const d of Object.keys(byDate)) {
    byDate[d].sort((a, b) => (a.start < b.start ? -1 : 1));
  }
  const fullDates: Record<string, true> = {};
  for (const d of Object.keys(hasSlot)) {
    if (!(byDate[d]?.some((t) => t.open))) fullDates[d] = true;
  }
  return { byDate, fullDates };
}

function addMonths(month: string, count: number): string {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(year, mon - 1 + count, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthStart(month: string): string {
  return `${month}-01`;
}

function monthEnd(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

/** 見ている月のうち、空きのある日を早い順に並べる（今日〜受付期限の内側だけ）。 */
function openDaysOfMonth(
  target: string,
  byDate: Record<string, TimeSlot[]>,
  today: string,
  windowEnd: string,
): string[] {
  const from = monthStart(target) < today ? today : monthStart(target);
  const to = monthEnd(target) > windowEnd ? windowEnd : monthEnd(target);
  return Object.keys(byDate)
    .filter((d) => d >= from && d <= to && (byDate[d]?.some((t) => t.open)))
    .sort();
}

/** [from, to] を CHUNK_DAYS 日ずつに割る（口の上限に収める）。 */
function splitRange(from: string, to: string): Array<[string, string]> {
  const chunks: Array<[string, string]> = [];
  let head = from;
  while (head <= to) {
    const tail = addDays(head, CHUNK_DAYS - 1) <= to ? addDays(head, CHUNK_DAYS - 1) : to;
    chunks.push([head, tail]);
    head = addDays(tail, 1);
  }
  return chunks;
}

type DayState = 'open' | 'full' | 'closed' | 'past' | 'off' | 'empty';

/**
 * 読み上げ文。「10月4日 満席」のように日付と状態だけにする。
 * 色・印だけでは伝わらない人に、状態を言葉で渡す。
 * 過ぎた日は「過ぎた日」と読む（期間の外の未来日は「選択できません」）。
 * 枠が1つも無い日は「空きなし」と読む（「満席」は枠があって全部埋まった日だけ）。
 */
export function dayStateLabel(date: string, state: DayState): string {
  const d = new Date(`${date}T00:00:00Z`);
  const base = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  if (state === 'open') return `${base} 空きあり`;
  if (state === 'full') return `${base} 満席`;
  if (state === 'closed') return `${base} お休み`;
  if (state === 'past') return `${base} 過ぎた日`;
  if (state === 'empty') return `${base} 空きなし`;
  return `${base} 選択できません`;
}

function stateOf(date: string, byDate: Record<string, TimeSlot[]>, full: Record<string, true>, closed: Record<string, true>, today: string, windowEnd: string): DayState {
  if (date < today) return 'past';
  if (date > windowEnd) return 'off';
  if (closed[date]) return 'closed';
  if (byDate[date]?.some((t) => t.open)) return 'open';
  if (full[date]) return 'full';
  return 'empty';
}

/** 週の日セルの短い印。空き・満・休み。枠の無い日は「満」に寄せる。 */
function weekMark(state: DayState): string {
  if (state === 'open') return '空き';
  if (state === 'closed') return '休み';
  return '満';
}

/** 選んだ日の時刻3列 (★V8・M2p63S)。埋まった時刻は灰色で押せない。 */
function DaySlots({
  day,
  times,
  selected,
  onSelect,
}: {
  day: string;
  times: TimeSlot[];
  selected: SlotPick | null;
  onSelect: (s: SlotPick) => void;
}) {
  return (
    <section aria-label={`${formatJpLong(day)}の空き`}>
      <h3 className="mb-2 text-sm font-bold text-ink">{formatJpLong(day)} の空き</h3>
      {times.length === 0 ? (
        <p className="text-[13px] leading-6 text-liff-sub">この日は満席です。別の日を選んでください。</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {times.map((t) => {
            const active = selected?.date === day && selected?.start === t.start;
            return (
              <button
                key={t.start}
                type="button"
                onClick={() => onSelect({ date: day, start: t.start })}
                disabled={!t.open}
                aria-pressed={active}
                className={`h-11 rounded-[10px] px-1 text-[15px] focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-100 ${
                  active
                    ? 'bg-liff-primary font-bold text-white'
                    : t.open
                      ? 'bg-canvas font-medium text-ink outline -outline-offset-1 outline-liff-line-strong'
                      : 'bg-liff-off-bg font-medium text-liff-off-ink'
                }`}
              >
                {t.start}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * 1-c 日時を選ぶ (★V8)。手順の下に「週で見る｜カレンダー」の切り替えがある。
 * 週は5日の並び（空き・満・休み）＋選んだ日の時刻3列。
 * カレンダーは月の表（●空きあり・灰色は満席か休み）。日を選んで
 * 「この日の時間を選ぶ」で週の表示へ移る。
 * 時刻の札を押すと選ばれるだけで、進むのは下の操作の帯。
 * 空きの無い週は「次の週を見る」「担当を選び直す」の手を出す (ADutg)。
 * (撮影: 時刻のボタン名は「10:00」のまま。qa-shots.mjs が名前で押す)
 */
export default function DateTimePicker({
  menu,
  staff,
  hint,
  selected,
  onSelect,
  onConfirm,
  confirmLabel = '内容を確かめる',
  onBackToStaff,
  onLoadState,
}: {
  menu: MenuItem;
  staff: StaffItem;
  hint?: string;
  selected: SlotPick | null;
  onSelect: (s: SlotPick | null) => void;
  /** 下の帯の主ボタン (週: 内容を確かめる / peek: この時間で予約に進む)。 */
  onConfirm: () => void;
  confirmLabel?: string;
  /** 「担当を選び直す」。空きの無い週と下の帯の戻るで使う。 */
  onBackToStaff: () => void;
  /** 読み込み中・失敗・空きが無い間は、下の帯を出さないための合図。 */
  onLoadState?: (ready: boolean) => void;
}) {
  const today = jstToday();
  // 予約の設定（最初の形・受付期間）。読めるまで切り替えは出さない。
  const [settings, setSettings] = useState<{ initialView: DateView; windowDays: number } | null>(
    null,
  );
  const [view, setView] = useState<DateView | null>(null);
  const listButtonRef = useRef<HTMLButtonElement | null>(null);
  const calendarButtonRef = useRef<HTMLButtonElement | null>(null);

  // 週表示用。5日ぶんずつ読んで足していく。選んだ日を持って戻ってきた
  // ときは、その日が見える位置から始める。
  const [winStart, setWinStart] = useState(() =>
    selected?.date && selected.date > today ? selected.date : today,
  );
  const [weekByDate, setWeekByDate] = useState<Record<string, TimeSlot[]> | null>(null);
  const [weekFull, setWeekFull] = useState<Record<string, true>>({});
  const [weekClosed, setWeekClosed] = useState<Record<string, true>>({});
  const [loadedWins, setLoadedWins] = useState<Set<string>>(new Set());
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekFailed, setWeekFailed] = useState(false);
  const [weekReloadKey, setWeekReloadKey] = useState(0);
  const [listDay, setListDay] = useState<string | null>(selected?.date ?? null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // カレンダー用。月を送っても読んだぶんは足していく。
  const [calByDate, setCalByDate] = useState<Record<string, TimeSlot[]>>({});
  const [calClosed, setCalClosed] = useState<Record<string, true>>({});
  const [calFull, setCalFull] = useState<Record<string, true>>({});
  const [loadedMonths, setLoadedMonths] = useState<string[]>([]);
  const loadingMonthsRef = useRef<Set<string>>(new Set());
  const [month, setMonth] = useState(monthOf(selected?.date ?? today));
  const [calDay, setCalDay] = useState<string | null>(selected?.date ?? null);
  const [calFailed, setCalFailed] = useState(false);
  const [calReloadKey, setCalReloadKey] = useState(0);
  // 最初に開く月の探索が済んだか。済むまでは空きの無い月を飛ばす。
  const [calAutoDone, setCalAutoDone] = useState(false);
  // 利用者が一度でも日を選んだら、遅れて届く応答の自動選択で上書きしない
  // (週・カレンダー共通。担当が変わると呼び側の key で作り直されるので、
  // 画面の中では消さない。読み直しだけ最初から探し直す)。
  const userPickedDayRef = useRef(!!selected);

  const windowEnd = settings ? addDays(today, settings.windowDays) : addDays(today, 60);

  // 最初の形は「端末の覚え → 管理画面の設定 → 週で見る」の順。設定が読めなくても止めない。
  useEffect(() => {
    api
      .bookingSettings()
      .then((r) => {
        const initialView =
          storedView() ??
          (r.liff_date_view === 'calendar' ? 'calendar' : 'list');
        const windowDays =
          Number.isInteger(r.booking_window_days) &&
          r.booking_window_days >= 1 &&
          r.booking_window_days <= 365
            ? r.booking_window_days
            : 60;
        setSettings({ initialView, windowDays });
        setView(initialView);
      })
      .catch((e) => {
        logFailure('booking-settings', e);
        setSettings({ initialView: storedView() ?? 'list', windowDays: 60 });
        setView(storedView() ?? 'list');
      });
  }, []);

  // 週表示: 見ている5日ぶんが未読なら読む。読んだぶんは窓を越えて残す。
  useEffect(() => {
    if (view !== 'list' || !settings) return;
    if (loadedWins.has(winStart)) return;
    let cancelled = false;
    const from = winStart;
    const to = addDays(winStart, WEEK_DAYS - 1) <= windowEnd ? addDays(winStart, WEEK_DAYS - 1) : windowEnd;
    setWeekLoading(true);
    setWeekFailed(false);
    api
      .availability(menu.id, staff.id, from, to)
      .then((r) => {
        if (cancelled) return;
        const { byDate, fullDates } = groupSlots(r.by_staff[0] ? [r.by_staff[0]] : []);
        const closed: Record<string, true> = {};
        for (const d of r.closed_dates ?? []) closed[d] = true;
        setWeekByDate((prev) => ({ ...(prev ?? {}), ...byDate }));
        setWeekFull((prev) => ({ ...prev, ...fullDates }));
        setWeekClosed((prev) => ({ ...prev, ...closed }));
        setLoadedWins((prev) => new Set(prev).add(winStart));
        setWeekLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        logFailure('availability', e);
        setWeekFailed(true);
        setWeekLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, settings, winStart, menu.id, staff.id, today, windowEnd, loadedWins, weekReloadKey]);

  // 見ている週が読めたら、空きのある一番早い日を選ぶ。
  // 利用者がまだ日を選んでいない間だけ選び直す。
  useEffect(() => {
    if (view !== 'list' || !settings || !weekByDate) return;
    if (!loadedWins.has(winStart)) return;
    if (userPickedDayRef.current) return;
    setListDay((prev) => {
      if (prev && weekByDate[prev]?.some((t) => t.open)) return prev;
      for (let i = 0; i < WEEK_DAYS; i++) {
        const d = addDays(winStart, i);
        if (d > windowEnd) break;
        if (weekByDate[d]?.some((t) => t.open)) return d;
      }
      return prev ?? null;
    });
  }, [view, settings, weekByDate, loadedWins, winStart, today, windowEnd]);

  // 見ている月のぶんを、28日ずつに割って読む。
  useEffect(() => {
    if (view !== 'calendar' || !settings) return;
    if (loadedMonths.includes(month) || loadingMonthsRef.current.has(`${calReloadKey}:${month}`)) {
      return;
    }
    loadingMonthsRef.current.add(`${calReloadKey}:${month}`);
    const from = monthStart(month) < today ? today : monthStart(month);
    const to = monthEnd(month) > windowEnd ? windowEnd : monthEnd(month);
    if (from > to) {
      setLoadedMonths((prev) => (prev.includes(month) ? prev : [...prev, month]));
      return;
    }
    let cancelled = false;
    void Promise.all(
      splitRange(from, to).map(([head, tail]) => api.availability(menu.id, staff.id, head, tail)),
    )
      .then((results) => {
        if (cancelled) return;
        const buckets = results.flatMap((r) => (r.by_staff[0] ? [r.by_staff[0]] : []));
        const { byDate: grouped, fullDates } = groupSlots(buckets);
        const closed: Record<string, true> = {};
        for (const r of results) {
          for (const d of r.closed_dates ?? []) closed[d] = true;
        }
        setCalByDate((prev) => ({ ...prev, ...grouped }));
        setCalClosed((prev) => ({ ...prev, ...closed }));
        setCalFull((prev) => ({ ...prev, ...fullDates }));
        setLoadedMonths((prev) => (prev.includes(month) ? prev : [...prev, month]));
      })
      .catch((e) => {
        if (cancelled) return;
        logFailure('availability', e);
        setCalFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [view, settings, month, menu.id, staff.id, today, windowEnd, loadedMonths, calReloadKey]);

  // 見ている月が読めたら、その月で空きのある一番早い日を選ぶ。
  // 利用者がまだ日を選んでいない間だけ選び直す。選んだ後の月送り・
  // 遅れて届く応答では、選んだ日を残す（上書きしない）。
  useEffect(() => {
    if (view !== 'calendar' || !settings) return;
    if (!loadedMonths.includes(month)) return;
    if (userPickedDayRef.current) return;
    const open = openDaysOfMonth(month, calByDate, today, windowEnd);
    setCalDay(open[0] ?? null);
  }, [view, settings, month, loadedMonths, calByDate, today, windowEnd]);

  // 最初に開く月は、空きのある一番早い日がある月にする。
  // 今月に空きが無ければ次の月へ送る（利用者が月を送った後は動かない）。
  useEffect(() => {
    if (view !== 'calendar' || !settings || calAutoDone) return;
    if (!loadedMonths.includes(month)) return;
    const open = openDaysOfMonth(month, calByDate, today, windowEnd);
    if (open.length > 0 || month >= monthOf(windowEnd)) {
      setCalAutoDone(true);
      return;
    }
    setMonth(addMonths(month, 1));
  }, [view, settings, calAutoDone, month, loadedMonths, calByDate, today, windowEnd]);

  // 週・月の「空きあり」判定 (下の帯を出して良いかの合図に使う)。
  const weekDays: string[] = [];
  for (let i = 0; i < WEEK_DAYS; i++) {
    const d = addDays(winStart, i);
    if (d > windowEnd) break;
    weekDays.push(d);
  }
  const weekHasOpen = weekDays.some((d) => weekByDate?.[d]?.some((t) => t.open));
  const calHasSlots = Object.values(calByDate).some((times) => times.some((t) => t.open));
  const monthLoaded = loadedMonths.includes(month);
  useEffect(() => {
    if (view === 'list')
      onLoadState?.(weekByDate !== null && !weekFailed && !weekLoading && weekHasOpen);
    else if (view === 'calendar')
      onLoadState?.(settings !== null && monthLoaded && !calFailed && calHasSlots);
    else onLoadState?.(false);
  }, [view, settings, weekByDate, weekFailed, weekLoading, weekHasOpen, monthLoaded, calFailed, calHasSlots, onLoadState]);

  // 選んでいる日が枠の外にいるときは、横だけ中央に流す (縦には動かさない)。
  useEffect(() => {
    stripRef.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [listDay, weekByDate]);

  function switchView(next: DateView) {
    // 選んだ日は持って反対側へ移る（切り替えで選択が消えて見えないように）。
    if (next === 'list' && view === 'calendar' && calDay) {
      jumpToWeekDay(calDay);
      return;
    }
    if (next === 'calendar' && view === 'list' && listDay) {
      setMonth(monthOf(listDay));
      setCalDay(listDay);
    }
    setView(next);
    rememberView(next);
  }

  function moveViewKey(event: React.KeyboardEvent) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft' && event.key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    const next: DateView = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 'calendar' : 'list';
    switchView(next);
    (next === 'calendar' ? calendarButtonRef : listButtonRef).current?.focus();
  }

  /** カレンダーで選んだ日へ週表示を移す (この日の時間を選ぶ)。 */
  function jumpToWeekDay(day: string) {
    userPickedDayRef.current = true;
    setWinStart(day < today ? today : day);
    setListDay(day);
    // switchView('list') だと calDay 経由でこの関数へ戻るので、直接切り替える。
    setView('list');
    rememberView('list');
  }

  /** 週を送る。見ている日も次へ進める（前の週で選んだ日を持ち越さない）。
   *  持ち越すと、日の並びに無い日の時刻だけが残って見える。 */
  function moveWeek(dir: 1 | -1) {
    userPickedDayRef.current = false;
    setListDay(null);
    setWinStart((w) => addDays(w, dir * WEEK_DAYS));
  }

  function retryWeek() {
    setWeekFailed(false);
    setWeekByDate(null);
    setWeekFull({});
    setWeekClosed({});
    setLoadedWins(new Set());
    if (!userPickedDayRef.current) setListDay(null);
    setWeekReloadKey((k) => k + 1);
  }

  if (!settings || view === null) return <LoadingView />;

  const currentMonth = monthOf(today);
  const lastMonth = monthOf(windowEnd);
  const canPrevMonth = month > currentMonth;
  const canNextMonth = month < lastMonth;
  const canPrevWeek = winStart > today;
  const canNextWeek = addDays(winStart, WEEK_DAYS) <= windowEnd;

  // カレンダーの升目。月初の曜日ぶんを空けて、日〜土で7列にする。
  const firstWeekday = new Date(`${monthStart(month)}T00:00:00Z`).getUTCDay();
  const monthDays: string[] = [];
  for (let d = monthStart(month); d <= monthEnd(month); d = addDays(d, 1)) monthDays.push(d);

  const monthLabel = `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;
  const monthHasOpen = monthDays.some((d) => calByDate[d]?.some((t) => t.open));
  const listTimes = listDay ? (weekByDate?.[listDay] ?? []) : [];

  const slotEnd =
    selected && addMinutesHm(selected.start, staff.duration_minutes);

  const toggleButton = (target: DateView, label: string) => {
    const active = view === target;
    return (
      <button
        key={target}
        ref={target === 'list' ? listButtonRef : calendarButtonRef}
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => switchView(target)}
        className={`flex h-8 flex-1 items-center justify-center rounded-lg px-1 text-xs focus-visible:outline-2 focus-visible:outline-ink ${
          active ? 'bg-canvas font-bold text-ink' : 'font-semibold text-liff-sub'
        }`}
      >
        {label}
      </button>
    );
  };

  /** 下の帯。「担当を選び直す」の戻るを添える。 */
  const bar = (
    <BottomBar>
      {view === 'list' ? (
        <>
          {selected && slotEnd && (
            <p className="text-center text-[13px] font-bold text-liff-primary">
              {formatJpLong(selected.date)} {selected.start}〜{slotEnd}
            </p>
          )}
          <Button variant="primary" disabled={!selected} onClick={onConfirm}>
            {selected ? confirmLabel : '時間を選ぶ'}
          </Button>
        </>
      ) : (
        <Button
          variant="primary"
          disabled={!calDay}
          onClick={() => calDay && jumpToWeekDay(calDay)}
        >
          この日の時間を選ぶ
        </Button>
      )}
      <button
        type="button"
        onClick={onBackToStaff}
        className="self-center text-xs text-liff-sub focus-visible:outline-2 focus-visible:outline-ink"
      >
        ← 担当を選び直す
      </button>
    </BottomBar>
  );

  return (
    <div className="space-y-3.5" data-design-node={view === 'calendar' ? 'k3aJKU' : 'M2p63S'}>
      <div>
        <h2 className="text-xl font-bold text-ink">日時を選んでください</h2>
        <p className="mt-1 text-xs text-liff-sub">
          {menu.name}・{staff.display_name}
        </p>
      </div>
      {hint && <p className="text-xs leading-5 text-liff-sub">{hint}</p>}
      <div
        role="radiogroup"
        aria-label="表示の切り替え"
        onKeyDown={moveViewKey}
        className="flex gap-1 rounded-[10px] bg-liff-chip p-[3px]"
      >
        {toggleButton('list', '週で見る')}
        {toggleButton('calendar', 'カレンダー')}
      </div>

      {view === 'list' ? (
        weekFailed ? (
          <LoadErrorView onRetry={retryWeek} />
        ) : weekLoading || !weekByDate || !loadedWins.has(winStart) ? (
          <LoadingView />
        ) : !weekHasOpen ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <span className="text-liff-idle" aria-hidden="true">
              <Icon name="calendar-x" className="h-10 w-10" />
            </span>
            <p className="mt-4 text-lg font-bold text-ink">この週は空きがありません</p>
            <p className="mt-2 text-[13px] leading-6 text-pretty text-liff-sub">
              次の週を見るか、担当を「指名なし」にすると見つかることがあります。
            </p>
            <div className="mt-6 flex w-full max-w-55 flex-col gap-2">
              <Button
                variant="primary"
                disabled={!canNextWeek}
                onClick={() => moveWeek(1)}
              >
                次の週を見る
              </Button>
              <Button variant="secondary" onClick={onBackToStaff}>
                担当を選び直す
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5" role="group" aria-label="週をえらぶ">
              <button
                type="button"
                onClick={() => moveWeek(-1)}
                disabled={!canPrevWeek}
                aria-label="前の週"
                className="flex h-10 w-6 shrink-0 items-center justify-center text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:text-liff-off-ink"
              >
                <Icon name="chevron-left" className="h-[18px] w-[18px]" />
              </button>
              <div ref={stripRef} className="grid flex-1 grid-cols-5 gap-1.5" role="group" aria-label="日付">
                {weekDays.map((d) => {
                  const state = stateOf(d, weekByDate, weekFull, weekClosed, today, windowEnd);
                  const open = state === 'open';
                  const active = d === listDay;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        userPickedDayRef.current = true;
                        setListDay(d);
                      }}
                      disabled={!open}
                      aria-pressed={active}
                      aria-label={dayStateLabel(d, state)}
                      title={dayStateLabel(d, state)}
                      className={`flex flex-col items-center gap-0.5 rounded-[10px] py-2 outline -outline-offset-1 focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-100 ${
                        active
                          ? 'bg-liff-soft outline-2 outline-liff-primary'
                          : state === 'closed' || state === 'empty'
                            ? 'bg-liff-off-bg outline-1 outline-liff-line'
                            : 'bg-canvas outline-1 outline-liff-line'
                      }`}
                    >
                      <span className="text-[10px] text-liff-sub">{formatWeekday(d)}</span>
                      <span
                        className={`text-base font-bold ${active ? 'text-liff-primary' : open || state === 'full' ? 'text-ink' : 'text-liff-off-ink'}`}
                      >
                        {Number(d.slice(8, 10))}
                      </span>
                      <span
                        className={`text-[9px] ${
                          active || open ? 'text-liff-primary' : 'text-liff-off-ink'
                        }`}
                      >
                        {weekMark(state)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => moveWeek(1)}
                disabled={!canNextWeek}
                aria-label="次の週"
                className="flex h-10 w-6 shrink-0 items-center justify-center text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:text-liff-off-ink"
              >
                <Icon name="chevron-right" className="h-[18px] w-[18px]" />
              </button>
            </div>
            {listDay && (
              <DaySlots day={listDay} times={listTimes} selected={selected} onSelect={onSelect} />
            )}
          </>
        )
      ) : calFailed ? (
        <LoadErrorView onRetry={() => {
          loadingMonthsRef.current.clear();
          // 読み直しは最初から探し直す（選んだ日も消えるので自動選択を戻す）。
          userPickedDayRef.current = false;
          setCalFailed(false);
          setCalByDate({});
          setCalClosed({});
          setCalFull({});
          setLoadedMonths([]);
          setCalDay(null);
          // 読み直しは今月から探し直す。
          setMonth(monthOf(today));
          setCalAutoDone(false);
          setCalReloadKey((k) => k + 1);
        }} />
      ) : (
        <>
          <div>
            <div aria-label="月をえらぶ" className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMonth(addMonths(month, -1))}
                disabled={!canPrevMonth}
                aria-label="前の月"
                className="flex h-9 w-9 items-center justify-center text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:text-liff-off-ink"
              >
                <Icon name="chevron-left" className="h-[18px] w-[18px]" />
              </button>
              <p aria-live="polite" className="text-sm font-bold text-ink">
                {monthLabel}
              </p>
              <button
                type="button"
                onClick={() => setMonth(addMonths(month, 1))}
                disabled={!canNextMonth}
                aria-label="次の月"
                className="flex h-9 w-9 items-center justify-center text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:text-liff-off-ink"
              >
                <Icon name="chevron-right" className="h-[18px] w-[18px]" />
              </button>
            </div>
            {!monthLoaded ? (
              <LoadingView />
            ) : (
              <>
                <div className="grid grid-cols-7" aria-label={`${monthLabel}の曜日`}>
                  {WEEKDAY_JP.split('').map((w, i) => (
                    <span
                      key={w}
                      className={`py-1 text-center text-[11px] ${i === 0 ? 'text-liff-sun' : i === 6 ? 'text-liff-sat' : 'text-liff-sub'}`}
                    >
                      {w}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7" aria-label={`${monthLabel}の日付`}>
                  {Array.from({ length: firstWeekday }).map((_, i) => (
                    <span key={`pad-${i}`} aria-hidden="true" />
                  ))}
                  {monthDays.map((d) => {
                    const state = stateOf(d, calByDate, calFull, calClosed, today, windowEnd);
                    const dayNum = Number(d.slice(8, 10));
                    const selectable = state === 'open';
                    const active = d === calDay;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          userPickedDayRef.current = true;
                          setCalDay(d);
                        }}
                        disabled={!selectable}
                        aria-pressed={active}
                        aria-label={dayStateLabel(d, state)}
                        className={`flex h-11 flex-col items-center justify-center gap-0.5 rounded-[10px] focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-100 ${
                          active
                            ? 'bg-liff-primary font-semibold text-white'
                            : selectable
                              ? 'font-semibold text-ink'
                              : 'font-semibold text-liff-off-ink'
                        }`}
                      >
                        <span className="text-sm leading-tight">{dayNum}</span>
                        <span className="flex h-1.5 items-center leading-none">
                          {state === 'open' && (
                            <span
                              className={`block h-[5px] w-[5px] rounded-full ${active ? 'bg-transparent' : 'bg-liff-primary'}`}
                              aria-hidden="true"
                            />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-liff-sub">
                  <span>
                    <span className="text-liff-primary">●</span> 空きあり
                  </span>
                  <span>灰色：満席・休み</span>
                </p>
                {!calDay && (
                  <p className="mt-2 text-[13px] leading-6 text-liff-sub">
                    {monthHasOpen ? '日を選んでください。' : 'この月は空きがありません。'}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
      {/* 下の操作の帯 (週: 選んだ時間で確かめる / カレンダー: その日の週へ)。
          空きの無い週は帯を出さず、中身の中に次の手を置く。 */}
      {view === 'calendar' || (weekByDate && !weekFailed && weekHasOpen) ? bar : null}
      {/* 帯の分の余白 */}
      <div className="pb-40" aria-hidden="true" />
    </div>
  );
}
