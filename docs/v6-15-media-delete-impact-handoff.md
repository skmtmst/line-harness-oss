# V6 機能15 登録メディア削除・影響確認の引き継ぎ

対象Nodeは `YfTfJ`、画面は `/contents` です。この枝は確認窓を作らず、
Claudeが画面を実装するための読み口と安全な削除条件だけを追加します。
契約PRは #610、固定baseは #560 head `7c1acd0f` です。

## 読む口

`GET /api/media/:id/delete-impact?accountId=:accountId`

- owner / admin のみ
- 別LINEアカウントのメディアは404
- 確認のたびに、対象メディアのR2キーを7種類の現在の正本で走査する
  - テンプレート
  - 一斉配信
  - リッチメニュー
  - シナリオのステップ
  - NENコラム
  - イベント
  - ウェビナー
- 複数吹き出しは、一斉配信とシナリオの `message_bubbles_json` も走査する
- NENコラムは `image_url`、ウェビナーは現行の `video_prefix` を読む。存在しない列を推測で読まない
- 7種類のうち1つでも読めなければ503。途中結果を0件として返さない
- 定期走査の各1種類200件上限は削除確認に使わず、削除直前は使用先を全件読む
- 全部読めた時刻が `checkedAt`。使用先0件でも必ず入る
- `references` は運用者向けの名前・導線・走査時刻を返す
- 参照先が削除済み、または別アカウントで名前を見せられない場合は
  `state=unavailable`、`name=null`、`href=null`
  - その参照は件数から落とさず、削除を止める
- 使用先0件のときだけ `canDelete=true`
- 使用先IDを専用フィールドでは返さない。`href` は画面遷移だけに使い、
  クエリ中のIDを本文へ表示しない

通常・0件・失敗の固定データは次にあります。

- `scripts/visual-qa/fixtures.mjs`
  - `MEDIA_ITEMS`
  - `MEDIA_DELETE_IMPACT`
  - `MEDIA_DELETE_IMPACT_EMPTY`
  - `MEDIA_DELETE_IMPACT_ERROR`
- `scripts/visual-qa/mock-api.mjs`
  - 通常は `media-delete-target`
  - 0件は `media-delete-safe`
- 失敗は撮影段で503と `MEDIA_DELETE_IMPACT_ERROR` を返す

## 消す口

`DELETE /api/media/:id?accountId=:accountId`

削除時にも同じ7種類をサーバー側で走査し直します。画面で一度読んだ結果や
一覧の `usageCount` は信用しません。

- 使用先あり: 409、`code=media_delete_blocked`
- 409の `data` に最新の削除影響を返す
- `force=1` を付けても迂回できない
- 走査失敗: 503。メディアは消さない
- 使用先0件を確認できたときだけ、DBの行→R2実体の順で消す

## Claudeの画面実装条件

1. 一括削除を開く押し口に `data-qa-open="YfTfJ"` を付ける
2. ブラウザ標準の `confirm()` を `ConfirmDialog` へ替える
3. 窓を開いたときに選択中の各メディアへ `deleteImpact()` を読む
4. 読込中・通常・0件・失敗を別の絵にする
5. 対象名、何が消えるか、何が残るか、戻せないことを窓に書く
6. 使用中は名前と導線を出し、`canDelete=false` では削除ボタンを出さない
7. `state=unavailable` は「使用先の詳細を確認できません」とし、未使用へ混ぜない
8. 削除409は窓を閉じず、返った最新 `data` で描き直す
9. `busy` で二重押しと実行中の閉じる操作を止める
10. 1440px・1920pxとも横スクロール0、内部IDを本文へ出さない

この段階では「使用先の差し替え」「アーカイブ」は実装しません。押しても何も
起きない操作は置かず、参照先を開いて外すところまでを画面の責任とします。
