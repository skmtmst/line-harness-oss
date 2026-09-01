# V6 機能12 リッチメニュー削除・影響確認の引き継ぎ

対象Nodeは `szXsT`、画面は `/rich-menus` です。この枝は画面を作らず、
Claudeが確認窓を実装するための読み口と安全な削除条件だけを追加します。
契約のDraft PRは #608、固定baseは #588 head `c3a881fe` です。

## 読む口

`GET /api/rich-menu-groups/:groupId/delete-impact`

- owner / admin のみ
- 別LINEアカウントのものは404
- 読み取りに失敗したら503。0件の形にはしない
- `currentAudience.value` は現在 `null`
  - LINEは友だちごとの現在表示を返さず、こちらにも割当台帳がないため
  - 画面では `—（未取得）` とし、0人と書かない
- `nextDisplay.guaranteedGroupId` は常に `null`
  - 次に表示されるものは友だちごとの条件で変わるため
  - `candidates` は実際の判定順と同じ候補順。先頭を「必ず次」と断定しない
- `incomingSwitches` は、別のリッチメニューからこのメニューへ入る切替
- `operationalReferences` は、現在版の自動処理と共通アクションからの参照
  - 旧自動処理の `line_account_id = null` は全アカウントで動くため、参照があればここに含む
- `lineResources` は、ページ数・LINE上の実体・全員の既定・公開処理中か
- `blockers` が空のときだけ `canDelete=true`

通常・0件・失敗の固定データは次にあります。

- `scripts/visual-qa/fixtures.mjs`
  - `RICH_MENU_DELETE_IMPACT`
  - `RICH_MENU_DELETE_IMPACT_EMPTY`
  - `RICH_MENU_DELETE_IMPACT_ERROR`
- `scripts/visual-qa/mock-api.mjs`
  - 通常は `rich-menu-target`
  - 0件は `rich-menu-safe`
  - 失敗はブラウザ側で503と `RICH_MENU_DELETE_IMPACT_ERROR` を返す

## 消す口

`DELETE /api/rich-menu-groups/:groupId`

削除時にもサーバー側で影響を読み直します。画面で一度読んだ結果を信用して
削除しません。`?force=true` を付けても、次のどれかがあれば409で止まります。

- 公開中または公開処理中
- 全員の既定
- LINE上のリッチメニューIDが残る
- 別メニューからの切替が残る
- 自動処理・共通アクションから参照される

409の `code` は `rich_menu_delete_blocked` です。`ApiError.code` で判定し、
`ApiError.data` に保持された最新の影響で窓を描き直します。`ApiError.message` は
利用者へそのまま出さず、画面の言葉へ置き換えます。

## Claudeの画面実装条件

1. 確認を開く押し口に `data-qa-open="szXsT"` を付ける
2. 窓を開いたときに `deleteImpact()` を読む
3. 読込中・通常・0件・失敗を別の絵にする
4. 表示中人数 `null` は `—（未取得）`。0人を作らない
5. 次の候補は「候補」と明記し、1件を確定表示しない
6. `incomingSwitches` と `operationalReferences` は名前を表示し、内部IDは出さない
7. `canDelete=false` では削除ボタンを出さない
8. `recommendedAction=unpublish` は先に非公開、`review_references` は参照を外す導線
9. 削除409は窓を閉じず、返ってきた最新 `data` で影響を描き直す
10. 1440px・1920pxとも横スクロール0

この段階では「使用先の差し替え」「アーカイブ」は実装しません。押しても何も
起きない操作は置かず、参照先を開いて外すところまでを画面の責任とします。
