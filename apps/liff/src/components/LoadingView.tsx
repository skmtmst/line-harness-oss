import { LOADING_LABEL } from '../lib/user-message.js';

/**
 * 読み込み中の見せ方 (全画面で同じ)。
 * ★V8 (AcTHQ): 中身の形 (灰色の棒とカードの骨組み) を出す。
 * 回る印と文言だけにしない。文言は読み上げ用に残す (目には出さない)。
 */
export default function LoadingView({ label = LOADING_LABEL }: { label?: string }) {
  return (
    <div
      className="space-y-3"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      data-design-node="AcTHQ"
    >
      <div className="animate-pulse space-y-3.5" aria-hidden="true">
        <div className="h-6 w-1/2 rounded-md bg-liff-chip" />
        <div className="h-3.5 w-4/5 rounded-md bg-liff-chip" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[84px] rounded-[14px] bg-liff-off-bg" />
        ))}
      </div>
    </div>
  );
}
