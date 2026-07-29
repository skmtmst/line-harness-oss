import { useEffect, useMemo, useState } from 'react';
import { createApi } from '../lib/api.js';
import { useSalonContext } from '../lib/context.js';
import { jstToday, addDays, formatJp } from '../lib/datetime.js';
import WeekCalendar from './WeekCalendar.js';

const RANGE_DAYS = 14; // API は 14 日まで取得

interface DateTimePickerProps {
  locationId: string;
  menuId: string;
  staffId: string;
  ctaLabel: string;
  onSelect: (s: { date: string; start: string }) => void;
  onBack: () => void;
  selected?: { date: string; start: string } | null;
  calendarView: 'week' | 'month';
}

export default function DateTimePicker(props: DateTimePickerProps) {
  return props.calendarView === 'month'
    ? <MonthDateTimePicker {...props} />
    : <WeekDateTimePicker {...props} />;
}

function WeekDateTimePicker({
  locationId,
  menuId,
  staffId,
  ctaLabel,
  onSelect,
  onBack,
  selected,
}: DateTimePickerProps) {
  const ctx = useSalonContext();
  const today = useMemo(() => jstToday(), []);
  const from = today;
  const to = addDays(today, RANGE_DAYS - 1);
  const maxOffset = Math.floor((RANGE_DAYS - 1) / 7);
  const [byDate, setByDate] = useState<Record<string, string[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = 今日始まり, 1 = +7 日

  useEffect(() => {
    setError(null);
    createApi(ctx)
      .availability(locationId, menuId, staffId, from, to)
      .then((r) => {
        const slots = r.by_staff[0]?.slots ?? [];
        const grouped: Record<string, string[]> = {};
        for (const s of slots) (grouped[s.date] ??= []).push(s.start);
        setByDate(grouped);
        // 確認画面 → 戻る で再 mount されたとき、選択済みの slot を含む週を
        // 優先して復元する。これがないと 2 週目の選択が画面外に隠れる。
        if (selected) {
          for (let off = 0; off <= maxOffset; off++) {
            const ws = addDays(today, off * 7);
            for (let i = 0; i < 7; i++) {
              if (addDays(ws, i) === selected.date) {
                setWeekOffset(off);
                return;
              }
            }
          }
        }
        // 未選択時: 空きが今週ゼロ・来週にしか無いケースで離脱されないよう、
        // 最初に空きがある週まで自動で進めておく。
        for (let off = 0; off <= maxOffset; off++) {
          const ws = addDays(today, off * 7);
          let has = false;
          for (let i = 0; i < 7; i++) {
            if ((grouped[addDays(ws, i)] ?? []).length > 0) {
              has = true;
              break;
            }
          }
          if (has) {
            setWeekOffset(off);
            break;
          }
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // selected は初回 mount 時の値だけ使う（毎回再マウント前提）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, locationId, menuId, staffId, from, to, today, maxOffset]);

  if (error) {
    return (
      <div className="space-y-5 sb-fade-in">
        <BackButton onBack={onBack} />
        <div className="sb-card text-center">
          <p className="text-red-600 text-sm mb-2">空き枠の取得に失敗しました</p>
          <p className="text-gray-500 text-xs">{error}</p>
        </div>
      </div>
    );
  }
  if (!byDate) {
    return (
      <div className="space-y-5 sb-fade-in">
        <BackButton onBack={onBack} />
        <div className="flex flex-col items-center py-12">
          <div className="sb-spinner" />
          <p className="text-sm text-gray-500 mt-3">空き枠を取得中…</p>
        </div>
      </div>
    );
  }

  const weekStart = addDays(today, weekOffset * 7);
  const weekEnd = addDays(weekStart, 6);

  return (
    <div className="space-y-5 sb-fade-in">
      <BackButton onBack={onBack} />
      <div>
        <h1 className="text-base font-bold text-gray-900">日時を選んでください</h1>
        <p className="text-xs text-gray-500 mt-1">{ctaLabel}</p>
      </div>

      {/* 週ナビゲーション */}
      <div className="flex items-center justify-between text-sm">
        <button
          onClick={() => setWeekOffset(Math.max(0, weekOffset - 1))}
          disabled={weekOffset === 0}
          className="px-3 py-1.5 text-xs rounded-lg disabled:opacity-30"
          style={{ background: '#f3f4f6', color: '#374151' }}
        >
          ← 前週
        </button>
        <span className="text-xs text-gray-600 tabular-nums">
          {formatJp(weekStart)} 〜 {formatJp(weekEnd)}
        </span>
        <button
          onClick={() => setWeekOffset(Math.min(maxOffset, weekOffset + 1))}
          disabled={weekOffset >= maxOffset}
          className="px-3 py-1.5 text-xs rounded-lg disabled:opacity-30"
          style={{ background: '#f3f4f6', color: '#374151' }}
        >
          次週 →
        </button>
      </div>

      <WeekCalendar
        byDate={byDate}
        weekStart={weekStart}
        onPick={onSelect}
        selectedDate={selected?.date}
        selectedStart={selected?.start}
      />

      <p className="text-[11px] text-gray-400 text-center pt-1">
        緑のセルをタップして時間を選択
      </p>
    </div>
  );
}

function MonthDateTimePicker({
  locationId,
  menuId,
  staffId,
  ctaLabel,
  onSelect,
  onBack,
  selected,
}: DateTimePickerProps) {
  const ctx = useSalonContext();
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(selected?.date ?? '');
  const [byDate, setByDate] = useState<Record<string, string[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const month = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  }, [monthOffset]);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const from = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const to = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  useEffect(() => {
    setByDate(null);
    setError(null);
    createApi(ctx)
      .availability(locationId, menuId, staffId, from, to)
      .then((response) => {
        const grouped: Record<string, string[]> = {};
        for (const slot of response.by_staff[0]?.slots ?? []) {
          (grouped[slot.date] ??= []).push(slot.start);
        }
        setByDate(grouped);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [ctx, locationId, menuId, staffId, from, to]);

  if (error) {
    return <div className="space-y-5"><BackButton onBack={onBack} /><div className="sb-card text-center text-sm text-red-600">空き枠の取得に失敗しました</div></div>;
  }
  if (!byDate) {
    return <div className="space-y-5"><BackButton onBack={onBack} /><div className="flex flex-col items-center py-12"><div className="sb-spinner" /><p className="mt-3 text-sm text-gray-500">空き枠を取得中…</p></div></div>;
  }
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const blanks = new Date(year, monthIndex, 1).getDay();
  const today = jstToday();
  const selectedTimes = selectedDate ? byDate[selectedDate] ?? [] : [];

  return (
    <div className="space-y-5 sb-fade-in">
      <BackButton onBack={onBack} />
      <div><h1 className="text-base font-bold text-gray-900">日時を選んでください</h1><p className="mt-1 text-xs text-gray-500">{ctaLabel}</p></div>
      <div className="flex items-center justify-between">
        <button type="button" disabled={monthOffset === 0} onClick={() => setMonthOffset(Math.max(0, monthOffset - 1))} className="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-30">← 前月</button>
        <strong className="text-sm text-slate-800">{year}年{monthIndex + 1}月</strong>
        <button type="button" disabled={monthOffset >= 2} onClick={() => setMonthOffset(Math.min(2, monthOffset + 1))} className="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-30">次月 →</button>
      </div>
      <div className="grid grid-cols-7 gap-1 rounded-xl border border-gray-200 bg-white p-2">
        {weekdays.map((weekday, index) => <div key={weekday} className={`py-1 text-center text-[10px] font-bold ${index === 0 ? 'text-red-400' : index === 6 ? 'text-sky-500' : 'text-gray-400'}`}>{weekday}</div>)}
        {Array.from({ length: blanks }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: lastDay }, (_, index) => {
          const day = index + 1;
          const date = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const count = (byDate[date] ?? []).length;
          const active = date >= today && count > 0;
          const picked = selectedDate === date;
          return (
            <button
              key={date}
              type="button"
              disabled={!active}
              onClick={() => setSelectedDate(date)}
              className="min-h-12 rounded-lg border text-center disabled:bg-gray-50 disabled:text-gray-300"
              style={picked ? { borderColor: '#2f9e1d', background: '#ecfdf3', color: '#247817' } : undefined}
            >
              <span className="block text-xs font-semibold">{day}</span>
              {active && <span className="mt-0.5 block text-[9px] text-green-600">○ {count}</span>}
            </button>
          );
        })}
      </div>
      {selectedDate && (
        <div className="sb-card">
          <h2 className="mb-3 text-sm font-bold text-slate-800">{formatJp(selectedDate)}の空き時間</h2>
          {selectedTimes.length === 0 ? <p className="text-xs text-gray-500">選択できる時間はありません。</p> : (
            <div className="grid grid-cols-3 gap-2">
              {selectedTimes.map((start) => (
                <button
                  key={start}
                  type="button"
                  onClick={() => onSelect({ date: selectedDate, start })}
                  className="rounded-lg border border-green-300 px-2 py-2.5 text-sm font-bold text-green-700"
                  style={selected?.date === selectedDate && selected.start === start ? { background: '#2f9e1d', color: '#fff' } : undefined}
                >
                  {start}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="sb-back-btn">
      <span aria-hidden>←</span>
      戻る
    </button>
  );
}
