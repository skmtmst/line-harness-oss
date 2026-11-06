> 文書：ウェビナーの一覧（V8）の動き｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# ウェビナーの一覧（V8）の動き

入口：`app/webinars/page.tsx`（`src/v8/webinars/list.tsx` に固定）。
絵：一覧 `UyUMw`・1152 `uBMuB`・閲覧のみ `jiNg0`・アーカイブの確認 `VXZ6T`。

## 受け付ける URL と指定
- `/webinars` だけ。今の一覧も URL の指定（`?id=` など）は読んでいない。

## 呼ぶ口（今の一覧と同じ）
- 一覧：`webinarApi.list(accountId, { page, limit, q, folder, status, sort })`（`folder` は `__unfiled__` で未分類）
- 件数：`webinarApi.list(accountId, { limit: 1 })`（すべて）・`{ limit: 1, status: 'active' | 'draft' }`（札の件数。新しく足した）
- 数の帯：`webinarApi.overview(accountId)`
- フォルダ：`webinarApi.folders` / `createFolder` / `updateFolder`（名前・並び）/ `deleteFolder`
- 名前のその場の書き換え：`webinarApi.update(id, { title })`
- アーカイブ：`webinarApi.archive(id)`、下書きに戻す：`webinarApi.update(id, { status: 'draft' })`
- CSV：表示中の条件の全頁を 100件ずつ取って `webinars.csv`

## 今の一覧と違うところ（見せ方だけ）
- 公開期間が終わった行の札は「非公開」（絵どおり。今の一覧は「終了」）
- 公開ページの道は `/webinar/<slug>`（LIFF の公開 URL と同じ形）
- 公開の予定の行は、視聴の列に「開始前」
- 表示件数は 10・20・50件。並びの言葉は短く（更新順・作成順・名前順）
- フォルダの「…」（名前の変更・並べ替え・削除）は選んだフォルダの行に出る
- 閲覧のみの人には、数の帯の上に「閲覧のみで見ています」の帯

## フォルダの色（fcolall・2026-10-09）
- 追加・編集は名前と色を横に並べた共通の窓。色を変更して保存するとフォルダの列と一覧の名前の前の丸へ反映し、読み直しても残る。保存の失敗は窓内に出す。
- 検索は共通欄の300msへ一本化。最後の入力だけをURL/APIへ渡す。遅い古い応答で新しい結果を上書きせず、取得中と再取得失敗時も直前の行を残す。
- 集計できない詳しい理由は既存の「？」へ出す。同じ理由は一度だけにまとめ、別の理由には指標名を添える。通常の帯の値と並びは変えない。
