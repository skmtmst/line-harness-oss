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

## 2. 同意画面（Google 認証プラットフォーム）を確認する

**「APIとサービス」の中に「OAuth同意画面」というメニューはもう無い。** Googleが場所を変えて、**「Google 認証プラットフォーム」**（Google Auth Platform）という別のメニューに分かれた。左メニューの「APIとサービス」→「OAuth 同意画面」を探しても見つからないので、下のURLを直接開くのが一番早い。

| 見たいもの | 直接開くURL |
| --- | --- |
| 全体の状態 | `https://console.cloud.google.com/auth/overview` |
| アプリ名・ロゴ・各URL | `https://console.cloud.google.com/auth/branding` |
| 公開ステータス（テスト／本番）とテストユーザー | `https://console.cloud.google.com/auth/audience` |
| OAuthクライアント（手順3） | `https://console.cloud.google.com/auth/clients` |
| スコープ | `https://console.cloud.google.com/auth/scopes` |
| 審査の申請・デモ動画の提出 | `https://console.cloud.google.com/auth/verification` |

どのページでも、先に**上部のプロジェクト名**が目的の環境（検証用／本番用）になっているか確認する。

1. **「対象」ページ**（`/auth/audience`）を開く
   - **ユーザーの種類**：「外部」
   - **公開ステータス**：ここに「テスト」と出ていて、**「アプリを公開」**ボタンがある。公開ステータスを変える操作はこのページだけで、ブランディングやスコープのページには無い
   - **本番環境は必ず公開（本番環境）にする。** 「テスト」のままだと許可の有効期限が**7日**で切れ、7日ごとにお店の人が「再接続」をしないとGoogle連携が止まる（Googleの仕様で、こちらのコードでは回避できない）
   - 検証環境は「テスト」のままでよい。そのかわり7日ごとに再接続が必要になるのは想定どおり
   - 「テストユーザー」の一覧も**このページの下の方**にある。ここに**店舗を管理しているGoogleアカウント**を追加する（テストのままの環境で使う）
   - **公開ステータスを「本番環境」にすると、テストユーザーの欄そのものが画面から消える。** これは正常で、本番公開後はGoogleが認可の判定にテストユーザー一覧を使わないため。本番では全員が対象になる。テストユーザーを見たい・直したいときは、いったん「テストに戻る」を押す必要がある
2. **「データアクセス」ページ**（`/auth/scopes`）で、次の3つが入っているか確認。無ければ「スコープを追加または削除」から追加
   - `.../auth/business.manage` ← Googleの公式ドキュメントでは**機密スコープ**の扱いだが、**2026-10-08時点の本番プロジェクトのコンソールはこれを「非機密のスコープ」に表示している。** このページの「機密性の高いスコープ」は0件。食い違いの詳細と実機での確かめ方は `google-business-verification-application.md` 0-2章
   - `openid`
   - `.../auth/userinfo.email`

### 2-5. 本番を公開するときの審査（機密スコープの確認）

**まず審査が必要かどうかを確かめる。** `/auth/scopes` の「機密性の高いスコープ」に行があるかを見る。

- **行がある**（`business.manage` がここに入っている）→ 審査が必要。下の手順1〜7をそのまま進める
- **「表示する行がありません」で0件** → Googleはこのプロジェクトのスコープを非機密に分類している。確認センター（`/auth/verification`）に出すものが無く、申請ボタンも出ない。**下の手順1〜7は進められない。** 詳細は `google-business-verification-application.md` 0-2章

2026-10-08時点の本番プロジェクトは**後者（0件）**。**この日、一度もmusuboを接続したことがないGoogleアカウントで実機確認し、「このアプリは確認されていません」の警告も `Error 403: access_denied` も出ずに接続できた**（記録は同書類の0-3章）。表示と実際の動きが一致しているので、**審査の申請は不要**。利用者100人の上限も、未承認の機密スコープを要求していないため適用されない。

この章は、Googleが分類を機密へ戻した場合と、分類の申し立てが必要になった場合のために残している。次のどちらかを見つけたら読み直すこと — 接続時に「このアプリは確認されていません」が出る／`/auth/scopes` の「機密性の高いスコープ」に行が増える。

以下は審査が必要な場合の手順。`business.manage` が機密スコープのとき、**「アプリを公開」を押しただけでは終わらない**。Googleの確認（審査）を通さないと、同意画面に「このアプリは確認されていません」の警告が出たままになり、利用者は合計100人までに制限される。順番はこうなる。

1. **先にホームページとプライバシーポリシーを用意する**
   - ホームページは誰でも見られること（ログインの中は不可）。Playストアの掲載ページやSNSページは認められない
   - プライバシーポリシーは**ホームページと同じドメイン**に置き、Googleのユーザーデータをどう使い・保存し・共有するかを書く
2. **Google Search Console** で、そのドメインの所有権を確認しておく（Cloudプロジェクトのオーナー／編集者のGoogleアカウントで行う）
3. **「ブランディング」ページ**（`/auth/branding`）で、アプリ名・ロゴ・サポートメール・デベロッパーの連絡先・ホームページURI・プライバシーポリシーURIを入れて保存する（この時点では「下書き」）
4. 同じページの**「ブランド設定を確認」**を押す。自動審査は通常数分。審査中はブランディングを編集できない（直すには「キャンセル」）
5. 「公開準備完了」になったら**「ブランド設定を公開」**を押す。※この確認結果は**7日で期限切れ**になるので、通ったらすぐ公開する
6. **「確認センター」ページ**（`/auth/verification`）を開く（ブランディングを公開していないと、ここからデータアクセスの確認を申請できない）
   - 要求するスコープを全部宣言する
   - **機密スコープごとに「なぜ必要か」「なぜもっと狭いスコープでは足りないか」**を具体的に書く（例：お店のGoogleビジネス情報と口コミを読み、管理画面から返信を投稿するため）
   - **デモ動画のYouTubeリンク**を出す。YouTube Studioにアップロードし、公開設定は**「限定公開（Unlisted）」**。動画の中で、英語表示でのOAuth許可の流れ、同意画面にアプリ名が正しく出ること、ブラウザのアドレスバーにOAuthクライアントIDが写っていること、各機密スコープで何ができるようになるかを実演する
   - アプリの機能を説明したドキュメントのリンクを最大3件まで入れられる
7. 機密スコープの審査は**通常3〜5営業日**。Googleから追加の質問が来ることがあるので、「デベロッパーの連絡先」とサポート用メールの受信箱を見ておく。進行状況は「ブランディング」または「確認センター」で確認できる

**値（クライアントIDやシークレット）はチャット・Issue・PRに貼らないこと。**

## 3. OAuthクライアントを作る（検証用）
1. **「クライアント」ページ**（`https://console.cloud.google.com/auth/clients`）→「クライアントを作成」。「APIとサービス」→「認証情報」から入っても同じクライアント一覧に着く
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

## 6. 実運用環境のクライアントを作る（2026-10-04 追加）

Googleの機密スコープ審査のデモ動画は `admin.musubo.jp`（実運用）で撮る。そのため実運用でも
Googleビジネス機能を有効にしている。検証用クライアントは**流用しない**。

1. 「クライアント」ページで**新しいクライアントを作成**。名前は `musubo LINE管理 本番環境`
2. 承認済みのリダイレクトURIは、次の**1行だけ**にする
   ```
   https://api.musubo.jp/api/restaurant-test/google/oauth/callback
   ```
   スプレッドシート連携のコールバック
   （`https://api.musubo.jp/api/integrations/google-sheets/oauth/callback`）は
   **このクライアントに登録しない。** 理由は下の「Googleスプレッドシート連携との兼ね合い」を参照。
3. **クライアントIDもシークレットも、設定ファイル・チャット・Issue・PRには書かない。**
   実運用環境では両方をWorkerのシークレットとして本人のターミナルから入れる。
   （検証環境はIDを `[vars]` に置いているが、実運用では値を会話に出さずに済む
   シークレット登録のほうを使う。コード側は `env` から読むので動きは同じ）

   ```
   pnpm exec wrangler secret put GOOGLE_BUSINESS_OAUTH_CLIENT_ID
   pnpm exec wrangler secret put GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET
   ```

4. `apps/worker/wrangler.toml` 側は `RESTAURANT_TEST_ENABLED = "true"` と
   `GOOGLE_BUSINESS_WRITE_ENABLED = "true"`（設定済み）。
5. 管理画面の左メニュー「Googleビジネス」は**ビルド時の値**で出る。
   `.github/workflows/deploy-cloudflare-admin.yml` の
   `NEXT_PUBLIC_RESTAURANT_TEST_ENABLED: 'true'`（設定済み）で管理画面を**再ビルド・再配備**
   しないと、APIだけ有効で画面が無い状態になる。
6. 「対象」ページ（`/auth/audience`）の公開ステータスが「テスト」のままだと7日で認可が切れる。
   審査提出後、通ったら「アプリを公開」にする。

### Googleスプレッドシート連携との兼ね合い

`apps/worker/src/services/google-sheets.ts:113-135` は `GOOGLE_SHEETS_OAUTH_CLIENT_ID` /
`..._SECRET` が無いとき、**Googleビジネス側のクライアントへ自動で切り替える**
（IDとシークレットは必ず同じ組で使う実装）。実運用には現在Sheets用の値を入れていない。

このため、手順3でビジネス用のクライアントを入れると、スプレッドシート連携の画面は
「設定済み」と表示される。**手順2でSheetsのコールバックURLを登録しないのは、この経路で
審査対象のクライアントが `https://www.googleapis.com/auth/spreadsheets`（機密スコープ）を
要求できる状態を作らないため。** 登録が無ければ、Googleは同意画面を出す前に
`redirect_uri_mismatch` で止めるので、審査を通したクライアントが申請した3つ以外の
スコープを取得することはない。申請文
（`docs/manuals/google-business-verification-application.md` 2章）の
「要求するスコープは3つだけ」という説明は、この登録状態に依存している。

- 実運用でスプレッドシート連携の画面を開くと「設定済み」と出るが、接続を押すと
  `redirect_uri_mismatch` になる。これは上記のとおり**意図した状態**で、不具合ではない。
  この画面を開けるのは全店スコープの統括管理者だけ。
- Sheets連携を実運用で使う日が来たら、専用の `GOOGLE_SHEETS_OAUTH_CLIENT_ID` /
  `..._SECRET` を**別のクライアントとして**作り、Sheetsのコールバックはそちらにだけ登録する。
  同意画面に登録するスコープはGoogleプロジェクト単位なので、`spreadsheets` を足すときは
  Googleビジネスの審査が通ったあとに、追加するスコープの申請理由も用意して行う。
- 検証環境（`wrangler.staging.toml`）は審査対象ではないため、現在の共用のままでよい。
  手順は `docs/manuals/google-sheets-oauth-setup.md`。

## 困ったとき
- 「この環境にはGoogle接続の設定がありません」→ 手順4のクライアントID／シークレットが未設定
- Googleの画面で「アクセスをブロック：このアプリのリクエストは無効です／エラー400: redirect_uri_mismatch」→ 手順3-5のURIが1文字でも違う。上の表の `WORKER_PUBLIC_URL` と見比べてコピーし直す。Workerの公開URLを変えたときは、ここも必ず合わせて直す
- 「アクセスをブロック：このアプリは確認されていません」→ 公開ステータスが「テスト」なら、「対象」ページ（`/auth/audience`）のテストユーザーにログインしたアカウントが入っていない。**公開ステータスが「本番環境」なのにこれが出る場合はテストユーザーの問題ではなく、Googleが未確認アプリとして扱っている**ので `google-business-verification-application.md` 0-2章の表を見る
- 「認可切れ」が7日ごとに出る → 手順2-1のとおり、公開ステータスが「テスト」のときのGoogleの仕様。本番環境では「対象」ページで「アプリを公開」にする（**本番プロジェクトは2026-10-08時点で公開済み。この失効要因は解消している**）
- 「テストユーザー」の欄が見つからない → 公開ステータスが「本番環境」のときは欄ごと消える。手順2-1のとおりで異常ではない
- 「確認センター」に申請ボタン（「管理権限申請」「Request verification」）が出ない → `/auth/scopes` の「機密性の高いスコープ」が0件だと申請対象が無いため出ない。手順2-5の先頭を見る
- 「OAuth同意画面」のメニューが見つからない → Googleが「Google 認証プラットフォーム」へ移した。手順2の表のURLを直接開く
- API詳細ページ（`mybusiness.googleapis.com` の「指標」「割り当て」が並ぶ画面）に申請の導線を探さないこと。あのページは利用状況と認証情報だけで、審査の申請はできない

## 認可を切らさないための仕組み（実装済み）
- リダイレクトURIは環境ごとの `WORKER_PUBLIC_URL` に固定している。管理画面を `*.pages.dev` で開いても、独自ドメインで開いても、Googleへ送るURIは1つだけ（`redirect_uri_mismatch` が起きない）
- 6時間ごとの `google business token keepalive` が、リフレッシュトークンを持つ接続を全部使って更新する。場所を選ぶ前の店舗や、Googleビジネス機能を一時的にoffにしている店舗も対象。Googleの「長く使われないトークンは無効化」を避けるため
- それでも切れた場合（お店の人がGoogle側で許可を取り消した、パスワードを変えた等）は、画面に「再接続してください」が出る。口コミの下書きなど保存済みのデータは消えない
- **残る失効要因は公開ステータス「テスト」の7日だけ。本番では「対象」ページで公開にすること**（本番プロジェクトは2026-10-08時点で「本番環境」になっており、この失効要因は解消している。検証環境は「テスト」のままなので7日ごとの再接続が必要）
