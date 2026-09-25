import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { jstToday, addDays, formatJp } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from './LoadErrorView.js';
import LoadingView from './LoadingView.js';

export default function DateTimePicker({
  menuId,
  staffId,
  ctaLabel,
  onSelect,
  onBack,
}: {
  menuId: string;
  staffId: string;
  ctaLabel: string;
  onSelect: (s: { date: string; start: string }) => void;
  onBack: () => void;
}) {
  const [from] = useState(jstToday());
  const [to] = useState(addDays(jstToday(), 13));
  const [byDate, setByDate] = useState<Record<string, string[]> | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setFailed(false);
    api
      .availability(menuId, staffId, from, to)
      .then((r) => {
        const slots = r.by_staff[0]?.slots ?? [];
        const grouped: Record<string, string[]> = {};
        for (const s of slots) (grouped[s.date] ??= []).push(s.start);
        setByDate(grouped);
      })
      .catch((e) => {
        logFailure('availability', e);
        setFailed(true);
      });
  }, [menuId, staffId, from, to, reloadKey]);

  if (failed) return <LoadErrorView onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!byDate) return <LoadingView />;

  const dates = Object.keys(byDate);
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-sm text-gray-500">← 戻る</button>
      <h1 className="text-xl font-bold">日時を選んでください</h1>
      <p className="text-xs text-gray-500">{ctaLabel}</p>
      {dates.length === 0 ? (
        <p className="text-gray-500 mt-4">この期間に空きはありません。</p>
      ) : (
        <div className="space-y-4">
          {dates.map((date) => (
            <section key={date}>
              <h2 className="font-semibold mb-2">{formatJp(date)}</h2>
              <div className="grid grid-cols-4 gap-2">
                {byDate[date].map((t) => (
                  <button
                    key={t}
                    onClick={() => onSelect({ date, start: t })}
                    className="border rounded py-2 text-sm hover:bg-gray-50 active:bg-gray-100"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
