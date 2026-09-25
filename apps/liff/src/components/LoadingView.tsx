import { LOADING_LABEL } from '../lib/user-message.js';

/**
 * 読み込み中の見せ方 (全画面で同じ)。
 * 小さな回る印＋灰色の文字1行。
 */
export default function LoadingView({ label = LOADING_LABEL }: { label?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-20 text-gray-500"
      role="status"
      aria-live="polite"
    >
      <span className="liff-spinner" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
