> 文書：GitHub 設定の運用メモ｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# GitHub 設定の運用メモ

## Pull Request の検査

Pull Request の共通検査は `workflows/required-pr-gate.yml` で1回だけ実行します。
`deploy-scripts-ci.yml` と `worker-ci.yml` の検査内容は共通検査に含まれるため、
この2本は統合後の `push` と手動実行だけを担当します。

G01で廃止した外観の固定検査の呼び出しは外し、現在の崩れ・権限・操作の
検査と故障対照を残しています。`required-pr-gate` の名前と依存ジョブは維持します。

YAML・シェル構文の工程では、直接書いたスクリプトの接続先も確認します。
手元では、PyYAMLのあるPythonで次をリポジトリ直下から実行できます。

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/security/test_workflow_commands.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/security/check_workflow_commands.py
```

対象は `node`・`tsx`・シェル・Pythonの直接呼び出しとNode試験のファイル列です。
変数で組み立てるパス、パッケージの命令、シェル内部の条件や間接呼び出しまで
解釈するものではありません。それらは従来どおり各ジョブの実行で確認します。
配備ロック、稼働設定・認証・DB検査、frozen-lockfileは引き続き維持します。

## 意図して置いていない設定

- `workflows/deploy-pages.yml`: 対象の `gh-pages` ブランチがなく、GitHub Pagesも使って
  いません。画面と文書の配備はCloudflare用workflowが担当します。
- `labeler.yml`: この設定を読むlabeler workflowがないため、置いても動きません。

上流同期でこれらが戻った場合も、利用するworkflowと運用目的が同時に追加されて
いなければ削除した状態を維持します。

## 本番公開の入口（L01）

本番は **Deploy Cloudflare Production** の手動実行だけです。mainへのpushでは
Worker・管理画面を配備しません。`production` Environmentに承認者を設定し、
その承認後もAPIで承認者の存在を確認します。Environmentを作っただけでは進めません。
設定・秘密・保管先をこの変更が作成することはありません。

親全体を `cloudflare-production` で排他し、承認 → SELECTだけの未適用確認 →
バックアップの保存・読み戻し検証 → 承認したSQLだけの適用 → Worker → 公開SHAと
見出しの確認 → 管理画面 → canonical配備・公開SHA・見出しの確認、の順です。
前段が失敗すると後段へ進みません。本番の単独D1操作はdry-runだけを残し、
LINE認証情報の移行も本番では同じ排他を使います。stagingの入口は従来どおりです。

入力は、検証済みの40桁SHA、成功したstaging run ID、承認した未適用SQLの
`[{"name":"NNN_name.sql","sha256":"64桁の小文字hex"}]`（適用順、0件は`[]`）、
予約・通知の停止と復旧手順の確認です。SQLは各ファイルとハッシュをオーナーが
承認してから入力します。件数・並び・中身が増減すれば適用前に停止します。

stagingは開発枝専用なので、本番のmainがマージコミットの場合はSHAが異なります。
検証したSHAが承認済みmainの祖先であり、**Gitのtreeがmainと完全一致**することを
確認し、その検証したSHAそのものを公開します。mainやstagingのコードが途中で
変わる、短縮SHA、config replayの別SHA、dry-runだけのrun、公開SHA不明は拒否します。
依存をインストールする前にもcheckoutとmainの一致を検査します。

### 公開前に運用者が準備すること

- `production` Environmentの承認者、公開するmainと検証したSHAを確認する。
- 予約受付・自動通知・実行中の処理について、既存の停止手段、処理の完了、再開担当、
  中断時の対応をオーナーと確認する。`operations_paused` はその確認の申告であり、
  自動で業務を止める機能ではない。止め方を確立できなければ実行しない。
- EnvironmentのCloudflare資格情報（既存の `CF_API_TOKEN`/`CF_ACCOUNT_ID` または
  `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`）、`D1_DATABASE_NAME`、
  `D1_DATABASE_ID`、Variablesの `WORKER_NAME`、`PAGES_PROJECT_NAME`、
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` を承認した本番用に整える。
  Worker・DB・R2・Pagesはリポジトリの本番設定と一致させる。任意の宛先へ上書きしない。
- `PRODUCTION_BACKUP_POLICY` と `PRODUCTION_BACKUP_KEY` をEnvironmentの秘密として準備する。
  前者は `bucket`（既存の非公開・バックアップ専用R2）、`prefix`（英数字等と末尾`/`）、
  `retentionDays`（承認した正の整数）、`approval`（承認記録の参照）のJSON。
  後者は専用の32バイト鍵を小文字hex64桁にしたもの。値は文書やログへ貼らない。
- R2の公開URLと公開カスタムドメインは無効、対象prefixの実際の削除ルールは
  承認した日数と一致、読み書きできる担当と消去日も承認する。既存の顧客画像用
  バケットは保管先に使えない。不明・未設定ならDB更新前に停止する。

バックアップはTime Travelの復元点とSQL exportを一緒にAES-256-GCMで暗号化し、
R2へ保存後に取り直して完全一致・復号を検証します。SQLや復元点、鍵はログや通常の
Actions artifactへ載せません。オブジェクト名は承認prefixに続く
`<公開SHA>-<run ID>-<run attempt>.enc`。復旧時は権限のある非公開端末で読み、
`backup.ts` の `decryptBackup` で復号したJSONの `bookmark` と `sql` を確認します。
復元の実行はデータの巻き戻り範囲を確認した別承認です。ここでは自動復元しません。
鍵の別保管と復旧訓練、R2のアクセス権・消去確認は公開前の運用工程に残します。

`workers_dev` の既存値、previewの既定、登録済みWebhook/LIFF/OAuth先は変えません。
workers.devを閉じる判断と登録先の棚卸し、HSTSのCloudflare側設定は公開前の別判断です。
JSON/401/404には現在の非公開キャッシュ・依頼番号等を確認し、HTML専用CSPを要求しません。
403/500は外部への故障を起こさず、手元の応答検査の試験で確認します。

手元の本番Workflow構造・故障対照・actionlintは次で実行します（配備はしません）。

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/security/test_production_workflows.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/security/check_production_workflows.py
bash scripts/security/lint-production-workflows.sh
```

設計確認の一次資料：[再利用WorkflowのEnvironmentと秘密](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)、
[R2の保存期限ルール](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/lifecycle/methods/get/)。

公開の版情報は生成されたWorker設定の `BUILD_GIT_COMMIT`・`BUILD_VERSION`・
`BUILD_RELEASED_AT` と管理画面の `APP_COMMIT_SHA` に注入します。追跡中のソースを
書き換えるstampは本番では使わず、DB更新・配備前の作業ツリーclean検査を保ちます。
