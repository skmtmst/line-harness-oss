import { LOADING_LABEL } from '../lib/user-message.js';

/**
 * 読み込み中の見せ方 (全画面で同じ)。
 * ★V7: 中身の形 (灰色の四角と線) を出す。回る印と文言だけにしない。
 * 文言は読み上げ用に残す (目には出さない)。
 */
export default function LoadingView({ label = LOADING_LABEL }: { label?: string }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex animate-pulse gap-3 rounded-xl border border-hairline bg-canvas p-4"
          aria-hidden="true"
        >
          <div className="h-12 w-12 shrink-0 rounded-lg bg-skeleton" />
          <div className="flex flex-1 flex-col justify-center gap-2">
            <div className="h-3 w-2/5 rounded bg-skeleton" />
            <div className="h-3 w-4/5 rounded bg-skeleton" />
          </div>
        </div>
      ))}
    </div>
  );
}
