# 手順書：Googleスプレッドシート連携のためのGoogle Cloud設定（検証環境用）

対象：運営（Google Cloud管理画面の操作）。Googleビジネス連携と同じGoogle Cloudプロジェクトを使う。
所要時間：15〜20分。**値（クライアントIDやシークレット）はチャット・Issue・PRに貼らないこと。**

## 0. 用意するもの
- Google Cloud コンソール https://console.cloud.google.com/ にログインできるGoogleアカウント（対象プロジェクトのオーナーまたは編集者）
- 検証環境のURL（`apps/worker/wrangler.staging.toml` の `WORKER_PUBLIC_URL` / `ADMIN_PUBLIC_URL`）：
  - Worker：`https://nen-line-stg.skmtmst.workers.dev`
  - 管理画面：`https://nen-line-stg-admin.pages.dev`

## 1. APIを有効にする
1. 画面上部の検索窓に「APIとサービス」と入れて開く → 左メニュー「ライブラリ」
2. **Google Sheets API** を検索して「有効にする」を押す
3. すでに「管理」と出ていれば有効済み

## 2. OAuth同意画面を確認する
1. 「APIとサービス」→「OAuth同意画面」（Googleビジネス連携で設定済みのものを共用する）
2. **ユーザーの種類**：「外部」
3. **公開ステータス**：いまは「テスト」のままで進める。テストのままだと許可の有効期限が**7日**で切れ、7日ごとに「再接続」が必要になる（仕様）。本番前に「本番環境に公開」へ切り替え、Googleの審査を受ける
4. 「テストユーザー」に、**スプレッドシートを管理しているGoogleアカウント**を追加する
5. 「スコープ」に次の3つが入っているか確認。無ければ「スコープを追加または削除」から追加
   - `.../auth/spreadsheets`
   - `openid`
   - `.../auth/userinfo.email`

## 3. OAuthクライアントを作る（検証用）
1. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」
2. **アプリケーションの種類**：「ウェブ アプリケーション」
3. **名前**：`musubo LINE管理 Sheets 検証環境`（本番用は別に作る。混ぜない）
4. **承認済みのJavaScript生成元**：空でよい
5. **承認済みのリダイレクトURI**に、次の1行を**そのまま**追加
   ```
   https://nen-line-stg.skmtmst.workers.dev/api/integrations/google-sheets/oauth/callback
   ```
6. 「作成」→ 表示された**クライアントID**と**クライアントシークレット**を控える（「認証情報」から再表示できる）

## 4. 検証環境のWorkerに値を入れる
`apps/worker` で、シークレットだけを本人のターミナルから入れる（値を聞かれたら貼り付けてEnter）。

```
pnpm exec wrangler secret put GOOGLE_SHEETS_OAUTH_CLIENT_SECRET --config wrangler.staging.toml
```

クライアントIDは秘密値ではないので、`wrangler.staging.toml` の `[vars]` に追記する。

```
GOOGLE_SHEETS_OAUTH_CLIENT_ID = "<クライアントID>"
```

追記したら検証環境へ再配備する（GitHub Actions「Deploy Cloudflare Staging」を `mode=apply` で実行、または担当者に依頼）。

## 5. 動作確認の順番（検証環境）
1. 管理画面で対象のLINEアカウントを選び、左メニュー「外部連携」→「Google Sheets」タブ→「Googleアカウントを接続」
2. Googleの画面で、スプレッドシートを管理しているアカウントでログインして「許可」
3. 「接続済み」になり、Googleアカウントのメールが表示される
4. 書き出し先のスプレッドシートのURL（またはID）を入れて保存 → 実際にそのシートが存在し、操作できる場合だけ保存される
5. 「いま同期する」→ シートに「友だち」「回答」タブが作られ、データが書き込まれることを確認
6. 2回目の同期で行が増殖しないこと（同じ友だち・回答は上書き）を確認
7. 「接続を解除」で連携解除できること、解除後は同期が止まることを確認

## 困ったとき
- 「この環境にはGoogle接続の設定がありません」→ 手順4のクライアントID／シークレットが未設定、または再配備前
- Googleの画面で「redirect_uri_mismatch」→ 手順3-5のURIが1文字でも違う。コピーし直す
- 「アクセスをブロック：このアプリは確認されていません」→ 手順2-4のテストユーザーに、ログインしたアカウントが入っていない
- 「認可切れ」が7日ごとに出る → 手順2-3のとおり仕様。本番前に公開ステータスを変える
- スプレッドシートのURLを保存しようとして「開けません」→ ログインしたGoogleアカウントがそのシートを編集できるか、Google側で確認する
