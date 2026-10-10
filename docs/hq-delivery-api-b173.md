# B-173 統括から配る3種類のAPI

画面担当への引き継ぎ。統括の左メニュー・作成画面は、★V8 の wrzSi と画面担当の手順で接続する。

- クライアント: `apps/web/src/lib/api-hq-deliveries.ts` の `hqDeliveriesApi`。
- 種類: `auto_reply`（自動応答）、`friend_add_rule`（友だち追加時の配信）、`reminder`（リマインダ）。
- 受け口: 既存の `/api/hq/templates`。一覧・詳細・作成・編集・preflight・distribute・結果・received-versions を共用する。
- 定義: `{ schemaVersion: 1, settings, references: [] }`。`settings` は店の下書き保存入力。所属アカウントとフォルダは含めない。リマインダの各ステップには固定した `stableStepId` を付ける。
- 共通の型: `HqDeliveryTemplateInput`、`HqDeliveryDefinitionByType`。作成時は `requestId`、編集時は `expectedRevision` が必要。
- 名前は、統括のひな形の名前と、店に届く `settings.name` を別々に保存する。

配布先を選んだら preflight を呼び、店ごとの `items[].allowedModes` から作成・上書き・別名を選ぶ。稼働中・公開済み・利用履歴のある設定は上書きできない。上書きできるのは未使用の下書きだけ。店には下書きで届き、公開や送信は店で確認して行う。

参照する設定は `references` に種類・元ID・名前を宣言する。配布先にある同名の設定へ結び直す。条件の入れ子・複数タグ・回答済みフォーム・対応マークも対象。存在しない、同名が複数ある、別の店の設定しかない場合は配らず再確認を促す。参照の確認行は `operation: reuse` で、既存の確認の仕組みに合わせて `mode: overwrite` を送るが、参照先の内容は書き換えない。イベント操作の特定回IDは店ごとに異なるため、統括のひな形では回指定を受け付けない（リサーチでの回指定は可能）。

確認後の店の編集・利用開始・参照先の変更は競合として止める。同じ配布キーの再送では増やさない。配った先は `receivedVersions` で確認する。

版の一覧・比較・復元も既存の `/api/hq/templates/:id/versions`、`/versions/compare?from=1&to=2`、`/versions/:version/restore` を共用する。復元は `{ expectedRevision }` を送り、過去版を変えず新しい版として保存する。統括の版を更新しただけでは、店の設定や配った版は変わらない。

未接続の画面は統括の左メニューと3種類の一覧・作成・編集・配布。画面担当が店の編集部品を統括のhostで使い、保存成功後に配布先の窓へ進める。APIの完成は画面の完成や★V8との照合合格を意味しない。

DB変更はオーナー承認済みの622。`delivery_type` を足して既存の外部キーと配布台帳を保持する。表の作り直しは不要。620・621は別用途。D1への適用はこの作業では行わない。司令塔が検証へ反映するときは、622を適用してから今回のWorkerを配備する（ひな形の読取も追加列を使う）。
