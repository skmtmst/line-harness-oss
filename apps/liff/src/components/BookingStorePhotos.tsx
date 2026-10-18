import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Button from './ui/Button.js';

const labels = { exterior: '外観', interior: '店内', waiting: '待合' };
type Photo = { slot: keyof typeof labels; url: string };

/** 写真は任意。取得失敗を「写真なし」にせず、予約の入力を残して読み直せる。 */
export default function BookingStorePhotos() {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    api.storePhotos().then(rows => { if (alive) setPhotos(rows); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [revision]);
  if (failed) return <section aria-label="お店の案内" className="space-y-3">
    <p role="alert" className="text-sm text-liff-sub">お店の写真を読み込めませんでした。</p>
    <Button variant="secondary" onClick={() => setRevision(value => value + 1)}>写真を読み直す</Button>
  </section>;
  if (!photos?.length) return null;
  return <details className="space-y-3">
    <summary className="cursor-pointer text-sm font-bold text-ink">お店の案内</summary>
    <div className="space-y-3">
      {photos.map(photo => <figure key={photo.slot} className="space-y-1.5">
        <img src={photo.url} alt={`お店の${labels[photo.slot]}`} loading="lazy" className="aspect-video w-full rounded-[10px] object-cover" />
        <figcaption className="text-xs text-liff-sub">{labels[photo.slot]}</figcaption>
      </figure>)}
    </div>
  </details>;
}
