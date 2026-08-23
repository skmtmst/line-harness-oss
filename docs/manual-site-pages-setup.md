# musubo マニュアルサイトのCloudflare Pages初回設定

## この手順の対象

`apps/docs` から生成した静的ファイルを、検証用の `*.pages.dev` で確認するための初回設定です。`musubo.jp` のカスタムドメイン設定は行いません。

## 1. Pagesプロジェクトを作成する

Cloudflare Dashboardの **Workers & Pages** から、Direct Upload方式のPagesプロジェクトをMasatoが作成します。

- 推奨プロジェクト名: `musubo-manual-stg`
- カスタムドメイン: 設定しない

プロジェクト名はGitHub Actionsへ渡すための値です。命名規則を変更する場合でも、コード修正は不要です。

## 2. GitHubのstaging EnvironmentへSecretsを登録する

GitHubの **Settings → Environments → staging → Environment secrets** に、次の名前を登録します。値をPR、Issue、チャットへ書きません。

- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`
- `PAGES_DOCS_PROJECT_NAME`

Cloudflare API Tokenには、対象アカウントのPagesをデプロイするために必要な最小権限だけを付与します。ワークフローは既存のSecret名を参照し、Wranglerが認識する `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 環境変数へ値を渡します。

登録後、GitHubの **Settings → Secrets and variables → Actions → Variables** で `PAGES_DOCS_DEPLOY_ENABLED` を `true` にします。これは秘密値ではなく、PagesプロジェクトとSecretsが揃うまで誤配備を防ぐDocs専用の安全スイッチです。Worker・管理画面の配備に使う全体ゲート `LINE_HARNESS_CLOUDFLARE_DEPLOY` は参照せず、未設定のまま維持します。

## 3. 検証用デプロイを実行する

`codex/development` への反映時に作成された **Deploy Cloudflare Docs (Staging)** の実行を、GitHub Actionsから再実行します。ワークフローが `main` にも入った後は、**Run workflow** から `codex/development` を選んで手動実行できます。ワークフローは `apps/docs/out` の生成と検証が成功した後だけ、Pagesへアップロードします。

## 4. 表示を確認する

Cloudflare Dashboardに表示される `*.pages.dev` のURLで、次を確認します。

- トップページにマニュアル一覧が表示される
- `/manual/line-account-setup/` に記事テンプレートが表示される
- 存在しないURLで404ページが表示される
- スマートフォン幅で横スクロールせず読める

## DNSを扱う後続工程について

`musubo.jp` のカスタムドメイン割り当ては、記事と公開方針が確定してから別の承認作業として行います。既存のメール受信用MXレコード3本とSPFのTXTレコードは、削除・変更しません。
