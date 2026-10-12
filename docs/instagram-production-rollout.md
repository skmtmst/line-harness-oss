# Instagram同時投稿を本番へ広げる手順

検証環境（`stg-api.musubo.jp`）で動いているInstagram同時投稿を、
本番（`api.musubo.jp` / `admin.musubo.jp`）でも使えるようにする手順です。

アプリの作り方そのものは<./instagram-meta-app-setup.md>にあります。
この文書は**本番へ広げるぶんだけ**を書いています。

## 前提（2026-10-12 ご本人の判断）

- **Metaのアプリは新しく作りません。** 検証環境で使っている既存のアプリをそのまま使います。
- まず**ご本人のInstagramアカウントで本番を動かし**、他の店舗まで広げるためのMetaの審査は
  同時並行で出します（審査の中身は<./instagram-app-review.md>）。
- 接続の方式は**Instagramに直接ログインする方式**です。Facebookページは使いません。

## 全体の流れ

```text
1. Meta側に本番の折り返し先URLを追記            ← ご本人
2. 本番Workerへ秘密値を登録                     ← ご本人2件 ＋ こちら1件
3. 本番の設定ファイル（済み。配備で有効になる）  ← こちら
4. 本番ブランチ main へInstagramのぶんを反映     ← こちら（masatoの承認が必要）
5. 本番DBへ移行を当てる（603 → 611）            ← こちら
6. 本番Workerを配備                             ← こちら（必ず5のあと）
7. 本番の管理画面で実際につなぐ                  ← ご本人
8. 同時投稿を1件試す                             ← ご本人＋こちらで結果確認
```

> **7・8は、いまの本番の管理画面では進められません。**
> 本番の管理画面に「設定 → SNS連携」と「Instagramにも投稿する」の画面が
> まだ入っていないためです。理由と選べる道は「いまの本番の管理画面には画面がない」の節に
> まとめました。1〜6（お店の裏側の仕組み）はそれと関係なく進められます。

## 手順1：Meta側に本番の折り返し先URLを追記する（ご本人）

<https://developers.facebook.com/> → 既存のアプリ →
「**InstagramログインによるAPI設定**」→「Instagramビジネスログインを設定する」→
「**ビジネスログインの設定**」→「**OAuthリダイレクトURI**」。

いま検証環境のURLが1行入っています。**それを消さずに、もう1行足してください。**

```text
https://api.musubo.jp/api/instagram/oauth/callback
```

結果、2行が並んだ状態になります。

```text
https://stg-api.musubo.jp/api/instagram/oauth/callback   ← 検証環境（そのまま残す）
https://api.musubo.jp/api/instagram/oauth/callback       ← 本番（今回足すぶん）
```

> **1文字でも違うとMetaが接続を拒否します。** 上の行をコピーして貼ってください。
> `stg-` が付いていないほうが本番です。末尾に `/` を足さないでください。

検証環境の行を消すと、検証環境での確認ができなくなります。両方残してください。

## 手順2：本番Workerへ秘密値を登録する

本番Worker（**`nen-line`**）に、次の3つが必要です。

| 名前 | 中身 | 誰が入れるか |
| --- | --- | --- |
| `INSTAGRAM_APP_ID` | Metaの「Instagramアプリ ID」。**検証環境と同じ値** | **ご本人** |
| `INSTAGRAM_APP_SECRET` | Metaの「Instagram app secret」。**検証環境と同じ値** | **ご本人** |
| `META_TOKEN_ENCRYPTION_KEY` | トークンを暗号化して預かる鍵。32バイトの乱数をbase64にしたもの | こちら |

### ご本人にお願いする2件

アプリIDとシークレットは**ご本人だけが持っている値**です。
こちらは値を保持していないため、推測も再登録もできません。貼り付けをお願いします。

入れる場所：

```text
Cloudflareダッシュボード
  → Workers & Pages
  → nen-line            ← 「nen-line-stg」ではありません。stg の付かないほうです
  → Settings
  → Variables and Secrets
  → 「Add」
  → Type は「Secret」を選ぶ     ← ここを「Text」にしないでください
  → Name に上の表の名前、Value にMetaからコピーした値
  → Deploy
```

検証環境（`nen-line-stg`）に登録済みの値と**同じものを**本番（`nen-line`）にも入れます。
Metaの画面から改めてコピーしても、同じ値になります。

> **名前は1文字も変えないでください。** 仕組みはこの名前でしか値を読みません。
> 値そのものは、この文書にも、やりとりにも、記録にも書きません。

### こちらで入れる1件

`META_TOKEN_ENCRYPTION_KEY` は、こちらで新しく乱数から作って本番へ登録します。
Metaとは関係ない値で、ご本人の操作は要りません。
**検証環境の鍵とは別の値**にします（環境ごとに分けるのが安全です）。

### 鍵を分けると何が起きるか

検証環境で預かっている接続（トークン）は、本番の鍵では読めません。
そのため**本番では改めて［Instagramにログインして接続］を押す必要があります**（手順5）。
これは正常な動きです。検証環境の接続はそのまま残ります。

## 手順3：本番の設定ファイル（済み）

`apps/worker/wrangler.toml` に、次の2行を**追加済み**です。

```toml
META_GRAPH_API_VERSION = "v24.0"
META_REDIRECT_URI = "https://api.musubo.jp/api/instagram/oauth/callback"
```

この設定ファイルは**本番の配備で有効になります**。ただし本番は `main` ブランチから
配備するため、その前に手順4（`main` への反映）が必要です。ご本人の操作は要りません。

> アプリIDとシークレットは、**この設定ファイルには絶対に書きません。**
> 設定ファイルに同じ名前を書くと、手順2で登録した秘密値を上書きしてしまいます。

## 手順4：本番ブランチ `main` へInstagramのぶんを反映する（こちら）

ここが当初の見落としでした。**本番は `main` ブランチから配備します**
（`docs/DEPLOY-GATE.md` 33〜36行目。検証環境は `codex/development` から配備）。
そして `main` には、Instagram同時投稿のぶんが**まだ1つも入っていません**。

`main` に無いもの：

```text
packages/db/migrations/603_instagram_connections.sql   接続の表
packages/db/migrations/611_instagram_cross_post.sql    同時投稿の列
apps/worker/src/services/instagram.ts                  Instagram APIの呼び出し
apps/worker/src/routes/instagram.ts                    接続・解除・確認の窓口
packages/shared/src/instagram.ts                       画面と裏側で共有する型・判定
apps/worker/wrangler.toml の META_REDIRECT_URI など     本番の設定（手順3で追加したぶん）
```

つまり、いまの本番Workerを配備し直しても、Instagramの機能は入りません。
`main` へ反映する作業が先に必要です。

### これは「枝のマージ」ではなく「内容の移植」です

`codex/development` を `main` へそのままマージしてはいけません。
2つの枝がどれだけ離れているかを実測した数字です。

| 測ったもの | 差 |
| --- | --- |
| コミット数（`codex/development` が先にある） | **7,608** |
| `apps/worker/src` | **896ファイル・84,505行の追加／10,419行の削除** |
| `packages/shared/src` | **80ファイル・3,548行の追加／91行の削除** |
| 移行ファイル | `main` 475件 ／ 統合版 578件（**統合版だけにあるもの103件**。`main` だけにあるものは0件） |
| 新しい管理画面 `apps/web/src/v8` | `main` は**0ファイル** ／ 統合版は**1,138ファイル** |

枝ごとマージすると、この全部が未検証のまま本番へ入ります
（`docs/DEPLOY-GATE.md` 38〜39行目が禁じている状態です）。

さらに、**ファイル単位のコピーでも足りません**。たとえば
`apps/worker/src/routes/restaurant-google-posts.ts` は `main` との差が
**201行の追加**ですが、そのうちInstagramに関係する行は**108行**だけです。
残りはGoogleビジネスの別の改修ぶんで、今回の範囲外です。
**行を選んで移植する**必要があります。

- そのため、**Instagramに必要な中身だけを `main` へ出すPR**を作ります。
  先例は PR #1677（Googleビジネスの修正だけを `main` へ出したPR）です。
- 全部を本番へ出すのは別件（本番リリース）であり、今回の範囲ではありません。
- **`main` への反映は masato の承認が必要**です（`docs/DEPLOY-GATE.md` 43行目）。
- マージ後は `packages/shared` を建て直す必要があります
  （`cd packages/shared && npx tsc -p tsconfig.build.json`）。

## 手順5：本番DBへ移行を当てる（こちら）

本番DB（D1 `nen-line`）へ、次の2つを**この順番で**当てます。

```text
packages/db/migrations/603_instagram_connections.sql   表を3つ新しく作る
packages/db/migrations/611_instagram_cross_post.sql    既存の投稿表へ列を足す
```

### 何が増えるか（正確な中身）

当初この文書には「既存の表は触りません。追加だけです」と書いていました。
**これは誤りでした。** 正しくは次のとおりです。

| 移行 | 対象 | 中身 |
| --- | --- | --- |
| 603 | **新しい表** | `instagram_oauth_states` / `instagram_connections` / `instagram_messages` を作る（索引1つ） |
| 611 | **既存の表 `rt_google_posts`** | 列を**7つ足す**（同時投稿のON/OFF・Instagram用文章・状態・投稿ID・リンク・エラー・投稿時刻） |
| 611 | **既存の表 `instagram_connections`** | 列を**1つ足す**（同意済みの許可の一覧） |

既存の表への列追加は、このリポジトリの移行規約
（`CONTRIBUTING.md` の Migration Policy）で**正常な操作として認められています**。
禁止されているのは表や列の削除・改名・既定値なしの必須列の追加です。
今回足す8列はすべて**空を許すか既定値つき**で、既にある行のデータは書き換えません。

- 611が列を足す先の `rt_google_posts` は、本番にすでにあります
  （`main` に `511_restaurant_google_posts.sql` が入っています）。
- 603は611より**先に**当てます。611が `instagram_connections` に列を足すためです。

### 順番がなぜ大事か（Worker配備より先に当てる）

Googleビジネスの投稿の裏側（`apps/worker/src/routes/restaurant-google-posts.ts`）は、
Instagramのぶんを入れた版では**611で足す列を無条件に読み書きします**。
機能のON/OFFでは切り離せません。

本番ではGoogleビジネスの投稿が**すでに動いています**
（`RESTAURANT_TEST_ENABLED` と `GOOGLE_BUSINESS_WRITE_ENABLED` が本番の設定で `"true"`）。
そのため**移行より先にWorkerを配備すると、動いている投稿機能が「列がない」で止まります**。

```text
正しい順番： 603 → 611 → Workerを配備
```

### 当て方（まとめて当てない）

本番DBには、Instagramの2件を含めて**101件が未適用**と判定されています。
これは放置や損傷ではなく、**検証環境の統合版と `main` の差（103件）そのもの**です。
本番DBは `main` と揃っており、今回の依頼の対象は**603と611の2件だけ**です。

まとめて当てる経路（`migrate.ts apply production`）は**使いません**。
ファイルを選ぶ指定が無く、未適用の101件すべてを当てようとするためです。

```text
1. 読み取りだけの確認： npx tsx scripts/deploy/migrate.ts status production
   → 「部分」と判定された行が 0 件であることを確認する
2. 記録表の初期化：     npx tsx scripts/deploy/migrate.ts seed production --approved-by skmtmst --approval-ref user-deployment-20260929-v1
3. 603 を単独で当てる： npx wrangler d1 execute nen-line --remote --config apps/worker/wrangler.toml --file=packages/db/migrations/603_instagram_connections.sql
   そのあと _migrations へ記録（INSERT OR IGNORE）
4. 611 を単独で当てる： 同じやり方
```

当てる前に巻き戻し用の時点（Time Travel の bookmark）を記録します。
D1の `--file` は途中で失敗しても戻らないため、戻す手段はこの時点復元だけです。
ただし**時点復元は、その後に入ったデータも消します**。

ご本人の操作は要りません。

### 移行ファイルに残っている「本番には適用しない」という書き置き

`packages/db/migrations/611_instagram_cross_post.sql` の1行目に
「本番には適用しない。」と書かれています。これは**2026-10-08に検証環境だけへ
当てることをご承認いただいた時点の書き置き**です。

2026-10-12のご依頼「本番環境にも反映させたいです」で、この前提は変わりました。
本番へ当てる根拠は次の2つです。

- 利用者からの本番反映のご依頼（2026-10-12）
- 保存済み共通承認 `user-deployment-20260929-v1`（依頼された開発のDB移行を含む）

**SQLそのものは1文字も変えません。** 検証環境へ既に当たっているため、
中身を変えると「何が入っているか」が分からなくなります。
1行目の書き置きだけを現在の承認状態に合わせて書き直します。
この書き直しは `packages/db/` を所有する Codex が、`main` 向けのPRの中で行います
（`AGENTS.md` 51行目。移行は番号ごとにオーナー承認が必要）。

## 手順6：本番Workerを配備する（こちら）

手順5が終わってから配備します。設定の `META_REDIRECT_URI` と
`META_GRAPH_API_VERSION` が本番に入ったことを確認します。

## いまの本番の管理画面には画面がない

**ここが今回いちばん大きな見落としです。** 手順7・8に進めません。

本番の管理画面（`admin.musubo.jp`）も `main` から作られます。
その `main` には、新しい管理画面（V8）が**1ファイルも入っていません**。

| | ファイル数 |
| --- | --- |
| 検証環境の統合版にある新しい管理画面（`apps/web/src/v8`） | **1,138** |
| `main`（本番）にある同じ場所 | **0** |

いまの本番の管理画面は、V8より前の古い作り（`apps/web/src/app/restaurant-test`）です。
そして、

- 「**設定 → SNS連携**」という画面は、**V8にしかありません**。古い作りには存在しません。
- 本番にあるGoogleビジネスの投稿画面（`restaurant-test/google/google-posts.tsx`）には、
  Instagramという文字が**1か所もありません**。「Instagramにも投稿する」の区画もありません。

つまり、手順1〜6をすべて終えても、**本番の画面には［Instagramにログインして接続］の
ボタンも、同時投稿のスイッチも出てきません**。Metaの審査で必要な録画
（<./instagram-app-review.md> の11項目。1番目が「本番の管理画面にログイン」、
2番目が「設定 → SNS連携」）も、いまの本番では撮れません。

### 選べる道 → **Dに決定（2026-10-12・ご本人のご判断）**

| | やること | 影響 | |
| --- | --- | --- | --- |
| A | 新しい管理画面（V8）を本番へ出す | 本番の見た目が全面的に変わる。7,608コミット・103件の移行を含む大仕事。masatoの承認が必要 | 選ばれませんでした |
| B | もともと予定している本番リリースにInstagramを含め、それを待つ | 今回の本番稼働は後ろへずれる。裏側（手順1〜6）は先に進めておける | 選ばれませんでした |
| C | 古い作りの画面にInstagramのぶんだけを作り足す | **新しい画面を作る扱い**になるため、先にPencilでデザインを作りご承認が必要。二重の作りを抱える | 選ばれませんでした |
| D | いまは本番の裏側だけ整えて、画面は検証環境のまま使う | 本番での接続は先送り。審査の録画は検証環境で撮る | **これに決定** |

### 判断Dで何をするか・何をしないか

| | |
| --- | --- |
| いま進めること | 手順4（`main` への反映）→ 手順5（移行603 → 移行611）→ 手順6（本番Worker配備） |
| 本番の見た目 | **何も変わりません。** 画面コードは1行も変えません |
| Instagramの接続操作 | 検証環境（`stg-admin.musubo.jp`）で続けます。すでに実機で成功済み |
| 審査用の録画 | 検証環境で撮ります（<./instagram-app-review.md>） |
| 本番の画面にInstagramが出る時期 | 新しい管理画面（V8）が別の回で `main` へ出るとき。**裏側が先に整っているので、そのとき自動でそろいます** |
| 手順7・手順8（本番の画面でつなぐ・1件試す） | **この回では行いません** |

判断Dを選ぶ理由は、本番の裏側（設定・DB・Worker）を先に整えておけば、
新しい管理画面を出す回でInstagramのぶんを別途やり直す必要がなくなることです。
また、本番のGoogleビジネス投稿は既に動いているため、移行611の列が
`restaurant-google-posts.ts` から無条件に読み書きされる前にDBを整えておく必要があります。

## 手順7：本番の管理画面で実際につなぐ（ご本人の操作）

> 上の節のとおり、**この手順はいまの本番の画面では実行できません。**
> 画面をどうするかのご判断（A〜D）のあとに進みます。
> 以下は画面が本番に入ったあとの手順です。

手順1〜6が終わり、画面が本番に入ると、表示が変わります。

1. 本番の管理画面（<https://admin.musubo.jp>）にログイン。
2. 設定 →**SNS連携**。Instagram の「いまの状態」が「**未接続**」になっていることを確認。
   - ここが「**設定がありません**」のままなら、5つの値のどれかが足りていません。
     お知らせください。名前と形を照合します。
3. ［**Instagramにログインして接続**］を押す。**Instagram**のログイン画面へ飛びます。
4. 権限の確認画面で、**チェックを外さずに**「許可」を押します。
   `instagram_business_content_publish`（コンテンツの公開）を外すと接続が保存されません。
5. 画面がSNS連携へ戻り、帯で結果が出ます。
   「いまの状態」が「**接続しています**」、「接続しているアカウント」に
   `@ユーザー名（ビジネス）` が出れば成功です。

このボタンは**オーナー／管理者**にだけ出ます。閲覧のみの権限では出ません。

## 手順8：同時投稿を1件試す

> こちらも**いまの本番の画面では実行できません**（上の節のとおり）。

Googleビジネスの投稿を作る画面に「**Instagramにも投稿する**」の区画が出ます。

- 新しい投稿は「Instagramにも投稿する」が**はい**で始まります。
- 「はい」のときは**画像が1枚必要**です。
- Instagram用の文章は空のままでよく、空ならGoogleの本文をそのまま使います（上限2,200文字）。
- 投稿後、一覧の札が「**Instagram済み**」になれば通っています。
  失敗したときは「Instagram失敗・再試行」になり、行の「…」から再送できます。
  **Googleへの公開はそのまま残ります。**

## 確認用の一覧（本番）

| 項目 | 値・場所 | いまの状態 | 担当 |
| --- | --- | --- | --- |
| Meta側 OAuthリダイレクトURI | `https://api.musubo.jp/api/instagram/oauth/callback` | 追記待ち | **ご本人**（手順1） |
| `INSTAGRAM_APP_ID` | Worker `nen-line` の Secret | 登録待ち | **ご本人**（手順2） |
| `INSTAGRAM_APP_SECRET` | Worker `nen-line` の Secret | 登録待ち | **ご本人**（手順2） |
| `META_TOKEN_ENCRYPTION_KEY` | Worker `nen-line` の Secret | 登録待ち | こちら（手順2） |
| `META_REDIRECT_URI` | `apps/worker/wrangler.toml` | **設定ファイルへ追加済み**（`main` 反映と配備待ち） | こちら |
| `META_GRAPH_API_VERSION` | `apps/worker/wrangler.toml`（`v24.0`） | **設定ファイルへ追加済み**（`main` 反映と配備待ち） | こちら |
| `main` へInstagramのぶんを反映 | PR（`main` 向け） | 未。**masatoの承認が必要** | こちら（手順4） |
| 移行 603（表を3つ作る） | D1 `nen-line` | 適用待ち | こちら（手順5） |
| 移行 611（既存 `rt_google_posts` へ7列・`instagram_connections` へ1列） | D1 `nen-line` | 適用待ち | こちら（手順5） |
| 本番Workerの配備 | Worker `nen-line` | 未。**移行のあと** | こちら（手順6） |
| 本番の管理画面にSNS連携の画面 | `admin.musubo.jp` | **無い**（V8が `main` に未反映） | **判断D**。この回では作らない。V8が出る回でそろう |
| 本番での接続 | `admin.musubo.jp` → 設定 → SNS連携 | **見送り**（判断D） | 接続と録画は `stg-admin.musubo.jp` で行う |

5つ（`INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` / `META_REDIRECT_URI` /
`META_GRAPH_API_VERSION` / `META_TOKEN_ENCRYPTION_KEY`）が**全部そろって形も正しいときだけ**、
画面が「設定がありません」から「未接続」へ変わります。

`META_APP_SECRET` と `META_WEBHOOK_VERIFY_TOKEN` は**DM受信（Webhook）の署名確認だけ**に
使う値です。DM受信は止めてあるため、本番では**要りません**。

## 本番で使える範囲（審査前）

Metaの既定は「**標準アクセス**」です。この状態でできるのは、
**アプリに役割（管理者・開発者・テスター）を持つご本人のアカウント**での接続です。

- ご本人のアカウントでの本番運用 … **審査なしでできます**（今回の範囲）
- 他の店舗のアカウントまで広げる … Metaの**アプリレビュー＋ビジネス認証**が必要
  （<./instagram-app-review.md>）

他の店舗のアカウントで接続しようとすると、Metaの許可画面か折り返しの時点で断られます。
仕組みの不具合ではありません。

## つながらないときの読み方（本番）

| 画面・メッセージ | 意味 | どうするか |
| --- | --- | --- |
| 「設定がありません」のまま | 5つの値のどれかが未登録か形が違う | お知らせください。名前と形を照合します |
| 折り返しでMetaがエラーを出す | 手順1のURLが1文字違う／まだ追記されていない | 手順1のURLを貼り直す |
| 「Instagramへの投稿が許可されていません」 | 許可画面で `instagram_business_content_publish` が外れた | もう一度［接続］を押し、権限を外さずに許可 |
| 「Instagramのビジネスアカウントが必要です」 | ログインしたアカウントがプロアカウントでない | Instagramアプリ側でプロアカウントに切り替える |
| 他の人のアカウントで断られる | 標準アクセスの範囲外 | <./instagram-app-review.md>（審査） |
| 「認可が切れています」 | 預かっている許可の期限切れ | ［接続を確かめる］を押す。直らなければ接続し直す |

接続の許可は60日ほどで切れるため、［接続を確かめる］で延長できる作りにしてあります。

## 関連する文書

- <./instagram-meta-app-setup.md> … Metaのアプリの作り方（検証環境を立てたときの手順）
- <./instagram-app-review.md> … 他の店舗まで広げるための審査の中身と必要な資料
- <./integrations/instagram-connection.md> … 接続の台帳（済んだこと・証拠・残り）
