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

## 済んだこと（本番の裏側・証拠つき）

判断D（先に裏側だけ整える）の範囲は**すべて完了**しました。本番の画面の見た目は変えていません。

| 日付 | 操作 | 結果 | 証拠 |
| --- | --- | --- | --- |
| 2026-10-12 | Instagramのぶんを `main` へ反映（PR #1714 のマージ） | 成功 | マージ後の `main` = `c4a9d1a879e6a3331a2faf98c638355ae52775d5`（`git rev-parse origin/main` で再確認） |
| 2026-10-12 | `META_TOKEN_ENCRYPTION_KEY` を Worker `nen-line` へ登録 | 成功 | Codexが登録できた事実のみ報告（**値は保持・記録しない**） |
| 2026-10-12 | 本番D1 `nen-line` へ移行 603 を適用（表の新規作成） | 成功 | 適用前にTime Travelのbookmarkを取得。`_migrations` へ記録 |
| 2026-10-12 | 本番D1 `nen-line` へ移行 611 を適用（既存 `rt_google_posts` へ7列・`instagram_connections` へ `scopes` 1列） | 成功 | 同上。順番は 603 → 611 を守った |
| 2026-10-12 | 本番Worker `nen-line` を `main` から配備（100%） | 成功 | Codexの読み取り確認。ハーネス記録 `verified` |
| 2026-10-12 | `apps/worker/wrangler.toml` の `META_GRAPH_API_VERSION` / `META_REDIRECT_URI` | 本番へ反映済み | 同ファイル71〜72行目（`v24.0` / `https://api.musubo.jp/api/instagram/oauth/callback`） |

**済んだ操作は繰り返しません。** 以降の確認はすべて読み取りだけで行います。

### 解消した食い違い（記録）

下の「本番反映で分かった2つの食い違い」のうち、2番目（`main` にInstagramのぶんが
1つも入っていない）は PR #1714 のマージで**解消済み**です。1番目（移行611が既存表を変更する）は
事実として残り、適用は additive-only 規約の範囲で完了しています。

## 残っていること（本番）

| 項目 | 担当 | 状態 |
| --- | --- | --- |
| Meta側 OAuthリダイレクトURI に `https://api.musubo.jp/api/instagram/oauth/callback` を追記 | **利用者** | 未 |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` を Worker `nen-line` へ登録 | **利用者** | 未 |
| 本番の管理画面にSNS連携の画面が無い（V8が `main` 未反映） | 利用者のご判断 | **Dに決定（2026-10-12）**。裏側だけ先に整え、画面は検証環境のまま使う |
| 本番の管理画面で実際につなぐ | **利用者** | **見送り**（判断D）。新しい管理画面が `main` へ出る回で自動的に使えるようになる |
| 本番で同時投稿を1件試す | **利用者**＋結果確認 | **見送り**（判断D）。接続・録画は `stg-admin.musubo.jp` で行う |

### `GET /api/instagram/connection` が返すもの（認証が前提です）

この接続APIは**管理画面にログインしている人向けのAPI**で、ログインしていない状態では
Instagramの設定とは関係なく認証で止まります。以下は読み取り確認の目安です。

| 呼び方 | 返るもの | 根拠 |
| --- | --- | --- |
| ログインしていない（匿名） | **HTTP 401** `Unauthorized` | 全体の認証 `authMiddleware`（`apps/worker/src/middleware/auth.ts` 660行目。`apps/worker/src/index.ts` 457行目で全経路に適用） |
| ログイン済みだが `/webhooks` の権限が無い | HTTP 403 | `requirePermission('/webhooks')`（`apps/worker/src/middleware/role-guard.ts` 46〜56行目。`apps/worker/src/routes/instagram.ts` の `instagram.use('/api/instagram/*', …)` で適用。`/api/instagram/webhook` だけ除外） |
| ログイン済みだが `lineAccountId` を付けていない | HTTP 400 `account_required` | `account(c)`（`apps/worker/src/routes/instagram.ts`）。設定の確認より**手前**で動きます |
| ログイン済み＋`lineAccountId` あり＋`INSTAGRAM_APP_*` 未登録 | **HTTP 200** `{ success: true, data: { state: 'unconfigured', replyEnabled: false } }` | `apps/worker/src/routes/instagram.ts` 102〜112行目 |

上の2件（リダイレクトURIと `INSTAGRAM_APP_*`）が未登録のあいだは、
**ログイン済みで `lineAccountId` を付けて呼んだときに** `state: 'unconfigured'` が HTTP 200 で返ります。
画面では「設定がありません」に当たります。
**これは配備の失敗ではなく、未登録のときの正常な状態です。**

### 未登録のときに他のInstagram APIが返すもの（503・302・200の3種類に分かれます）

`INSTAGRAM_APP_*` 未登録のとき、**すべてのInstagram APIが503になるわけではありません。**
返り方は3つに分かれます。以下はいずれも `apps/worker/src/routes/instagram.ts`。
**前提条件は経路ごとに違うので、下の表の「前提」の欄も合わせて読んでください。**

| 未登録時の返り | 経路 | 前提 | 根拠（行番号） |
| --- | --- | --- | --- |
| **HTTP 503** `unconfigured` | `POST /api/instagram/oauth/start`・`POST /api/instagram/refresh`・`POST /api/instagram/sync` | ログイン・`/webhooks` 権限・`owner`/`admin` の役割・`lineAccountId` | 3経路とも `await account(c)` の**あとに** `ready(c)` を呼びます（143・395・468行目）。`ready` は 81〜85行目で `InstagramError('unconfigured', 503)` を投げ、それを 36〜41行目の `instagram.onError` がJSONの503にします |
| **HTTP 302** リダイレクト（`/settings/sns?instagram=failed&instagram_code=unconfigured`） | `GET /api/instagram/oauth/callback` | ログイン・`/webhooks` 権限・`owner`/`admin` の役割。**`lineAccountId` は不要**（Instagramから戻ってきたブラウザが `state` と `code` を持って来る口で、対象のLINEアカウントは `instagram_oauth_states` の行から取ります。276〜280行目） | `ready(c)` の呼び出し（261行目）は 260行目から始まる `try` の中にあります。投げられた503は 365行目の `catch` が捕まえ、`onError` には届きません。最後は 386行目の `c.redirect(snsReturnUrl(c, 'failed', diagnostic))` で**失敗画面へ戻します**（戻り先の組み立ては 204〜222行目、`instagram_code` に載る種類名の絞り込みは `services/instagram.ts` 177〜181行目） |
| **HTTP 200** `{ state: 'unconfigured' }` | `GET /api/instagram/connection`・`GET /api/instagram/profile`・`GET /api/instagram/posts`・`GET /api/instagram/messages` | ログイン・`/webhooks` 権限・`lineAccountId` | `ready(c)` を通らず `instagramConfig(c.env)` を直接見て、未登録ならそのまま200を返します（104行目／`profile`・`posts` を作る繰り返しの中の 513行目／`messages` の 533行目） |

同じ「未設定」でも、**画面を開くだけの読み取りは200**、**つなぐ・更新するなどInstagram側を呼ぶ操作は503**、
**Instagramから戻ってくる口だけは302で失敗画面**という区別です。
戻り先が503のJSONにならないのは意図した作りで、ここはブラウザが見る画面だからです
（失敗の中身は画面に出さず、`instagram_code` という安全な種類名だけをURLに載せます）。

なお `DELETE /api/instagram/connection`（439行目）は設定の有無を見ません。
`POST /api/instagram/messages/:id/reply`（577行目）は設定に関係なく常に403 `meta_review_required` を返します
（返信は審査が通るまで出しません）。`POST /api/instagram/webhook`（597〜599行目）だけは
`META_APP_SECRET` が無いときに503を返しますが、これは `INSTAGRAM_APP_*` とは別の設定です。

匿名での 401 は「APIが落ちている」ことを意味しません。認証が必要なAPIとして正しく守られている状態で、
Instagramの設定の有無を匿名アクセスで判定することはできません。

## 未確認のまま残っている2項目（合格扱いにしません）

2026-10-12のCodexの本番配備で、次の2項目は**確認できていません**。
確認方法・担当・前提条件を決めたので、実際に確認できた時点でここを更新します。

### 1. 認証後のInstagram接続とGoogle投稿の動作（本番）

| | 内容 |
| --- | --- |
| 状態 | **未確認** |
| なぜ未確認か | `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` が Worker `nen-line` に未登録で、Meta側のリダイレクトURIにも本番URLが未追記のため、認可そのものが始められない |
| 前提条件 | ①利用者がMeta側のOAuthリダイレクトURIへ `https://api.musubo.jp/api/instagram/oauth/callback` を追記 ②利用者が `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` を Worker `nen-line` へ登録 ③本番の管理画面にSNS連携の画面が出ること（V8が `main` へ出る回） |
| 担当 | **利用者**（①②は本人のみ。値は会話・記録に出しません）／画面は別件のV8反映 |
| 確認方法 | 前提が揃ったあと、`GET /api/instagram/connection` が `unconfigured` から `disconnected` へ変わることを読み取りで確認（**管理画面にログインした状態で `lineAccountId` を付けて呼びます**。匿名では401、`lineAccountId` 無しでは400になり、設定の有無は判定できません。上の「返すもの」の表を参照） → 本番の管理画面で接続 → `state: 'connected'` と `@ユーザー名` の表示を確認 → Googleビジネスの投稿を1件出し、`rt_google_posts` の `instagram_*` 列が進むことを**列の有無と状態名だけ**で確認 |
| いま確認できること | 判断Dにより、**接続操作と審査用の録画は検証環境 `stg-admin.musubo.jp` で続けます**。検証環境では2026-10-12に実機で接続成功を確認済みです（上の表） |

### 2. 掃除ジョブ `instagram transient data retention` の成功

| | 内容 |
| --- | --- |
| 状態 | **未確認**（確認方法を差し替えました） |
| 分かったこと | **成功時にログを出さない実装です。** `apps/worker/src/services/instagram.ts` 601〜613行目の `purgeInstagramTransientData` は戻り値が `Promise<void>` で、件数も返さずログも書きません。`apps/worker/src/index.ts` 1886〜1895行目のジョブ定義も `console.log` を持ちません（隣の `restaurant raw mail retention` は `result.deleted + result.failed > 0` のときだけ出力します） |
| したがって | 当初の引き継ぎに書いた「cronのログに出ること」という確認は**実装上できません**。確認の方法を変えます（判定を甘くするのではありません） |
| 失敗したときは見えます | `apps/worker/src/services/scheduled-job-isolation.ts` 25〜39行目が、失敗したジョブだけ `console.error('instagram transient data retention error:', …)` を出します |
| 走る間隔 | 6時間ごと（cron `0 */6 * * *`）。`apps/worker/wrangler.toml` 44行目の3本目で、`runSixHourlyHeavyJobs`（`index.ts` 1725行目〜）の中にあります |
| 担当 | Codex（本番の読み取り確認） |
| 差し替えた確認方法 | ①6時間ぶんのWorkerログに `instagram transient data retention error:` が**出ていない**こと ②本番D1で `SELECT COUNT(*) FROM instagram_oauth_states WHERE expires_at<=datetime('now')` が 0 であること ③同じく `SELECT COUNT(*) FROM instagram_messages WHERE created_at<datetime('now','-90 day')` が 0 であること（**件数だけ。行の中身は読みません**） |
| 注意 | ②③は、まだ誰も本番で認可を始めていない現在は**そもそも行が0件**なので、「掃除が働いた」証拠にはなりません。本番で接続が始まったあとに確認します。それまでは①と単体テストだけが根拠です |

### 本番反映で分かった2つの食い違い（2026-10-12・Codexの検証で判明）

1. **移行611は既存の表を変更します。** 当初の引き継ぎと手順書には
   「既存の表は触らない」とありましたが誤りでした。611は既存の `rt_google_posts` へ7列、
   `instagram_connections` へ1列を追加します。すべて空を許すか既定値つきで、
   `CONTRIBUTING.md` の Migration Policy で認められた追加操作の範囲内です。
   既にある行のデータは書き換えません。
2. **（解消済み）本番は `main` から配備しますが、`main` にInstagramのぶんが1つも入っていませんでした。**
   移行603・611、`services/instagram.ts`、`routes/instagram.ts`、
   `packages/shared/src/instagram.ts`、`META_*` の設定、いずれも未反映でした。
   → **PR #1714（`c4a9d1a879…`）のマージで解消しました。**
   ただし新しい管理画面（V8、1,138ファイル）は今も `main` には0ファイルで、
   「設定 → SNS連携」の画面自体が本番にありません（判断Dにより今回は作りません）。

本番D1の「101件が未適用」という判定は、放置や損傷ではなく
`codex/development` と `main` の差（103件）そのものです。本番D1は `main` と揃っています。
今回の対象は603・611の2件だけで、まとめて当てる経路（`migrate.ts apply production`）は
ファイル指定ができないため使いません。603・611を個別に当てます。
詳細と順番は<../instagram-production-rollout.md>の手順4〜6にあります。

## 残っていること（審査・他の店舗まで広げる）

| 項目 | 担当 | 状態 |
| --- | --- | --- |
| ビジネス認証（法人書類） | **利用者**（代行不可） | 未 |
| プライバシーポリシーへInstagramの節を追記 | Claude（実装）→Codex（配備） | 文案を**2026-10-12に利用者が「文案のまま公開へ進める」と承認**（<../instagram-privacy-section-draft.md>）。`sites/musubo/**` への実装は**未**。施行日 `2026-10-04` は変えない |
| 操作の録画（11項目） | **利用者の操作** | 未。判断Dにより**検証環境 `stg-admin.musubo.jp` で撮る** |
| 審査用ログイン（オーナー／管理者） | Claude＋利用者確認 | 未 |
| 申請の送信 | **利用者** | 未 |

## 次の1手

**プライバシーポリシーへInstagramの節を追記して公開すること**（Claudeが実装 → Codexが配備）。
2026-10-12に利用者が「文案のまま公開へ進める」と選んだので、文案を
`sites/musubo/**` へ入れて musubo.jp の5ページへ反映します。施行日 `2026-10-04` は変えません。
審査の6要件のうち、開発側だけで進められる最後の項目です。

その次（利用者の操作が必要）：

1. Meta側のOAuthリダイレクトURIへ `https://api.musubo.jp/api/instagram/oauth/callback` を追記。
2. `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` を Worker `nen-line` へ登録（**値は本人のみ**）。
3. 審査用の録画（11項目）を検証環境 `stg-admin.musubo.jp` で撮る（判断D）。
4. ビジネス認証の書類提出 → 申請の送信。

**裏側（`main` への反映 → 移行603 → 移行611 → Worker配備）は2026-10-12に完了しました。**
順番（603 → 611 → 配備）を守る必要があったのは、`restaurant-google-posts.ts` が611の列を
無条件に読み書きし、本番ではGoogleビジネスの投稿が既に動いていたためです。守って適用しました。

`main` への反映は**枝のマージではなく内容の移植**で行いました。`codex/development` と `main` は
`apps/worker/src` だけで896ファイル・84,505行、`packages/shared/src` で80ファイル・3,548行
離れており（7,608コミット）、枝ごとマージすると未検証の変更が本番へ入るためです。
Instagramに必要なぶんだけを選んだPRが #1714 です。
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
- **確認方法を決めただけの項目を合格扱いにしません。** 上の「未確認のまま残っている2項目」は、
  実際に確認コマンドを走らせて結果が出るまで**未確認**のままにします。
  確認が不可能だと分かった場合は、判定を甘くするのではなく確認方法を差し替え、
  差し替えた理由をコードの行番号つきでここに残します（掃除ジョブがその例です）。
