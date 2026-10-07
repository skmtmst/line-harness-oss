# EC連携の動き（BEHAVIOR.md）

対象：`screen.tsx`（★V8 `GmVR5`、定期便 `wqC8x`・つなぎ先 `iLJmw` は今の部品を差し込む）。
写し元：`app/ec-commerce/page.tsx` の EventsPanel・`ec-tabs-view.tsx`。

## 入口・URL
- `app/ec-commerce/page.tsx`：見た目が v8 のときだけこの画面。v7 は今の画面のまま。
- `?tab=events|subscriptions|connector`（`useMergedTab`）。会員のつき合わせは `/ec-commerce/identity-candidates`。

## 読み込み（API）
- 集計 `GET /api/ec-commerce/overview`、一覧 `GET /api/ec-commerce/events?view=actions`（20件ずつ・`status`/`statusGroup`・`query`・`sort`）。
- 値は取ったアカウントと一体で持ち、切り替えたら同期的に捨てる（#685）。古い応答は世代で捨てる。
- 一覧が取れていない間は状態別の数を出さない（R599）。集計だけの失敗は小さな1行と「集計をもう一度読む」。

## 操作
- 札：すべて／処理完了／処理中／失敗／送信なし（サーバで絞ってからページを切る）。探す言葉は 300ms 遅らせて 1 ページ目へ。並び（新しい順／古い順）。
- 行の「…」：中身を見る（友だち）またはつき合わせる・注文の状況を見る（引き出し）・もう一度やる（409 は読み直し）。
- 数の帯：処理完了・処理中・送信なし・失敗（一覧の集計）。最後に届いた日時・今日取り込んだ数は表の下に小さく。
- 見るだけの人には定期便の「対象を選んで送る」を出さない。つなぎ先の保存口は今の部品が隠す。
