# V6 友だち追加時配信・公開画面の引き継ぎ

対象は `ec9vg`（最終確認）と `quhg6`（有効化完了）です。
契約の固定baseは #431、契約PRは #597 です。

## 読み口と実行口

- `GET /api/friend-add-routing/draft?account_id=...`
- `POST /api/friend-add-routing/validate?account_id=...`
- `GET /api/friend-add-routing/conflicts?account_id=...`
- `POST /api/friend-add-routing/draft/test?account_id=...`
- `POST /api/friend-add-routing/publish?account_id=...`

型の正本は `packages/shared/src/types.ts` の `FriendAddRoutingVersion`、
`FriendAddRoutingValidation`、`FriendAddRoutingDraftTestResult`、
`FriendAddRoutingPublishResult` です。

## 画面で守ること

1. `ec9vg` は下書き、対象見込み、4つの確認結果、競合、最後の試験結果を読み合わせてから公開する。
2. `lastTestStatus !== "succeeded"` または `canPublish === false` のとき、公開操作を出さない。
3. 公開には16文字以上の `Idempotency-Key` を必ず付ける。
4. 試験結果の `stateChanged: false` を「送信済み」「反映済み」と書かない。
5. 公開前の対象見込みは `FriendAddRoutingValidation.estimatedAudienceCount` を使う。公開後の返事を先取りしたり、固定値を置いたりしない。`null` は0人でなく未取得と書く。
6. `quhg6` は公開版、対象人数、二重実行防止、実行結果への導線を公開結果から表示する。
7. 通常・空（404）・失敗（500）・権限不足を別の面にする。空を失敗、失敗を0件にしない。
8. `data-design-node="ec9vg"` / `data-design-node="quhg6"` を付ける。
9. 窓や次の段を開く操作には `data-qa-open="ec9vg"` / `data-qa-open="quhg6"` を付ける。
10. 1440px・1920pxでページと主要領域の横スクロールを0にする。

## 画面確認用の固定データ

`scripts/visual-qa/fixtures.mjs` の `FRIEND_ADD_LIFECYCLE_*` が正本です。

- 通常：下書き、確認4件、dry-run、公開結果
- 空：404「確認する下書きがありません」
- 失敗：500「下書きを読み込めませんでした」

`mock-api.mjs` は確認・dry-run・公開を固定結果で返します。状態は保存せず、
ほかの更新口は従来どおり405です。

## 完了条件

Claudeが2画面を同じDraft PRへまとめ、通常・空・失敗・権限不足を
1440px・1920pxで比較するまで台帳の `unimplemented` を外しません。
Codex側では画像作成・台帳判定・本番DB更新・本番配備を行いません。
