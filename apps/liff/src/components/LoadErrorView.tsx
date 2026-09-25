import { LOAD_FAILED_MESSAGE, RETRY_LABEL } from '../lib/user-message.js';
import Icon from './ui/Icon.js';
import Button from './ui/Button.js';

/**
 * 読み込みの失敗の見せ方 (全画面で同じ)。
 * ★V7 (5-b): 灰色の丸の印＋日本語の文＋「もう一度読み込む」1つ。
 * 赤・英語・エラーコードは出さない。くわしい中身は console だけ。
 *
 * 本文は「電波の良いところで、もう一度お試しください。」に、画面ごとの
 * 一言を note で足す (予約の履歴なら「予約はなくなっていません。」)。
 * message を直接渡した画面 (イベント・フォームなど) の動きは変えない。
 */
export default function LoadErrorView({
  message,
  note,
  onRetry,
}: {
  message?: string;
  note?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span
        className="flex h-16 w-16 items-center justify-center rounded-full bg-state-mark text-ink-faint"
        aria-hidden="true"
      >
        <Icon name="cloud-off" className="h-7 w-7" />
      </span>
      <p className="mt-4 text-base font-bold text-ink">読み込めませんでした</p>
      <p className="mt-2 text-sm leading-6 text-balance text-ink-secondary">
        {message ?? LOAD_FAILED_MESSAGE}
        {!message && note && (
          <>
            <br />
            {note}
          </>
        )}
      </p>
      <div className="mt-6 w-full max-w-60">
        <Button variant="secondary" onClick={onRetry}>
          <Icon name="rotate-cw" className="h-4 w-4" />
          {RETRY_LABEL}
        </Button>
      </div>
    </div>
  );
}
