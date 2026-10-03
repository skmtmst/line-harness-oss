import { LOAD_FAILED_MESSAGE, RETRY_LABEL } from '../lib/user-message.js';
import Icon from './ui/Icon.js';
import Button from './ui/Button.js';

/**
 * 読み込みの失敗の見せ方 (全画面で同じ)。
 * ★V8 (zz9R3): 切れた電波の印＋日本語の文＋主ボタン「もう一度読み込む」1つ。
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
    <div className="flex flex-col items-center px-6 py-16 text-center" data-design-node="zz9R3">
      <span className="text-liff-idle" aria-hidden="true">
        <Icon name="wifi-off" className="h-10 w-10" />
      </span>
      <p
        className="mt-4 text-lg font-bold text-[var(--liff-look-ink)]"
        style={{ fontFamily: 'var(--liff-look-font-heading)' }}
      >
        読み込めませんでした
      </p>
      <p className="mt-2 text-[13px] leading-6 text-pretty text-[var(--liff-look-sub)]">
        {message ?? LOAD_FAILED_MESSAGE}
        {!message && note && (
          <>
            <br />
            {note}
          </>
        )}
      </p>
      <div className="mt-6 w-full max-w-55">
        <Button variant="primary" onClick={onRetry}>
          {RETRY_LABEL}
        </Button>
      </div>
    </div>
  );
}
