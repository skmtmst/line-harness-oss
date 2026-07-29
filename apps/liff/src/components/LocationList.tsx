import { useEffect, useState } from 'react';
import { api, type LocationItem } from '../lib/api.js';

export default function LocationList({
  initialLocationId,
  onSelect,
}: {
  initialLocationId?: string | null;
  onSelect: (location: LocationItem) => void;
}) {
  const [locations, setLocations] = useState<LocationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.locations()
      .then(({ locations: items }) => {
        setLocations(items);
        const initial = items.find((item) => item.id === initialLocationId);
        if (initial) onSelect(initial);
      })
      .catch((e) => setError(String(e)));
  }, [initialLocationId, onSelect]);

  if (error) return <p className="text-red-600">店舗情報を取得できませんでした。</p>;
  if (!locations) return <p className="text-gray-500">店舗を読み込み中...</p>;

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">店舗を選んでください</h1>
      {locations.length === 0 ? (
        <p className="text-gray-500">現在、予約できる店舗がありません。</p>
      ) : (
        locations.map((location) => (
          <button
            key={location.id}
            onClick={() => onSelect(location)}
            className="w-full text-left border rounded-lg p-4 hover:bg-gray-50"
          >
            <span className="font-semibold">{location.name}</span>
            {location.address && <span className="block mt-1 text-sm text-gray-600">{location.address}</span>}
            {location.access && <span className="block mt-1 text-xs text-gray-500">{location.access}</span>}
          </button>
        ))
      )}
    </div>
  );
}
