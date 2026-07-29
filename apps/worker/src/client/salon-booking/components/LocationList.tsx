import { useEffect, useState } from 'react';
import { createApi, type LocationItem } from '../lib/api.js';
import { useSalonContext } from '../lib/context.js';

export default function LocationList({
  initialLocationId,
  onSelect,
}: {
  initialLocationId?: string | null;
  onSelect: (location: LocationItem) => void;
}) {
  const ctx = useSalonContext();
  const [locations, setLocations] = useState<LocationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createApi(ctx).locations()
      .then((result) => {
        if (cancelled) return;
        setLocations(result.locations);
        const initial = result.locations.find((item) => item.id === initialLocationId);
        if (initial) onSelect(initial);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [ctx, initialLocationId, onSelect]);

  if (error) {
    return <div className="sb-card text-center text-sm text-red-600">店舗情報の取得に失敗しました</div>;
  }
  if (!locations) {
    return <div className="py-12 text-center text-sm text-gray-500">店舗を読み込み中…</div>;
  }
  return (
    <div className="space-y-4 sb-fade-in">
      <div>
        <h1 className="text-base font-bold text-gray-900">店舗を選んでください</h1>
        <p className="text-xs text-gray-500 mt-1">ご来店する店舗を選択します</p>
      </div>
      {locations.length === 0 ? (
        <div className="sb-card text-center text-sm text-gray-500">現在、予約できる店舗がありません</div>
      ) : (
        <div className="grid gap-3">
          {locations.map((location) => (
            <button
              key={location.id}
              onClick={() => onSelect(location)}
              className="w-full rounded-2xl bg-white px-5 py-5 text-left shadow-sm ring-1 ring-gray-100 transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-base font-bold text-gray-900">{location.name}</span>
                <span className="sb-line-green-text text-xl" aria-hidden>›</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
