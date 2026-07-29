import { useCallback, useEffect, useState } from 'react';
import { createApi, type BookingHistoryItem } from '../lib/api.js';
import { useSalonContext } from '../lib/context.js';
import HistoryCard from '../components/HistoryCard.js';

export default function BookingHistory({ onBook }: { onBook: () => void }) {
  const ctx = useSalonContext();
  const [data, setData] = useState<{ upcoming: BookingHistoryItem[]; past: BookingHistoryItem[] } | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await createApi(ctx).me());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [ctx]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancelBooking(booking: BookingHistoryItem) {
    try {
      await createApi(ctx).cancel(booking.id);
      await load();
    } catch (e) {
      const err = e as { status?: number; body?: { error?: string } };
      if (err.status === 409) {
        window.alert('予約の状態が更新されたため、キャンセルできませんでした。画面を再読み込みします。');
        await load();
      } else {
        window.alert('キャンセル処理に失敗しました。時間をおいて再度お試しください。');
      }
    }
  }

  function rebook(booking: BookingHistoryItem) {
    if (!booking.location_id || !booking.menu_id) {
      onBook();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    url.searchParams.set('location_id', booking.location_id);
    url.searchParams.set('menu_id', booking.menu_id);
    window.location.href = url.toString();
  }

  if (error) {
    return (
      <div className="sb-card text-center">
        <p className="mb-2 text-sm text-red-600">予約履歴の取得に失敗しました</p>
        <button onClick={() => void load()} className="sb-outline-btn">再読み込み</button>
      </div>
    );
  }
  if (!data) {
    return <div className="flex flex-col items-center py-12"><div className="sb-spinner" /><p className="mt-3 text-sm text-gray-500">読み込み中…</p></div>;
  }
  const list = tab === 'upcoming' ? data.upcoming : data.past;

  return (
    <div className="space-y-4 sb-fade-in">
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <Tab active={tab === 'upcoming'} onClick={() => setTab('upcoming')}>これから ({data.upcoming.length})</Tab>
        <Tab active={tab === 'past'} onClick={() => setTab('past')}>履歴 ({data.past.length})</Tab>
      </div>

      {list.length === 0 ? (
        <div className="sb-card py-10 text-center">
          <p className="text-sm text-gray-500">{tab === 'upcoming' ? 'これからの予約はありません' : '予約履歴はありません'}</p>
          <button onClick={onBook} className="sb-primary-btn mt-5">予約する</button>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((booking) => (
            <HistoryCard key={booking.id} booking={booking} onCancel={cancelBooking} onRebook={rebook} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="py-3 text-sm font-bold"
      style={{ background: active ? '#2f9e1d' : '#fff', color: active ? '#fff' : '#6b7280' }}
    >
      {children}
    </button>
  );
}
