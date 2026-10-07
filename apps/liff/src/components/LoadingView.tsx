import { useEffect, useState } from 'react';
import { LOADING_LABEL } from '../lib/user-message.js';

/**
 * 読み込み中の見せ方 (全画面で同じ)。
 * ★V8 (AcTHQ): 中身の形 (灰色の棒とカードの骨組み) を出す。
 * 回る印と文言だけにしない。文言は読み上げ用に残す (目には出さない)。
 * ★A: 明滅ではなく左から右へ流れる光。0.3秒以内に読めたら出さない。
 */
export default function LoadingView({ label = LOADING_LABEL }: { label?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(timer);
  }, []);
  if (!show) {
    return <div role="status" aria-live="polite" aria-busy="true" aria-label={label} className="sr-only" />;
  }
  return (
    <div
      className="space-y-3"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      data-design-node="AcTHQ"
    >
      <div className="space-y-3.5" aria-hidden="true">
        <div className="liff-shimmer-bone h-6 w-full rounded-md bg-liff-chip" />
        <div className="liff-shimmer-bone h-3.5 w-50 max-w-full rounded-md bg-liff-chip" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="liff-shimmer-bone h-[84px] rounded-[14px] bg-liff-off-bg" />
        ))}
      </div>
    </div>
  );
}
