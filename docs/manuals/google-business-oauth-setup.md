# 手順書：Googleビジネス接続のためのGoogle Cloud設定（検証環境用）

対象：運営（Google Cloud管理画面の操作）。Business Profile API のallowlist承認済みのGoogle Cloudプロジェクトを使う。
所要時間：15〜20分。**値（クライアントIDやシークレット）はチャット・Issue・PRに貼らないこと。**

## 0. 用意するもの
- Google Cloud コンソール https://console.cloud.google.com/ にログインできるGoogleアカウント（対象プロジェクトのオーナーまたは編集者）
- 検証環境のURL（`apps/worker/wrangler.staging.toml` の `WORKER_PUBLIC_URL` / `ADMIN_PUBLIC_URL`）：
  - Worker：`https://nen-line-stg.skmtmst.workers.dev`
  - 管理画面：`https://nen-line-stg-admin.pages.dev`

## 1. APIを有効にする（3つ）
1. 画面上部の検索窓に「APIとサービス」と入れて開く → 左メニュー「ライブラリ」
2. 次の3つを順に検索して、それぞれ「有効にする」を押す
   - **My Business Account Management API**
   - **My Business Business Information API**
   - **Google My Business API**（口コミ用。表示名が「My Business API」の場合もある）
3. すでに「管理」と出ていれば有効済み

## 2. OAuth同意画面を確認する
1. 「APIとサービス」→「OAuth同意画面」
2. **ユーザーの種類**：「外部」
3. **公開ステータス**：いまは「テスト」のままで進める。テストのままだと許可の有効期限が**7日**で切れ、7日ごとに「再接続」が必要になる（仕様）。本番前に「本番環境に公開」へ切り替え、Googleの審査を受ける
4. 「テストユーザー」に、**店舗を管理しているGoogleアカウント**を追加する
5. 「スコープ」に次の3つが入っているか確認。無ければ「スコープを追加または削除」から追加
   - `.../auth/business.manage`
   - `openid`
   - `.../auth/userinfo.email`

## 3. OAuthクライアントを作る（検証用）
1. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」
2. **アプリケーションの種類**：「ウェブ アプリケーション」
3. **名前**：`musubo LINE管理 検証環境`（本番用は別に作る。混ぜない）
4. **承認済みのJavaScript生成元**：空でよい
5. **承認済みのリダイレクトURI**に、次の1行を**そのまま**追加
   ```
   https://nen-line-stg.skmtmst.workers.dev/api/restaurant-test/google/oauth/callback
   ```
6. 「作成」→ 表示された**クライアントID**と**クライアントシークレット**を控える（「認証情報」から再表示できる）

## 4. 検証環境のWorkerに値を入れる
`apps/worker` で、シークレットだけを本人のターミナルから入れる（値を聞かれたら貼り付けてEnter）。

```
pnpm exec wrangler secret put GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET --config wrangler.staging.toml
```

クライアントIDと書き込み許可は秘密値ではないので、`wrangler.staging.toml` の `[vars]` に追記する。

```
GOOGLE_BUSINESS_OAUTH_CLIENT_ID = "<クライアントID>"
GOOGLE_BUSINESS_WRITE_ENABLED = "false"
```

`GOOGLE_BUSINESS_WRITE_ENABLED` を `"true"` にすると、検証環境から**実店舗のGoogle口コミへ本当に返信が公開される**。最初は `"false"` で接続と取得だけを試し、公開のテストをする日だけ `"true"` にする。

## 5. 動作確認の順番（検証環境）
1. 管理画面で店舗のLINEアカウントを選び、左メニュー「Googleビジネス」→「設定」→「Googleアカウントを接続」
2. Googleの画面で、店舗を管理しているアカウントでログインして「許可」
3. 「接続済み」になり、店舗名とGoogleアカウントのメールが表示される
4. 「口コミ」タブで「同期する」→ 件数と総合評価がGoogleの管理画面と一致するか見る
5. 口コミを1件開き、「AIで下書きを作る」→ 文章を直す → 「下書き保存」（ここまではGoogleに何も送らない）
6. 公開のテストをする日：`GOOGLE_BUSINESS_WRITE_ENABLED="true"` にして再配備 → 「返信内容を確認」→ チェックを入れて「この内容で返信する」→ Googleの管理画面で返信が見えることを確認 → 必要ならGoogle側で返信を削除

## 困ったとき
- 「この環境にはGoogle接続の設定がありません」→ 手順4のクライアントID／シークレットが未設定
- Googleの画面で「redirect_uri_mismatch」→ 手順3-5のURIが1文字でも違う。コピーし直す
- 「アクセスをブロック：このアプリは確認されていません」→ 手順2-4のテストユーザーに、ログインしたアカウントが入っていない
- 「認可切れ」が7日ごとに出る → 手順2-3のとおり仕様。本番前に公開ステータスを変える
