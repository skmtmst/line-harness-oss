# 手順書：Googleビジネス接続のためのGoogle Cloud設定（検証環境用）

対象：運営（Google Cloud管理画面の操作）。Business Profile API のallowlist承認済みのGoogle Cloudプロジェクトを使う。
所要時間：15〜20分。**値（クライアントIDやシークレット）はチャット・Issue・PRに貼らないこと。**

## 0. 用意するもの
- Google Cloud コンソール https://console.cloud.google.com/ にログインできるGoogleアカウント（対象プロジェクトのオーナーまたは編集者）
- 各環境のURL（`apps/worker/wrangler*.toml` の `WORKER_PUBLIC_URL` / `ADMIN_PUBLIC_URL`）：

  | 環境 | Worker（`WORKER_PUBLIC_URL`） | 管理画面 |
  | --- | --- | --- |
  | 検証 | `https://stg-api.musubo.jp` | `https://stg-admin.musubo.jp` |
  | 本番 | `https://api.musubo.jp` | `https://admin.musubo.jp` |

  リダイレクトURIはこの `WORKER_PUBLIC_URL` だけを使う（コードもここから組み立てる）。
  `*.workers.dev` や `*.pages.dev` で管理画面を開いた場合も、送られるURIは上の表のまま変わらない。

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
3. **公開ステータス**：
   - **本番環境は必ず「本番環境に公開」にする。** 「テスト」のままだと許可の有効期限が**7日**で切れ、7日ごとにお店の人が「再接続」をしないとGoogle連携が止まる（Googleの仕様で、こちらのコードでは回避できない）。公開に切り替えるとGoogleの審査が入るので、本番開始の前に余裕をもって申請する
   - 検証環境は「テスト」のままでよい。そのかわり7日ごとに再接続が必要になるのは想定どおり
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
5. **承認済みのリダイレクトURI**に、使う環境の1行を**そのまま**追加
   - 検証環境用のクライアント
     ```
     https://stg-api.musubo.jp/api/restaurant-test/google/oauth/callback
     ```
   - 本番環境用のクライアント（別に作る）
     ```
     https://api.musubo.jp/api/restaurant-test/google/oauth/callback
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
- Googleの画面で「アクセスをブロック：このアプリのリクエストは無効です／エラー400: redirect_uri_mismatch」→ 手順3-5のURIが1文字でも違う。上の表の `WORKER_PUBLIC_URL` と見比べてコピーし直す。Workerの公開URLを変えたときは、ここも必ず合わせて直す
- 「アクセスをブロック：このアプリは確認されていません」→ 手順2-4のテストユーザーに、ログインしたアカウントが入っていない
- 「認可切れ」が7日ごとに出る → 手順2-3のとおり、公開ステータスが「テスト」のときのGoogleの仕様。本番環境では「本番環境に公開」にしておくこと

## 認可を切らさないための仕組み（実装済み）
- リダイレクトURIは環境ごとの `WORKER_PUBLIC_URL` に固定している。管理画面を `*.pages.dev` で開いても、独自ドメインで開いても、Googleへ送るURIは1つだけ（`redirect_uri_mismatch` が起きない）
- 6時間ごとの `google business token keepalive` が、リフレッシュトークンを持つ接続を全部使って更新する。場所を選ぶ前の店舗や、Googleビジネス機能を一時的にoffにしている店舗も対象。Googleの「長く使われないトークンは無効化」を避けるため
- それでも切れた場合（お店の人がGoogle側で許可を取り消した、パスワードを変えた等）は、画面に「再接続してください」が出る。口コミの下書きなど保存済みのデータは消えない
- **残る失効要因は公開ステータス「テスト」の7日だけ。本番では必ず公開にすること**
