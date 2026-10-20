import liff from '../lib/liff-runtime.js';
import LiffHeader from './ui/liff-header.js';
import StatusView from './ui/status-view.js';
import BottomBar from './ui/bottom-bar.js';
import Button from './ui/button/index.js';

/** 準備中を表す言葉（管理画面の preparing-dialog と同じ）。 */
export const PREPARING_TITLE = '現在準備中です';

/**
 * お客さまの準備中の画面（★V8 修正案の列 VHp7p `K9HMJp`。決まり  追記・）。
 *
 * リッチメニューなどにボタンはあるのに、お店がまだ中身（決まり）を入れていない機能を押したとき、
 * 壊れた画面や空の画面ではなくこれを出す。上の帯は機能の名前、真ん中に印・題・本文、下の帯に［トークに戻る］。
 *
 * 使い方：`<PreparingView title="来店スタンプ" feature="来店スタンプ" />`
 * （`others` を渡すと「予約やクーポンなど、ほかのメニューはお使いいただけます。」の「予約やクーポン」を差し替える）
 */
export default function PreparingView({ title, feature, others = '予約やクーポン' }: { title: string; feature: string; others?: string | null }) {
  const body = `${feature}は、もうしばらくお待ちください。\n${others ? `${others}など、` : ''}ほかのメニューはお使いいただけます。`;
  return (
    <div className="flex min-h-screen flex-col bg-canvas" data-design-node="K9HMJp">
      <LiffHeader title={title} />
      <main className="flex flex-1 flex-col items-center justify-center px-8 pb-10">
        <StatusView icon="hammer" tone="muted" large title={PREPARING_TITLE} body={body} />
      </main>
      <BottomBar>
        <Button variant="primary" onClick={() => liff.closeWindow()}>トークに戻る</Button>
      </BottomBar>
    </div>
  );
}
