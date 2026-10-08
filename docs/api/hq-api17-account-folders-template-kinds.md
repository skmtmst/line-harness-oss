# API-17：統括のアカウントフォルダ・テンプレート6種類

2026-10-08の司令塔の依頼を実装。画面・配備・D1適用は対象外。
検証開始時の `origin/codex/development` は `d218608a663300d603f82832d21e2df8aaebf927`。

## アカウントフォルダのAPI

- `GET /api/line-account-folders`：共有 `Folder` と同じ `id/name/kind/parentId/color/displayOrder` に `itemCount` を付ける。`data.folders`、`data.total`、`data.unclassifiedCount`。件数は担当範囲内のアーカイブされていないアカウントだけ。
- `POST /api/line-account-folders`：`{name,color?,displayOrder?}`。
- `PATCH /api/line-account-folders/:id`：名前・色・`displayOrder`を変更。並べ替えも店のフォルダと同じ`displayOrder`を使う。
- `DELETE /api/line-account-folders/:id`：所属だけ外し、アカウントは未分類へ残す。
- `PUT /api/line-accounts/:id/folder`：`{folderId:ID|null}`。所属は必ず1つ。`null`は未分類。
- 既存の `GET /api/line-accounts` に `folderId/folder` を追加。`?folderId=ID`で絞り込み、`?folderId=__none__`で未分類。

変更はオーナー・管理者だけ。閲覧のみ・一般スタッフは担当範囲の一覧を読む。
別統括のフォルダやアカウントは指定できない。
Webの呼び出しは `api.lineAccountFolders` と `api.lineAccounts.list(live,folderId)`。

## 608の移行

`608_line_account_folders.sql`を追加。既存タグの辞書・色・IDと旧タグAPIを再利用する。
所属の正本は`line_accounts.folder_id`。タグ0件は未分類、1件はそのID、複数は表示順・名前・IDの昇順で最初の1件を採用する。
既存の複数タグのリンクは移行で削除しない。旧APIからタグを付け直したときも同じ順で1つを選び、新フォルダAPIからの移動は旧タグリンクも1件（未分類なら0件）に更新する。
統括の境界はDBの制約でも守る。テーブルの作り直しはない。bootstrapも再生成済み。
番号608は最新ブランチと公開中PRの追加ファイルを照合して採番。未適用。

## テンプレートのAPIと共有型

`GET /api/hq/templates?kind=message|carousel|rich_message|question|coupon|research`で種類を絞る。
`data[]`を維持し、各行に`kind`と`content_summary`、返答に`kind_counts`（6種類、0件を含む）を付ける。
`GET /api/hq/templates/kind-counts`でも全6種類の件数を返す。

作成・保存・事前確認・配布は既存の `/api/hq/templates` の口を使う。
`MessageTemplateDefinition`を共有型へまとめ、店の`BroadcastAssetKind/AssetPayloadInput`をそのまま`asset`として使う。
メッセージ・質問は既存の`template`を使う。カルーセルの店側の保存名は`card_message`。
リッチメッセージ・カルーセル・クーポン・リサーチは店の素材表に保存し、公開版の記録も作る。
質問のタグ・友だち情報欄などの参照は配布先のIDへ直す。配布直前の変更、別統括、再試行は既存の保護に従う。

要約はカルーセル「カード 3枚」、リッチメッセージ「画像・面 6」、質問「選択肢 4」、クーポン「期限 10/31」、リサーチ「質問 5」。本文や画像URLは要約へ出さない。
Webの呼び出しは `hqTemplatesApi.listByKind`、`kindCounts`、`uploadRichMessageImage`。

## 画像

既存の統括画像アップロードを再利用する。
`POST /api/hq/templates/media?purpose=rich_message&filename=...`は認証済みの原画像からCF_IMAGESで240/300/460/700/1040の5サイズを生成し、`{media,payload}`を返す。
配布時は全サイズを配布先アカウントのR2へコピーし、画像のURL・所属・使用台帳を更新する。
店の定期点検と削除確認も6種類の素材を対象にする。各サイズの参照を保持して、使用中画像を削除できないようにする。
既存の画像一括置換が素材表に対応していないため、その参照は一括置換の対象外とし、テンプレート編集画面から変更する案内を返す。

## 検証と引き継ぎ

HTTP・実SQLite・R2を通して6種類の保存、一覧、件数、配布、画像の全サイズ、参照ID、競合、再試行を検証。
移行の先頭選択とカルーセルの要約を一時的に壊し、それぞれ試験が落ちることも確認後、元へ戻す。
検証結果：
- Worker全体：865ファイル、10,020件合格・30件スキップ。
- 最後の追加・修正に関係するWorker試験：10ファイル、230件合格（上の全体試験との重複あり）。
- 共有型：22ファイル、252件合格。Web API：3ファイル、40件合格。
- DB全体：349ファイル、2,126件合格・旧定義の試験1件失敗。試験の表を608へ合わせ、その1件と608の移行試験を再実行して2件合格。合計2,127件の検証済み。
- Worker・Web・DB・共有型の型検査、Workerビルド、migration-policy、bootstrap照合、差分検査が合格。
- 2件の故障注入では、正常な準備を終えたあとに期待値の違いで試験が落ちることを確認。

実行：`pnpm --filter worker exec vitest run --maxWorkers=4`、`pnpm --filter @line-crm/db exec vitest run`、`pnpm --filter @line-crm/shared exec vitest run`、各パッケージの`tsc --noEmit`、`pnpm --filter worker build`。
公開中PR36件を再照合し、608の追加がないことを確認。

コミットまでで停止。司令塔がPRを作り、反映履歴の下書きへPR番号を付けて移す。
608の適用と検証環境への配備は、承認とクリーン確認を済ませてから別工程で行う。
