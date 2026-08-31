# V6 機能4 対応マーク削除・影響確認の引き継ぎ

対象Nodeは `zGZMA`、画面は `/tags?tab=marks` です。この枝は画面を作らず、
Claudeが削除確認を実装するための読み口と、古い人数で削除しない契約を追加します。

## 読む口

`GET /api/support-marks/:id/delete-impact?lineAccountId=:accountId`

- owner / admin のみ
- 別LINEアカウントのマークは404
- 読み取りに失敗したら503。0人の形にはしない
- `friendCount` は削除後に初期値へ移る友だちの実数
- `replacementMark` は移動先。無ければ `null` で削除不可
- `operationalReferenceCount` は、配信条件・シナリオ・自動応答・保存した検索・
  自動処理・共通アクション・リッチメニュー条件に残る参照の件数
- `automaticRuleStops=true` は「受信時に自動で付ける」が削除で止まることを示す
- `blockers` が空のときだけ `canDelete=true`
- `revision` は確認窓で保持し、削除時にそのまま返す。画面には表示しない

通常・0人・取得失敗の固定データは次にあります。

- `scripts/visual-qa/fixtures.mjs`
  - `SUPPORT_MARK_DELETE_IMPACT`
  - `SUPPORT_MARK_DELETE_IMPACT_EMPTY`
  - `SUPPORT_MARK_DELETE_IMPACT_ERROR`
- `scripts/visual-qa/mock-api.mjs`
  - `mark-hold` は3人
  - `mark-unused` は実値0人

## 消す口

`DELETE /api/support-marks/:id?lineAccountId=:accountId`

本文は `{ "expectedRevision": "..." }` です。以前の `?force=1` は確認を飛ばす
ため、もう削除を通しません。

- revision無しは428 `support_mark_impact_required`
- 影響が変わったら409 `support_mark_impact_changed` と最新 `data`
- 既定・共通・置換先なし・運用設定から参照中は409
  `support_mark_delete_blocked` と最新 `data`
- 同じrevisionのときだけ、友だちの付け替え・履歴・マーク削除をD1の同じバッチで行う
- バッチ直前に人数や設定が変わった場合も、何も変更せず409と最新 `data`

## Claudeの画面実装条件

1. 押し口に `data-qa-open="zGZMA"`、窓に `data-design-node="zGZMA"`
2. 窓を開いたときだけ `deleteImpact()` を読む。書き込み口は呼ばない
3. `accountId + markId + requestGeneration` で応答を照合する
4. アカウント切替時は対象・影響・失敗・実行中をすべてリセットする
5. 読込中・3人・実値0人・取得失敗・409を別の絵にする
6. 「3人は削除後に『未対応』へ変更」「元に戻せない」を同じ窓に出す
7. `automaticRuleStops` と `operationalReferenceCount` があれば影響を隠さない
8. `canDelete=false` または取得失敗では削除ボタンを出さない
9. 409は窓を閉じず、返ってきた最新 `data` で描き直す
10. APIの生文・内部ID・revisionは本文に出さない
11. 1440px・1920pxとも横スクロール0

非同期の注意は #615 / #617 と同じです。遅れて返った別アカウント・別マークの
影響を現在の窓へ入れず、409に含まれる最新影響を捨てないでください。
