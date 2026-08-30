# V6 機能14 共通情報削除・影響確認の引き継ぎ

対象Nodeは `yPkWe`、画面は `/contents/vars` です。この枝は #580 の確認窓を
土台に、使用先の名前・状態・導線を返す契約と安全な削除条件を追加します。
差し替えとアーカイブはまだ実装しません。

## 読む口

`GET /api/common-vars/:id/delete-impact?accountId=:accountId`

- owner / admin のみ。別LINEアカウントの共通情報は404
- 次の7種類を、完全一致の `{{var.key}}` で毎回走査する
  - テンプレート、一斉配信、シナリオ、リマインダ、自動応答、回答フォーム、オートメーション
- 一斉配信は `line_account_id` だけでなく複数アカウント配信の `account_ids` も見る
- 回答フォームは `form_accounts` で選択中アカウントへ所属するものだけ、名前と導線を返す
- 所属の無い古いフォームは名前・本文を返さず、`unavailableReferences` に件数だけ残す
- 別アカウントだけに所属する設定は件数にも詳細にも混ぜない
- 7種類のうち1つでも読めなければ503。途中結果を0件として返さない
- 送信済み配信は履歴として `blocksDeletion=false`。過去の配信内容は変わらない
- 現在の使用先または所属不明フォームが1件でもあれば `canDelete=false`
- 使用先IDを専用項目で返さない。`href` は遷移だけに使い、本文へ内部IDを出さない

通常・0件・失敗の固定データは次にあります。

- `scripts/visual-qa/fixtures.mjs`
  - `COMMON_VARS`
  - `COMMON_VAR_DELETE_IMPACT`
  - `COMMON_VAR_DELETE_IMPACT_EMPTY`
  - `COMMON_VAR_DELETE_IMPACT_ERROR`
- `scripts/visual-qa/mock-api.mjs`
  - 通常は `common-var-delete-target`
  - 0件は `common-var-delete-safe`
- 失敗は撮影段で503と `COMMON_VAR_DELETE_IMPACT_ERROR` を返す

## 消す口

`DELETE /api/common-vars/:id?accountId=:accountId`

削除時にも同じ7種類をサーバー側で走査し直します。画面で一度読んだ結果は
信用しません。

- 現在の使用先あり／所属不明フォームあり: 409、`code=COMMON_VAR_IN_USE`
- 409の `data` に最新の削除影響を返す
- 送信済み配信だけなら、履歴を残したまま共通情報を削除できる
- 走査失敗: 503。共通情報を消さない
- forceによる迂回は無い

## Claudeの画面実装条件

1. 押し口は `data-qa-open="yPkWe"` を使う
2. 窓を開いたとき、選択中の各共通情報へ `deleteImpact()` を読む
3. 読込中・通常・0件・失敗を別の絵にする
4. 使用先ありは名前・種類・状態・現在の文・導線を出し、削除ボタンを出さない
5. `unavailableReferences` は「詳細を確認できません」とし、未使用へ混ぜない
6. 送信済み配信は「過去の内容は変わりません」と読み分ける
7. 削除409では窓を閉じず、返った最新 `data` で描き直す
8. `busy` で二重押しと実行中の閉じる操作を止める
9. 1440px・1920pxとも横スクロール0、内部IDを本文へ出さない

この段階では「別の共通情報へ差し替える」「アーカイブ」は未完了です。そのため
`yPkWe` 全体の判定は、影響確認の画面が入っても `needs_fix` のままにしてください。
