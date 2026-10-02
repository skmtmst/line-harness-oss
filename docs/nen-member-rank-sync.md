# ランク削除時の会員別EC送信

2026-10-02。開発用。DB適用・配備・pushは行っていない。

- 取り込んだ開発土台：`a3f658a40e453dacb415587d8e9c0c3a620546e0`。
- EC側の契約：EC作業場所の `docs/member-rank-api.md`（nen-petfood-eccube #437）。

## 接続の切り替え

Workerの `NEN_EC_MEMBER_RANK_SYNC_ENABLED` が文字列 `true` で、既存の `NEN_EC_BASE_URL` と `ECCUBE_WEBHOOK_SECRET` がそろった場合だけ送る。未設定・`false`・接続設定不足なら送らず、削除応答の `ecSync` は従来の `pending`。設定値は今回変更していない。

秘密はECの `LINE_HARNESS_EVENT_SECRET` と同じ値を既存の秘密設定から供給する。値を文書・コード・試験へ書かない。`X-Nen-Timestamp` / `X-Nen-Signature` で生の本文を署名する。自動送信なのでLINEの手動送信の印は付けない。

## 削除と結果の確認

`DELETE /api/nen/rank-settings/:id` は既存の入力（`accountId`、`replacementRankId`、`expectedVersion`）を使う。会員・タグ・ランク・設定の版と送信待ちの記録を同じbatchで保存し、その後でECへ送る。会員のEC識別子が不正でも移し替え自体は保存し、会員別の送信失敗として返す。

応答の `data` には既存の項目に加え `operationId` と `ecSyncResult` がある。`ecSync` は `pending` / `failed` / `synced`。ECが失敗しても、musuboで保存できた削除は取り消さず `success: true` とする。

送信結果をDBへ保存できない障害では、保存できた削除を失敗扱いにせず、操作IDと `ecSync: "pending"`、`ecSyncResult: null`、確認を促す日本語のメッセージを返す。成功件数を推測しない。元の送信待ち・版・鍵からやり直せる。

`ecSyncResult` は操作全体の `total`、`succeeded`、`failed`、`pending` と `results` を返す。各会員の結果には `id`、`friendId`、`customerId`、`status`、`code`、日本語の `reason`、成功時の `version`、`duplicate`、`attempts` がある。ECの自由文や例外本文は保存せず、既知の失敗コードに対応する日本語の理由を保存する。

`GET /api/nen/rank-settings/member-sync/:operationId?accountId=...` で保存した結果を再取得する。結果は100人まで。`nextCursor` があるときは、その値を `afterId` に付けて次のページを読む。

`POST /api/nen/rank-settings/member-sync/:operationId/retry` に `{ "accountId": "対象アカウントID" }` を送り、未成功の会員をやり直す。閲覧・再送ともオーナーまたは管理者だけで、操作IDが別アカウントに属する場合は404。既存のアカウント権限・機能の切り替えも適用される。

## 再送の決まり

最初にECの `/line-harness/member-rank/versions` で会員ごとの版を読み、変更を送る前に保存する。設定全体の版は使わない。変更の口は `/line-harness/member-rank`。

保存した会員ID・移し先・理由・元の担当者・版・重複防止の鍵で再送する。ECへの変更が届いた後に応答が失われても、同じ鍵で結果を再取得できる。成功済みの会員は再送しない。版の読み取り自体に失敗した場合だけ再度読む。変更を送る版が一度保存されていたら、版違いでも読み直して上書きしない。版違いは担当者が新しい変更として判断する。

1回に100会員まで処理し、ECへはまとめて送る。残りがあれば同じ操作IDで再送する。未試行・試行回数の少ない会員から処理するため、失敗が続く会員が残りの処理を止めない。処理は削除要求と明示的な再送要求で行い、定期処理は追加していない。停止中に削除した会員も送信待ちを保存するので、後で切り替えを有効にして同じ操作IDで送れる。

## DB変更と司令塔への引き継ぎ

`550_nen_member_rank_sync.sql` が会員別の送信待ちと結果の保存先を追加する。既存の表や行は作り直さない。公開中PRの548・549と開発土台の最大547を確認して550を選んだ。`bootstrap.sql` と `bootstrap-meta.json` は生成物を更新した。

司令塔はPR作成時に反映履歴へ実際のPR番号を追記し、DB適用の承認と採番の重複を確認する。musuboのmigrationとEC側のmigrationを承認済みの別工程で適用し、それぞれのコードを配備してから接続の切り替えを有効にする。新しいWorkerは送信停止中でも送信待ちを保存するため、musuboのmigrationを先に適用する必要がある。本番・D1への適用と配備は今回の作業に含めない。
