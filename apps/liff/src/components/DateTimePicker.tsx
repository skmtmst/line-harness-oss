import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { jstToday, addDays, formatJp, formatMd, formatWeekday } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from './LoadErrorView.js';
import LoadingView from './LoadingView.js';
import Icon from './ui/Icon.js';

export type SlotPick = { date: string; start: string };

/** 日時を選ぶ段の見せ方。'list' がいまの形（日付の札＋時刻3列）。 */
export type DateView = 'list' | 'calendar';

const VIEW_STORAGE_KEY = 'liff-booking-date-view';
/** リストは今日＋13日（いまのまま変えない）。 */
const LIST_DAYS = 13;
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

/**
 * 空き読み出しのまとめ役（リスト・カレンダー共通）。
 * 月をまたいで28日ずつに割って読むと、同じ日の同じ枠が二重に入ることが
 * ある（口が期間を広めに返す・同じ枠を二口が返す）。同じ枠（担当＋開始
 * 時刻）は1つにまとめる。埋まった枠（残り0）は時刻には出さず、「満」の
 * 判定だけに使う。
 */
function groupSlots(
  buckets: Array<{ staff_id: string; slots: AvailSlot[] }>,
): { byDate: Record<string, string[]>; fullDates: Record<string, true> } {
  const seen = new Set<string>();
  const byDate: Record<string, string[]> = {};
  const hasSlot: Record<string, true> = {};
  for (const bucket of buckets) {
    for (const s of bucket.slots ?? []) {
      hasSlot[s.date] = true;
      if ((s.remaining ?? 1) <= 0 || s.state === 'full' || s.state === 'closed') continue;
      const key = `${bucket.staff_id}\0${s.date}\0${s.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (byDate[s.date] ??= []).push(s.start);
    }
  }
  const fullDates: Record<string, true> = {};
  for (const d of Object.keys(hasSlot)) {
    if ((byDate[d]?.length ?? 0) === 0) fullDates[d] = true;
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
  byDate: Record<string, string[]>,
  today: string,
  windowEnd: string,
): string[] {
  const from = monthStart(target) < today ? today : monthStart(target);
  const to = monthEnd(target) > windowEnd ? windowEnd : monthEnd(target);
  return Object.keys(byDate)
    .filter((d) => d >= from && d <= to && (byDate[d]?.length ?? 0) > 0)
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

/** 選んだ日の時刻3列。リストとカレンダーで同じ部品を使い回す。 */
function DaySlots({
  day,
  times,
  selected,
  onSelect,
}: {
  day: string;
  times: string[];
  selected: SlotPick | null;
  onSelect: (s: SlotPick) => void;
}) {
  return (
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
  );
}

/**
 * 1-c 日時を選ぶ。手順の下に「リスト｜カレンダー」の切り替えがある。
 * リストは日付の横並び札（空きが無い日は「満席」）＋選んだ日の時刻3列。
 * カレンダーは月の表（●空きあり／満／休／枠なしは印なしの空きなし）＋選んだ日の時刻3列（同じ部品）。
 * 時刻の札を押すと選ばれるだけで、進むのは下の操作の帯。
 * (撮影: 時刻のボタン名は「10:00」のまま。qa-shots.mjs が名前で押す)
 */
export default function DateTimePicker({
  menuId,
  staffId,
  hint,
  selected,
  onSelect,
  onLoadState,
}: {
  menuId: string;
  staffId: string;
  hint?: string;
  selected: SlotPick | null;
  onSelect: (s: SlotPick) => void;
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

  // リスト用（いまのまま）。
  const [listFrom] = useState(today);
  const [listTo] = useState(addDays(today, LIST_DAYS));
  const [listByDate, setListByDate] = useState<Record<string, string[]> | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [listReloadKey, setListReloadKey] = useState(0);
  const [listDay, setListDay] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // カレンダー用。月を送っても読んだぶんは足していく。
  const [calByDate, setCalByDate] = useState<Record<string, string[]>>({});
  const [calClosed, setCalClosed] = useState<Record<string, true>>({});
  // 枠があって全部埋まった日（「満」の印を付ける日）。
  const [calFull, setCalFull] = useState<Record<string, true>>({});
  const [loadedMonths, setLoadedMonths] = useState<string[]>([]);
  const loadingMonthsRef = useRef<Set<string>>(new Set());
  const [month, setMonth] = useState(monthOf(today));
  const [calDay, setCalDay] = useState<string | null>(null);
  const [calFailed, setCalFailed] = useState(false);
  const [calReloadKey, setCalReloadKey] = useState(0);
  // 最初に開く月の探索が済んだか。済むまでは空きの無い月を飛ばす。
  const [calAutoDone, setCalAutoDone] = useState(false);
  // 利用者が一度でも日を選んだら、遅れて届く応答の自動選択で上書きしない
  // (リスト・カレンダー共通。月を送った後の選び直しもしない。
  // 担当が変わると呼び側の key で作り直されるので、画面の中では消さない。
  // 読み直しだけ最初から探し直す)。
  const userPickedDayRef = useRef(false);

  // 最初の形は「端末の覚え → 管理画面の設定 → リスト」の順。設定が読めなくても止めない。
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

  useEffect(() => {
    if (view !== 'list') return;
    setListFailed(false);
    api
      .availability(menuId, staffId, listFrom, listTo)
      .then((r) => {
        const grouped = groupSlots(r.by_staff[0] ? [r.by_staff[0]] : []).byDate;
        setListByDate(grouped);
        setListDay((prev) => {
          // 利用者が選んだ日は、遅れて届く応答で選び直さない。
          if (userPickedDayRef.current) return prev;
          return prev && grouped[prev] ? prev : Object.keys(grouped)[0] ?? null;
        });
      })
      .catch((e) => {
        logFailure('availability', e);
        setListFailed(true);
      });
  }, [menuId, staffId, listFrom, listTo, listReloadKey, view]);

  const windowEnd = settings ? addDays(today, settings.windowDays) : addDays(today, 60);

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
      splitRange(from, to).map(([head, tail]) => api.availability(menuId, staffId, head, tail)),
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
  }, [view, settings, month, menuId, staffId, today, windowEnd, loadedMonths, calReloadKey]);

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

  const listHasSlots =
    listByDate !== null && Object.values(listByDate).some((times) => times.length > 0);
  const calHasSlots = Object.values(calByDate).some((times) => times.length > 0);
  const monthLoaded = loadedMonths.includes(month);
  useEffect(() => {
    if (view === 'list') onLoadState?.(listByDate !== null && !listFailed && listHasSlots);
    else if (view === 'calendar')
      onLoadState?.(settings !== null && monthLoaded && !calFailed && calHasSlots);
    else onLoadState?.(false);
  }, [view, settings, listByDate, listFailed, listHasSlots, monthLoaded, calFailed, calHasSlots, onLoadState]);

  // 選んでいる日が枠の外にいるときは、横だけ中央に流す (縦には動かさない)。
  useEffect(() => {
    stripRef.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [listDay, listByDate]);

  function switchView(next: DateView) {
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

  if (!settings || view === null) return <LoadingView />;

  const currentMonth = monthOf(today);
  const lastMonth = monthOf(windowEnd);
  const canPrev = month > currentMonth;
  const canNext = month < lastMonth;

  // カレンダーの升目。月初の曜日ぶんを空けて、日〜土で7列にする。
  const firstWeekday = new Date(`${monthStart(month)}T00:00:00Z`).getUTCDay();
  const monthDays: string[] = [];
  for (let d = monthStart(month); d <= monthEnd(month); d = addDays(d, 1)) monthDays.push(d);

  function calendarState(date: string): DayState {
    if (date < today) return 'past';
    if (date > windowEnd) return 'off';
    if (calClosed[date]) return 'closed';
    if ((calByDate[date]?.length ?? 0) > 0) return 'open';
    // 「満」は枠があって全部埋まった日だけ。枠が1つも無い日は印なしの「空きなし」。
    if (calFull[date]) return 'full';
    return 'empty';
  }

  const monthLabel = `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;
  const calTimes = calDay ? (calByDate[calDay] ?? []) : [];
  const monthHasOpen = monthDays.some((d) => (calByDate[d]?.length ?? 0) > 0);

  const listDays: string[] = [];
  for (let d = listFrom; d <= listTo; d = addDays(d, 1)) listDays.push(d);
  const listTimes = listDay ? (listByDate?.[listDay] ?? []) : [];

  const toggleButton = (target: DateView, label: string, icon: 'list' | 'calendar-days') => {
    const active = view === target;
    return (
      <button
        key={target}
        ref={target === 'list' ? listButtonRef : calendarButtonRef}
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => switchView(target)}
        className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-1 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ink ${
          active
            ? 'border-accent-deep bg-ok-bg font-bold text-accent-deep'
            : 'border-transparent bg-canvas text-ink-secondary'
        }`}
      >
        <Icon name={icon} className="h-5 w-5" />
        {label}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-ink">日時を選んでください</h2>
      {hint && <p className="text-xs leading-5 text-ink-secondary">{hint}</p>}
      <div
        role="radiogroup"
        aria-label="表示の切り替え"
        onKeyDown={moveViewKey}
        className="flex gap-1 rounded-xl border border-hairline bg-canvas p-1"
      >
        {toggleButton('list', 'リスト', 'list')}
        {toggleButton('calendar', 'カレンダー', 'calendar-days')}
      </div>

      {view === 'list' ? (
        listFailed ? (
          <LoadErrorView onRetry={() => setListReloadKey((k) => k + 1)} />
        ) : !listByDate ? (
          <LoadingView />
        ) : listDays.every((d) => !(listByDate[d]?.length)) ? (
          <p className="text-sm leading-6 text-ink-secondary">この期間に空きはありません。</p>
        ) : (
          <>
            <div ref={stripRef} className="-mx-4 overflow-x-auto px-4" role="group" aria-label="日付">
              <div className="flex gap-2 pb-1">
                {listDays.map((d) => {
                  const open = (listByDate[d]?.length ?? 0) > 0;
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
                      className={`flex min-h-16 w-15 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-100 ${
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
          <div className="rounded-xl border border-hairline bg-canvas p-3">
            <div aria-label="月をえらぶ" className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMonth(addMonths(month, -1))}
                disabled={!canPrev}
                aria-label="前の月"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:text-ink-faint disabled:opacity-60"
              >
                <Icon name="chevron-left" className="h-5 w-5" />
              </button>
              <p aria-live="polite" className="text-base font-bold text-ink">
                {monthLabel}
              </p>
              <button
                type="button"
                onClick={() => setMonth(addMonths(month, 1))}
                disabled={!canNext}
                aria-label="次の月"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:text-ink-faint disabled:opacity-60"
              >
                <Icon name="chevron-right" className="h-5 w-5" />
              </button>
            </div>
            {!monthLoaded ? (
              <LoadingView />
            ) : (
              <>
                <div className="grid grid-cols-7 gap-1 text-center" aria-label={`${monthLabel}の日付`}>
                  {WEEKDAY_JP.split('').map((w, i) => (
                    <span
                      key={w}
                      className={`py-1 text-xs ${i === 0 ? 'text-danger' : i === 6 ? 'text-info-link' : 'text-ink-secondary'}`}
                    >
                      {w}
                    </span>
                  ))}
                  {Array.from({ length: firstWeekday }).map((_, i) => (
                    <span key={`pad-${i}`} aria-hidden="true" />
                  ))}
                  {monthDays.map((d) => {
                    const state = calendarState(d);
                    const dayNum = Number(d.slice(8, 10));
                    const selectable = state === 'open';
                    const active = d === calDay;
                    // 設計どおり枠なしのます目にする。高さは h-10（40px。375px幅で
                    // 1ます≈42pxなので幅以下に収まる）。塗るのは選んだ日だけ。
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
                        className={`flex h-10 flex-col items-center justify-center rounded-lg text-sm focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-100 ${
                          active
                            ? 'bg-accent-deep font-bold text-white'
                            : selectable
                              ? 'text-ink'
                              : 'text-ink-faint'
                        }`}
                      >
                        <span className="font-bold leading-tight">{dayNum}</span>
                        <span className="flex h-3 items-center text-[10px] leading-none">
                          {state === 'open' ? (
                            <span className={active ? 'text-white' : 'text-accent-deep'}>●</span>
                          ) : state === 'full' ? (
                            '満'
                          ) : state === 'closed' ? (
                            '休'
                          ) : (
                            ' '
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
                  <span>
                    <span className="text-accent-deep">●</span> 空きあり
                  </span>
                  <span>満 満席</span>
                  <span>休 お休み</span>
                </p>
              </>
            )}
          </div>
          {monthLoaded && calDay && (
            <DaySlots day={calDay} times={calTimes} selected={selected} onSelect={onSelect} />
          )}
          {monthLoaded && !calDay && (
            <p className="text-sm leading-6 text-ink-secondary">
              {monthHasOpen ? '日を選んでください。' : 'この月は空きがありません。'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
