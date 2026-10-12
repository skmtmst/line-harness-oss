# Instagram 接続台帳

Instagram同時投稿の接続について、**済んだこと・証拠・原因・残り・次の1手**を1か所に集めた記録です。
2026-10-12のAPI接続開発の共通ルールに従います。

- 手順の文書 … <../instagram-meta-app-setup.md>（アプリの作り方）
  / <../instagram-production-rollout.md>（本番へ広げる）
  / <../instagram-app-review.md>（審査）

## 接続の方式（確定）

| 項目 | 値 |
| --- | --- |
| 方式 | **Instagram API with Instagram Login**（Instagramへ直接ログイン） |
| Facebookページ | **使わない**（ページの一覧を読む処理は無い） |
| 認可の入口 | `https://www.instagram.com/oauth/authorize` |
| APIの土台 | `https://graph.instagram.com` |
| APIの版 | `v24.0` |
| 求める許可 | `instagram_business_basic` / `instagram_business_content_publish` |
| 実装 | `apps/worker/src/services/instagram.ts` / `apps/worker/src/routes/instagram.ts` |

> **以前はFacebookログイン方式でした。** ページを持たない店舗では必ず失敗するため、
> コミット `4e937a8d40`「fix(worker): InstagramをFacebookページ不要の直接ログイン方式へ作り直す」で
> 作り直しています。この日付より前の文書・記録は方式が古いものとして読んでください。

## 設定キーの対応（間違えやすいところ）

| キー | 何に使うか | 種別 | 誰が登録するか |
| --- | --- | --- | --- |
| `INSTAGRAM_APP_ID` | 接続（必須） | Worker secret | **利用者のみ**。値は開発側が保持しない |
| `INSTAGRAM_APP_SECRET` | 接続（必須） | Worker secret | **利用者のみ**。値は開発側が保持しない |
| `META_TOKEN_ENCRYPTION_KEY` | 預かりトークンの暗号化（必須） | Worker secret | 開発側が乱数生成（32バイト→base64） |
| `META_REDIRECT_URI` | 折り返し先（必須） | `[vars]` | 設定ファイル |
| `META_GRAPH_API_VERSION` | APIの版（必須） | `[vars]` | 設定ファイル |
| `META_APP_SECRET` | **DM受信Webhookの署名確認だけ** | Worker secret | 同時投稿では読まない |
| `META_WEBHOOK_VERIFY_TOKEN` | DM受信Webhookの登録確認だけ | Worker secret | 同時投稿では不要 |

- 上の**5つが全部そろい、かつ形も正しいときだけ** `instagramConfig()` が値を返します。
  1つでも欠けると画面は「設定がありません」のままです。
- 形の決まり … 版は `/^v\d+\.\d+$/`、鍵はbase64を戻してちょうど32バイト、
  折り返し先は `https:` で `?` `#` 認証情報なし。
- **`INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` を `[vars]` に書かないこと。**
  同名の `[vars]` はWorker secretsを上書きします。
- `META_APP_ID` / `META_APP_SECRET` は名前が似ていますが**接続では読んでいません**。
  以前の案内でこの名前を登録した環境がありますが、消す必要はありません。

## 済んだこと（検証環境・証拠つき）

| 日付 | 操作 | 結果 | 証拠 |
| --- | --- | --- | --- |
| 2026-10-12 | 利用者がMetaのアプリを作成し、`INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` を `nen-line-stg` へ登録 | 成功 | 画面が「設定がありません」→「未接続」へ変化 |
| 2026-10-12 | 検証環境へ `META_REDIRECT_URI` / `META_GRAPH_API_VERSION` / `META_TOKEN_ENCRYPTION_KEY` を反映 | 成功 | `wrangler.staging.toml` 81〜82行目＋Worker secret |
| 2026-10-12 | 実機でInstagramログイン→許可→接続（`stg-admin.musubo.jp` → 設定 → SNS連携） | **成功**（利用者回答） | 画面が「接続しています」＋ `@ユーザー名（ビジネス）` |
| 2026-10-12 | 許可の取り直し（`force_reauth=true`）の修正を配備 | 成功 | PR #1708 マージ・staging配備済み |

### 原因が判明した不具合（記録）

| 症状 | 原因 | 直し方 |
| --- | --- | --- |
| 許可を押しても必ず「同時投稿の許可がありません」 | 一度与えた許可が再認可で再提示されず、`instagram_business_content_publish` が付かない | 認可の入口に `force_reauth=true` を付けた（PR #1708） |
| ページを持たない店舗で必ず失敗 | Facebookログイン方式でページ一覧を読んでいた | Instagram直接ログイン方式へ作り直し（`4e937a8d40`） |

## 残っていること（本番）

| 項目 | 担当 | 状態 |
| --- | --- | --- |
| Meta側 OAuthリダイレクトURI に `https://api.musubo.jp/api/instagram/oauth/callback` を追記 | **利用者** | 未 |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` を Worker `nen-line` へ登録 | **利用者** | 未 |
| `META_TOKEN_ENCRYPTION_KEY` を Worker `nen-line` へ登録（新しい乱数） | Codex | 未 |
| `apps/worker/wrangler.toml` の `META_REDIRECT_URI` / `META_GRAPH_API_VERSION` | Claude | **設定ファイルへ追加済み**・`main` 反映と配備待ち |
| **本番ブランチ `main` へInstagramのぶんを反映**（PR） | Codex（運搬） | 未。**masatoの承認が必要**（`docs/DEPLOY-GATE.md:43`） |
| 本番D1 `nen-line` へ移行 603 を適用（表3つ＋索引1を新規作成） | Codex | 未 |
| 本番D1 `nen-line` へ移行 611 を適用（**既存** `rt_google_posts` へ7列・`instagram_connections` へ1列を追加） | Codex | 未 |
| 移行611の1行目「本番には適用しない」という書き置きを現在の承認状態へ書き直す（SQLは変更しない） | Codex（`packages/db/` の所有） | 未。`main` 向けPRの中で |
| 本番配備（**必ず移行のあと**） | Codex | 未 |
| 本番の管理画面にSNS連携の画面が無い（V8が `main` 未反映） | 利用者のご判断 | **Dに決定（2026-10-12）**。裏側だけ先に整え、画面は検証環境のまま使う |
| 本番の管理画面で実際につなぐ | **利用者** | **見送り**（判断D）。新しい管理画面が `main` へ出る回で自動的に使えるようになる |
| 本番で同時投稿を1件試す | **利用者**＋結果確認 | **見送り**（判断D）。接続・録画は `stg-admin.musubo.jp` で行う |

### 本番反映で分かった2つの食い違い（2026-10-12・Codexの検証で判明）

1. **移行611は既存の表を変更します。** 当初の引き継ぎと手順書には
   「既存の表は触らない」とありましたが誤りでした。611は既存の `rt_google_posts` へ7列、
   `instagram_connections` へ1列を追加します。すべて空を許すか既定値つきで、
   `CONTRIBUTING.md` の Migration Policy で認められた追加操作の範囲内です。
   既にある行のデータは書き換えません。
2. **本番は `main` から配備しますが、`main` にInstagramのぶんが1つも入っていません。**
   移行603・611、`services/instagram.ts`、`routes/instagram.ts`、
   `packages/shared/src/instagram.ts`、`META_*` の設定、いずれも未反映です。
   さらに新しい管理画面（V8、1,138ファイル）も `main` には0ファイルで、
   「設定 → SNS連携」の画面自体が本番にありません。

本番D1の「101件が未適用」という判定は、放置や損傷ではなく
`codex/development` と `main` の差（103件）そのものです。本番D1は `main` と揃っています。
今回の対象は603・611の2件だけで、まとめて当てる経路（`migrate.ts apply production`）は
ファイル指定ができないため使いません。603・611を個別に当てます。
詳細と順番は<../instagram-production-rollout.md>の手順4〜6にあります。

## 残っていること（審査・他の店舗まで広げる）

| 項目 | 担当 | 状態 |
| --- | --- | --- |
| ビジネス認証（法人書類） | **利用者**（代行不可） | 未 |
| プライバシーポリシーへInstagramの節を追記 | Claude（文案）→利用者が公開判断 | **文案作成済み**（<../instagram-privacy-section-draft.md>）。公開はご判断待ち |
| 操作の録画（11項目） | **利用者の操作** | 未。判断Dにより**検証環境 `stg-admin.musubo.jp` で撮る** |
| 審査用ログイン（オーナー／管理者） | Claude＋利用者確認 | 未 |
| 申請の送信 | **利用者** | 未 |

## 次の1手

**裏側を順番に整えること**（`main` への反映 → 移行603 → 移行611 → Worker配備）。
2026-10-12のご判断は**D（先に裏側だけ整える）**です。本番の見た目は変えず、
Instagramの接続操作と審査用の録画は検証環境（`stg-admin.musubo.jp`）で続けます。
新しい管理画面（V8）が別の回で `main` へ出るとき、Instagramの画面も自動でそろいます。

この順番は守る必要があります。`restaurant-google-posts.ts` が611の列を無条件に読み書きし、
本番ではGoogleビジネスの投稿が既に動いているためです。

`main` への反映は**枝のマージではなく内容の移植**です。`codex/development` と `main` は
`apps/worker/src` だけで896ファイル・84,505行、`packages/shared/src` で80ファイル・3,548行
離れており（7,608コミット）、枝ごとマージすると未検証の変更が本番へ入ります。
Instagramに必要なぶんだけを選んで `main` 向けPRにします。
詳細は<../instagram-production-rollout.md>の手順4にあります。

審査（アドバンスアクセス）は本番で1件つないで録画できるようになってから出します。
本番運用そのものはスタンダードアクセスの範囲なので、審査の結果を待つ必要はありません。

## やらないこと（停止条件）

- `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` / `META_APP_ID` / `META_APP_SECRET` の値は
  開発側（Claude・Codex）が保持しません。推測・自作・再登録をしません。
- 秘密値は会話・記録・リポジトリ・引き継ぎ本文に書きません。
- 暗号化トークン列（`page_token_encrypted` / `user_token_encrypted`）と行の全文は
  読み出しません。確認は「許可名が含まれるか」「時刻が直近か」の はい/いいえ だけにします。
- モックの成功だけで「接続できた」と言いません。実機の接続結果を証拠にします。
