# 受信箱 V4 の細部調整 — design QA

## 比較対象

- 参照デザイン: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/inbox-visual-polish/hSLxG.png`
- 実装（1440px）: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/inbox-visual-polish/inbox-visual-polish-1440.png`
- 内部メモ画面: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/inbox-visual-polish/inbox-memo-modal-1440.png`
- メール顧客情報（1920px）: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/inbox-visual-polish/inbox-email-1920.png`
- 同一画面での比較: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/inbox-visual-polish/inbox-side-by-side.png`
- 状態: ローカルの確認用データだけを使用。開発・本番データは変更していない。

## 表示条件

- 参照デザイン: 3840 × 3680 px。
- 実装確認: 1440 × 1000 px と 1920 × 1080 px。
- 1440px は `scrollWidth === clientWidth === 1425`、1920px は `scrollWidth === clientWidth === 1905`。ページ全体の横スクロールなし。
- 参照と実装を同じ比較画面に配置し、文字、余白、操作位置、3ペインの比率、モーダル背景を目視確認した。

## 確認結果

- P0 / P1 / P2 の未解決差分なし。
- LINE と MAIL の4文字バッジ、ラベル、並び順が狭い一覧幅でも途中改行しない。
- 「すべて確認済みにする」は表示されない。
- 送信元LINEアカウントと実際の担当者を分けて表示する。
- LINE顧客情報は会話IDではなく友だちIDで読み込み、中央には閉じる操作を重複表示しない。
- メールでも顧客情報を開閉できる。閉じた後は中央の「顧客情報を開く」だけが表示される。
- 内部メモは送信欄とは別の中央ポップアップで開き、「担当者だけに表示され、相手には送信されません」と明示する。
- 内部メモとテンプレート選択のどちらも `document.body` 直下へ表示し、顧客情報の「閉じる」を含む背景全体に同じブラインドがかかる。
- 集計APIの一部項目が欠けても受信箱全体が停止しない。

## 操作確認

1. LINE会話を開き、顧客情報、マイル、対応、タグを表示できた。
2. 右側の「閉じる」で顧客情報を閉じ、中央の「顧客情報を開く」から再表示できた。
3. 「内部メモ」で専用ポップアップを開き、既存メモが別のテキスト欄へ入ることを確認した。
4. 「テンプレートを選択」を開き、右側の顧客情報操作も背景と一緒に暗くなることを確認した。
5. メール会話を開き、顧客情報を右側へ表示し、同じ開閉動作を確認した。
6. 最終タブのブラウザログにエラー・警告なし。

## 比較履歴

1. 初回確認では、チャネル行の短い文字が1440pxで折り返し、顧客情報が会話IDを友だちIDとして読み込んで画面が停止した。
2. チャネル操作を縮まない1行表示へ直し、選択中会話の `friendId` を使うよう修正した。
3. 再比較で、参照デザインと同じ情報階層、メモの独立性、モーダル背景、横幅の収まりを確認した。

final result: passed

---

# Design QA — 受信箱・友だち V4

## 比較対象

- Pencil V4 友だち一覧: `/private/tmp/pencil-v4-friends/Wi50h.png`（1920×1080）
- Pencil V4 詳細検索: `/private/tmp/pencil-v4-friends/EoHvu.png`（1920×1080）
- 受信箱の参照画像: `/var/folders/6v/dqgxy7ts2b12xlw5764btjc40000gn/T/codex-clipboard-8366b2e8-8ac8-4f10-b7f7-ce6a7b4c6bca.png`（1039×530）
- 実装: `http://localhost:3012/friends` と `http://localhost:3012/chats`
- 同一比較画面: `http://127.0.0.1:4020/`

## 確認条件

- 友だち一覧: 1440×900、1920×1080
- 受信箱: 1144×900
- 状態: 一覧、詳細検索モーダル、重複検出、統合ユーザー、統合ユーザー詳細、友だち詳細、メール内部メモ
- 文字密度、余白、枠線、角丸、影、中央揃え、モーダルの重なり、横スクロールを確認

## 修正と再確認

1. 友だち一覧の上部一括アクション、操作列、開くリンクを削除した。
2. 件数と表示件数を一覧見出しの右側へ移し、最終接触と行内容を中央にそろえた。
3. 詳細検索をV4のAND/OR構造、件数表示、下部操作へそろえた。
4. 重複検出、統合ユーザー、展開した統合ユーザー詳細をV4の表密度と色へそろえた。
5. 受信箱のKPI見出しを1行固定にし、担当者プルダウンとメール内部メモの独立モーダルを確認した。
6. 友だち詳細に残っていた「すべて確認済みにする」を削除し、再表示で非表示を確認した。

## 最終判定

- 1440px・1920pxとも主要領域の横スクロールなし。
- V4参照との差は、利用者の明示指定で削除した操作列のみ。
- 主要操作とモーダルは実画面で動作確認済み。

final result: passed

---

# Design QA — 受信箱のチャネルバッジ

## 比較対象

- 参照画像: `/Users/kentakenta/Pictures/Zappy/Screen Shot 2026-08-21 at 12.36.45 PM.png`（1121×853 px）
- 実装画像: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/inbox-channel-icons-1120.png`（676×1031 px）
- 同一画面での重点比較: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/inbox-channel-icons-comparison.png`（1254×247 px）
- 状態: 受信箱の「すべて」選択時。LINE・MAILのチャネル絞り込みが表示されている状態。

## 比較条件

- 参照はデスクトップ幅、実装はアプリ内ブラウザの通常幅で確認した。全体の列構成はレスポンシブ差があるため、依頼対象のチャネル行を重点比較した。
- 重点比較は参照を200×60 px、実装を201×65 pxで切り出し、どちらも3倍へ拡大して同じ画像内に並べた。deviceScaleFactor相当は1。
- 実装画面はページ横スクロールなし。LINE・MAILボタンはそれぞれ44×32 px、48×32 pxで1行表示。

## 確認結果

- P0 / P1 / P2 の未解決差分なし。
- 文字・フォント: 重複していた右側の「LINE」「メール」を削除し、バッジ内のLINE・MAILだけを表示した。文字の太さとサイズは既存のチャネルバッジを維持。
- 余白・配置: バッジをボタン中央へ寄せ、隣の「すべて」「新しい順」と干渉しない。
- 色: LINEの緑、MAILの白・グレー、選択背景は既存V4トークンを維持。
- 画像・アイコン: 新しい画像置換はなく、既存のLINE・MAILバッジをそのまま使用。
- 文言: 見た目から重複文字だけを外し、`aria-label` と `title` に「LINE」「メール」を残した。

## 操作確認

1. LINEバッジを押すと `/chats?channel=line` へ切り替わり、選択状態になった。
2. 「すべて」を押すと `/chats` へ戻り、選択状態になった。
3. ブラウザログにエラー・警告なし。

## 比較履歴

1. 参照画像ではLINE・MAILバッジの右側に同じ意味の文字が重複していた。
2. 重複文字を削除し、実装画像でバッジだけが1行に並ぶことを再確認した。

final result: passed

---

# Design QA — 受信箱・友だち・ダッシュボードの細部調整

## 比較対象

- 受信箱参照: `/Users/kentakenta/Pictures/Zappy/Screen Shot 2026-08-21 at 1.48.48 PM.png`、`/Users/kentakenta/Pictures/Zappy/Screen Shot 2026-08-21 at 1.52.04 PM.png`
- 友だち参照: `/Users/kentakenta/Pictures/Zappy/Screen Shot 2026-08-21 at 1.54.59 PM.png`（1350×901 px）
- ダッシュボード参照: `/Users/kentakenta/Pictures/Zappy/Screen Shot 2026-08-21 at 2.05.43 PM.png`（1350×749 px）
- 内部メモ参照: `/Users/kentakenta/Pictures/Zappy/Screen Shot 2026-08-21 at 1.50.43 PM.png`
- 受信箱実装: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/inbox-visual-details-1600x900.png`（1600×900 px）
- 友だち実装: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/friends-visual-details-1600x900.png`（1585×892 px）
- ダッシュボード実装: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/dashboard-heading-1600x900.png`（1585×892 px）
- 内部メモ実装: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/internal-memo-no-close-1600x900.png`
- 全体比較: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/visual-details-comparison.png`
- 内部メモ重点比較: `/Users/kentakenta/.codex/visualizations/2026/08/20/01a02033-4ebc-77d3-ab98-f2247981416b/internal-memo-comparison.png`

## 確認条件

- PC表示を1600×900へ固定し、同じ確認用データで受信箱、友だち一覧、ダッシュボードを確認した。
- 参照と実装を同じ比較画像へ配置し、文字、余白、ボタン高、吹き出し、モーダル操作を目視確認した。
- ローカルの確認用APIだけを使用し、開発・本番データは変更していない。

## 確認結果

- P0 / P1 / P2 の未解決差分なし。
- 文字: ダッシュボード見出しを受信箱と同じ24px・700へ統一した。担当者名は表示領域を広げ、途中で省略されない。
- 余白: 受信箱と友だち一覧の説明文を削除し、タイトル直下の内容を上へ詰めた。
- 操作: 顧客情報の「表示項目」と「閉じる」はともに32px高。内部メモは上部の重複した「閉じる」を外し、下部の「キャンセル」「保存」だけを残した。
- 配置: 受信メッセージのアバターと吹き出しを上端でそろえ、送信メッセージの担当者表示は吹き出し横で全文を確認できる。
- 色・枠線・角丸・影: 既存V4トークンを維持し、新しい色や装飾は追加していない。

## 操作確認

1. LINE会話を選び、顧客情報パネルが表示されることを確認した。
2. 顧客情報の2ボタンを実測し、どちらも32px高であることを確認した。
3. 内部メモを開き、ダイアログ内の操作が「キャンセル」「保存」の2つだけであることを確認した。
4. 友だち一覧へ遷移し、説明文がなく一覧全体が上へ詰まることを確認した。
5. ダッシュボードへ遷移し、見出しが24px・700で表示されることを確認した。

## 比較履歴

1. 初回参照では説明文の分だけ主要領域が下がり、ダッシュボード見出しだけ大きく、内部メモに閉じる操作が重複していた。
2. 説明文、見出し、ボタン高、メッセージ行、内部メモ操作を修正した。
3. 実装画像を再取得し、全体比較と内部メモ重点比較で指定箇所が解消していることを確認した。

final result: passed
