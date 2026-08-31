# V6 機能22 `hHrz8` 写真審査・1件詳細 引き継ぎ

## 正本

- Node: `hHrz8`
- 機能: 22 写真審査
- 既存画面: `/nen-members`
- 推奨導線: `/nen-members?photoId=<id>`
- API: `GET /api/nen-members/photos/:id?accountId=<id>`
- 判定: API契約待ちを解消。画面実装と画像比較は未実施

同じ内容の別ページは作らず、一覧で写真を押したときに同じ面を1件詳細へ
差し替える。戻るときは一覧の絞り込みを保つ。

## 返す事実

- 写真、説明、受付日時
- 投稿者の表示名、ペット名・動物種
- 公開同意（同意済み／撤回済み／記録なし）とペット名公開の可否
- 現在の審査結果、理由、担当者名、LINE通知状態
- 過去の判定履歴（内部の履歴ID・通知エラー本文は返さない）
- 未審査キュー内の位置・総数・前後の写真ID
- `revision`（更新競合を止めるための値）

## 意図して未接続のもの

次を「確認済み」「安全」と描かない。

- 審査用の縮小画像: `imageSafety.derivativeAvailable === false`
- 原画像の安全な取得: `imageSafety.originalDownloadAvailable === false`
- 自動の危険判定: `riskAssessment.state === 'unavailable'`
- 公開操作: `capabilities.canPublish === false`

画面には契約の `explanation` をそのまま運用者向けに出す。原画像の
ダウンロードボタン、AI合格の札、公開ボタンは置かない。

## 更新時の決めごと

`api.nenMembers.reviewPhoto()` へ、詳細を読んだときの `revision` を
`expectedRevision` として必ず返す。409では成功扱いせず、最新状態を読み直す。
写真IDだけで更新せず、選択中の `accountId` も必ず送る。

## 必須の画面状態

1. 読み込み中
2. 通常（未審査）
3. 取得できた0件／404（一覧へ戻す）
4. 読み込み失敗
5. 権限不足
6. 判定窓
7. 409版競合（窓を閉じず、読み直す導線）

未取得を0件・安全・確認済みに置き換えない。内部ID、`r2_key`、
`API error`、通知の内部エラー本文を画面に出さない。

## 撮影用固定データ

`scripts/visual-qa/fixtures.mjs` の `PHOTO_REVIEW_DETAIL` と、
`mock-api.mjs` の動的な詳細ルートを使う。固定データの画像URLは意図的に
無効URLなので、撮影時は既存の写真審査用資産へ差し替える。Codex側では
画像を新規作成していない。

## 完了条件

- 押し口に `data-qa-open="hHrz8"`
- 通常・読込・404・失敗・権限不足・判定窓・409を1440px/1920pxで比較
- ページ全体と詳細面の横スクロール0
- `undefined` / `NaN` / `Invalid Date` / 内部ID / 内部エラー0件
- `expectedRevision` を外すと落ちる契約テスト
- 未接続の3項目を「安全」「確認済み」に変えると落ちる契約テスト

