# 更新用SQLの履歴と既存DBの初期化

用途: 更新経路の安全停止・既存DB初期化と復旧のレビュー手順。
区分: 開発・運用手順（実DB適用は別承認）。
最終確認: 2026-10-22。

更新エンジンとCLI updateは、`_musubo_migration_history` のファイル名・SHA-256・状態を確認して未適用SQLだけを実行する。配布物のSQL全体もmanifestの `migrations_hash` と照合するため、初回適用前の内容一致を確認する。このhashのない旧bundleは安全停止する。従来の `_migrations` も併記する。新規setupは今回作成したD1へ検証済みbootstrapを適用し、その成功分を両台帳に記録する。既存D1へのsetup再実行、bootstrap/meta不整合、通信結果不明のSQL再試行は停止する。

これは製品DBへの適用手順の準備であり、この改修では検証・本番のDBを変更していない。台帳のない既存導入は安全停止するため、下記初期化まで通常の更新を完了できない。既存の名前だけの台帳・稼働版番号・テーブルの有無を、SQL全文が適用済みだった証拠として自動採用しない。

## 既存DBのbaselineを準備する

1. 対象DBの識別子、バックアップ/Time Travel bookmark、適用時ログ、既存 `_migrations` または `d1_migrations` の全行、適用元コミットとSQLファイルを収集する。過去に部分失敗したSQL、手動更新、既存データへの変換も照合する。証明できないものは再実行で確認せず、個別復旧を設計する。
2. 確認済みの**全適用済み履歴**だけを次のJSONへ記録する。sha256は各適用時SQLの生バイトのSHA-256（64桁、接頭辞なし）。更新先版の一覧をそのまま適用済みとしない。

```json
{
  "databaseId": "対象DBの識別子",
  "sourceRevision": "確認済みSQLを取り出した40桁のコミットSHA",
  "reviewedBy": "確認者またはレビュー識別子",
  "completeAppliedHistory": true,
  "migrations": [{ "name": "041_example.sql", "sha256": "64桁の確認済みSHA256" }]
}
```

3. ローカルでSQL案を生成する（DB接続なし、既存出力は上書きしない）。

```sh
pnpm exec tsx scripts/recovery/prepare-update-migration-baseline.ts --migrations-dir /確認済みSQLディレクトリ --evidence-file /確認済み履歴.json --out /baseline-review.sql
```

4. 生成SQL、全適用履歴、対象DB、バックアップ、切り戻し方法をレビューし、DB更新の明示承認を得てから別工程で適用する。生成器は承認や履歴の真偽を代行しない。既に補助台帳がある場合はCREATEで停止し、上書きしない。途中失敗の場合はlockがapplyingのまま残り、通常更新を停止する。
5. 全台帳の件数・名前・checksum・stateを読取確認し、未適用の対象SQL一覧を再確認してからupdateを再実行する。

## 失敗・通信結果不明の復旧

更新はSQL実行前にapplyingを記録し、成功応答の後にappliedを記録する。タイムアウト、部分失敗、台帳保存失敗は全体lockも保持する。自動期限切れ・自動ロック解除は行わない。復旧担当がバックアップと実体を照合し、未適用なら安全な復旧、適用済みなら照合したchecksumで台帳補正を別承認の工程として実施する。単純に行を削除して再実行しない。D1スキーマの自動rollbackは行わない。

## LIFFの更新と切り戻し

Worker assets構成はreleaseの `worker-assets/`（`apps/worker/dist/client`）をDirect Upload APIへ登録し、完了tokenとWorkerコードを同時に配備する。別アプリの `liff/`（`apps/liff/dist`）と混ぜず、資産専用hashを検証する。配信後はindexと全配信資産の内容を店舗設定反映後のbundleと照合する。`_headers` / `_redirects` は配備metadataへ渡す。旧bundleに `worker-assets/` がなければSQL適用前に停止する。自動更新のsnapshotは現在のWorker version配分を保存するため、切り戻し時にコードと同版のassetsも復元する。Worker assets構成の旧script-only snapshotはassetsを復元できないため配備前に停止し、旧履歴からの切り戻しは別途内容を確認する。Cloudflareの実API配備・伝播・復元はこの改修では未実行で、API試験はmockのみ。

復旧時は稼働中の成功済みPages production配備を控えとし、直近のpreview/failed配備を選ばない。更新中に履歴D1が停止しても、メモリに保持した控えで復旧を試みる。履歴・イベント保存失敗は復旧を妨げず、呼出元へ返す例外causeに集約する。ただしプロセス自体が終了した場合は永続化済みsnapshotの確認が必要。資産の配信検証は各要求10秒、最大3回の有限再試行を行う。
