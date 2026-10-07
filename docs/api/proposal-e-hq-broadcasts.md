# 提案E：統括の一括配信（2026-10-07）

`/api/hq/broadcasts`。統括全体を扱えるowner/adminだけが利用できます。担当店舗限定・閲覧のみは利用不可。型は`@line-crm/shared`、管理画面の呼び出しは`hq-broadcasts-api.ts`、全口をOpenAPIに掲載しています。

| 口 | 入力 | 返り値 |
| --- | --- | --- |
| `GET/POST /api/hq/broadcasts` | 作成は`requestId, title, messageType, messageContent, accountIds, accountTagIds, excludedAccountIds, audience, scheduledAt`。吹き出し・altTextも可 | 固定した店舗ごとの対象、実行ID・版 |
| `GET /:id` | 実行ID | 店舗ごとの状態・送信数・成功数・再送可能数・子配信の版 |
| `POST /:id/preflight` | 実行ID | 店舗ごとの人数・残枠・接続・停止・問題点 |
| `PUT /:id/exclusions` | `accountIds`（外す店）、`expectedVersion` | 更新した実行 |
| `POST /:id/send` | `expectedVersion` | 作った店舗ごとの通常配信 |
| `POST /:id/stop`、`POST /:id/cancel` | `expectedVersion` | 全店の停止・取消状態 |
| `POST /:id/targets/:accountId/retry` | 子配信の`expectedVersion` | 対象店の再送状態 |

send/retryは既存の`X-Confirm-Irreversible: broadcast-send`が必要です。即時は`scheduledAt: null`、予約は全店共通の未来時刻。送信は既存の定期処理から実行します。

アカウント分類または店舗で対象を固定します。その後分類に店が追加されても実行には加わりません。友だちの絞り込みは`audience: {kind: all}`または`{kind: tag, tagName}`。同じ名前のタグは店ごとのIDへ対応させ、0件・複数なら送信前確認で止めます。送れない店舗を外して再確認できます。残枠が分からない場合も止めて理由を返します。

`{{account.name}}`は送信店舗の名前、`{{var.*}}`はその店の共通情報。子配信は通常のbroadcastsとして各店舗の一覧に出し、`fromHeadquarters, hqRunId, editable: false`を返します。店側の変更・削除・停止・再送は403です。統括から操作してください。

requestIdは重複実行防止、expectedVersionは同時編集防止。再送するのは一時的な失敗と停止前の未送信だけ。成功・送達不明には再送しません。全店取消後は再送不可。予約の停止・取消は下書きへ戻し、実行中は未送信分を止めます。送信済みのLINEは取り消せません。操作は店舗ごとに監査へ残します。

マイグレーション草稿：597。実行・対象・監査は保存する記録です。通常配信・店舗が保存期限で削除されても操作履歴を残します。
