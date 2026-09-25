import { LOAD_FAILED_MESSAGE, RETRY_LABEL } from '../lib/user-message.js';

/**
 * 読み込みの失敗の見せ方 (全画面で同じ)。
 * 中立の見た目＋ボタン1つ。赤は使わない。
 */
export default function LoadErrorView({
  message = LOAD_FAILED_MESSAGE,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <p className="text-sm leading-6 text-gray-600">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 w-full rounded-lg border border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 active:bg-gray-100"
      >
        {RETRY_LABEL}
      </button>
    </div>
  );
}
