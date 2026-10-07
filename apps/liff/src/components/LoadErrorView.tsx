import { LOAD_FAILED_MESSAGE, RETRY_LABEL } from '../lib/user-message.js';
import Icon from './ui/Icon.js';
import Button from './ui/Button.js';

/**
 * 読み込みの失敗の見せ方 (全画面で同じ)。
 * ★V8 (zz9R3): 切れた電波の印＋日本語の文＋主ボタン「もう一度読み込む」1つ。
 * 赤・英語・エラーコードは出さない。くわしい中身は console だけ。
 *
 * 本文は「電波のよいところで、もう一度お試しください。」に、画面ごとの
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
    // ★V8 (zz9R3)：上の帯の下の残りの真ん中に、印・題・本文・ボタンを 12 ずつ空けて置く。
    // 本文の上下の余白 (pt-3・pb-3) を引いた高さにして、ちょうど画面に収める。
    <div
      className="flex min-h-[calc(100dvh-var(--liff-header-h)-1px-1.5rem)] flex-col items-center justify-center gap-3 px-6 text-center"
      data-design-node="zz9R3"
    >
      <span className="text-liff-idle" aria-hidden="true">
        <Icon name="wifi-off" className="h-10 w-10" />
      </span>
      <p className="text-lg font-bold text-ink">読み込めませんでした</p>
      <p className="text-[13px] text-pretty text-liff-sub">
        {message ?? LOAD_FAILED_MESSAGE}
        {!message && note && (
          <>
            <br />
            {note}
          </>
        )}
      </p>
      <div className="w-full max-w-50">
        <Button variant="primary" onClick={onRetry}>
          {RETRY_LABEL}
        </Button>
      </div>
    </div>
  );
}
