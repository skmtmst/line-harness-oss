import liff from '@line/liff';
import LiffLookScope from '../components/LiffLookScope.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import StatusView from '../components/ui/StatusView.js';
import BottomBar from '../components/ui/BottomBar.js';
import Button from '../components/ui/Button.js';

/**
 * ★V8 見つからない画面（板 aLU3r・V8.pen の修正案「採用 2026-10-07 リリース前」）。
 * どの住所にも当たらないときに出す。以前は灰色の文字1行だけで、戻る道が無かった。
 * 上の帯・薄い灰の丸の印（link-2-off）・題・説明2行、下の帯に［LINE に戻る］（主）［閉じる］。
 */
export function closeOrBackToLine(kind: 'line' | 'close'): void {
  if (liff.isInClient()) {
    liff.closeWindow();
    return;
  }
  // LINE の外（ふつうのブラウザ）で開いたとき。LINE に戻るは LINE を開き、閉じるはタブを閉じる。
  if (kind === 'line') window.location.href = 'https://line.me/R/';
  else window.close();
}

export default function NotFound() {
  return (
    <LiffLookScope className="min-h-screen bg-canvas" designNode="aLU3r">
      <LiffHeader title="ご予約" />
      <div className="mx-auto w-full max-w-md px-4 pt-[66px] pb-[142px]">
        <StatusView
          large
          tone="muted"
          icon="link-2-off"
          title="ページが見つかりません"
          body={'リンクがまちがっているか、期限が切れた可能性があります。\nお店からのメッセージのリンクを、もう一度開いてください。'}
        />
      </div>
      <BottomBar>
        <Button variant="primary" onClick={() => closeOrBackToLine('line')}>
          LINE に戻る
        </Button>
        <Button variant="secondary" onClick={() => closeOrBackToLine('close')}>
          閉じる
        </Button>
      </BottomBar>
    </LiffLookScope>
  );
}
