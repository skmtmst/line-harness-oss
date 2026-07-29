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
        <p className="text-xs text-gray-500 mt-1">step 1 / 5</p>
      </div>
      {locations.length === 0 ? (
        <div className="sb-card text-center text-sm text-gray-500">現在、予約できる店舗がありません</div>
      ) : locations.map((location) => (
        <button
          key={location.id}
          onClick={() => onSelect(location)}
          className="w-full text-left sb-card hover:shadow-md transition-shadow"
        >
          <span className="font-semibold text-gray-900">{location.name}</span>
          {location.address && <span className="block mt-1 text-xs text-gray-600">{location.address}</span>}
          {location.access && <span className="block mt-1 text-xs text-gray-500">{location.access}</span>}
        </button>
      ))}
    </div>
  );
}
