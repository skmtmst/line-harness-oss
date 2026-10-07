# LINE通知の動き（BEHAVIOR.md）

対象：`screen.tsx`（★V8 `g3iDs`。運用者へのお知らせ `u8xibp`・送れなかったもの `DrwMm`・記録 `PZBVb`）。
写し元：`app/line-notifications/page.tsx`・`customer-kpis.ts`。運用者へのお知らせの一覧（`operator-notification-rules.tsx`）は入口から差し込む。

## 入口・URL
- `app/line-notifications/page.tsx`：見た目が v8 のときだけこの画面。`?tab=customer|operator|failures|history`。
- 試験用の `__testing` は今までどおり入口の既定の書き出しに付く。

## 読み込み（API）
- 設定・定義・送った数（`/api/line-notifications/send-counts`）・集計・送信枠・運用者タブの件数。アカウント切替は世代で見張る（N-340/N-341）。
- 送った数だけ取れないときは一覧を残し、その欄だけ「取得失敗」と読み直し。

## 操作
- 札：すべて／出している／止めている／文面が未設定。並びは今日送った数の多い順。
- 出す・止める：確認の窓（#734）を挟んで保存。内容を編集：同じ画面で編集（下書きは端末に控え、保存・公開・テスト送信の確認 #988）。
- 見るだけの人：閲覧のみの帯。出す・止めるのつまみと「内容を編集」は出さない。

## 変えたところ
- 数のカードの題「今日 送った」（前は「今日送った」で、送った数の失敗の注記が当たっていなかった）。
