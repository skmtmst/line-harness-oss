# Googleビジネスプロフィール連携 機能対応表（申請用・根拠付き）

この表は、Google Business Profile API の利用審査とOAuthアプリ審査に出す申請文（`docs/manuals/google-business-verification-application.md`）が、実際の本番実装と一致していることを示すための一覧である。**審査のために事実と異なる説明は書かない。** 表に書いていないGoogle APIは本番コードから呼び出していない。

- 調査対象コミット：このリポジトリの現在の作業ツリー（`apps/worker`、`apps/web`、`sites/musubo`）
- 根拠列のファイル・行番号は調査時点のもの。行がずれた場合は関数名で探す。
- 使用スコープは全Googleビジネス機能で `https://www.googleapis.com/auth/business.manage` のみ。連携したGoogleアカウントのメールアドレス表示のために `openid` と `https://www.googleapis.com/auth/userinfo.email`（認可要求では短縮名 `email`）を併用する（`apps/worker/src/services/google-business.ts:10-14`）。Googleビジネス系APIには読み取り専用スコープが存在しないため、読み取りだけの機能も同じスコープを使う。
- 認可リクエストに `include_granted_scopes` は付けない。Googleビジネス用とスプレッドシート用で同じOAuthクライアントを使う環境があり（`services/google-sheets.ts:113-135` の予備クライアント）、付けると以前そのクライアントへ許可した別用途のスコープまで含んだトークンが返るため、申請文の「3つのスコープだけ」と食い違う（`services/google-business.ts:131-163`）。
- スプレッドシート連携（`https://www.googleapis.com/auth/spreadsheets`）は**この申請の対象外**で、本番コードから到達できない。上記の予備クライアントがあるため、本番の審査対象クライアントには Sheets のコールバックURL（`/api/integrations/google-sheets/oauth/callback`）を**登録しない**運用にしている。登録が無ければGoogleが同意画面の前に `redirect_uri_mismatch` で止めるので、審査対象クライアントが `spreadsheets` を取得する経路は存在しない（手順：`docs/manuals/google-business-oauth-setup.md` 6章、申請文5章）。カレンダー（`https://www.googleapis.com/auth/calendar`）は利用者の同意ではなくサービスアカウントのJWTで認可するため、OAuth同意画面には出ない（`services/google-service-account.ts:2,42-97`）。
- 同意画面で権限ごとに許可しないことを選べる（granular consent）ため、トークン取得時に `business.manage` が許可されているかを検証する。許可されていなかった場合は接続を保存せず `no_permission` として扱い、画面で再連携を案内する。検証は認可コードの交換時（接続時）と更新トークンでの再取得時（連携後の取り消し）の両方で行う（`GOOGLE_BUSINESS_REQUIRED_SCOPES` / `assertGrantedScopes`：`services/google-business.ts`、`routes/restaurant-google.ts`）。

## 本番到達性の分類

| 記号 | 意味 |
| --- | --- |
| 本番利用可 | 本番の実行環境（Worker本番 + 本番管理画面）から利用者の操作で到達でき、Googleへ実際に通信する |
| 検証環境のみ | 検証環境では動くが本番では到達できない |
| フラグで無効 | コードとルートはあるが、環境変数・フィーチャーフラグで本番では実行されない |
| 未接続 | サービス関数はあるが、どのルートからも定期処理からも呼ばれない |
| デッドコード | export されているが、ルート・定期処理・テストのいずれからも参照されていない |
| 未実装 | 該当するコードがリポジトリに存在しない |

共通の前提（すべての行に適用）：

- 全Googleルートは `/api/restaurant-test/google/*` 配下にあり、`googleAccessGuard` によって**管理画面にログインしたセッションだけ**が使える。長期有効なAPIキーでは 403 になる（`apps/worker/src/middleware/auth.ts`、テスト `apps/worker/src/routes/restaurant-google.test.ts` の「受入条件8」スイート）。
- `RESTAURANT_TEST_ENABLED`（実行時）とテナントの機能パック `restaurant` が有効なテナントだけで使える。
- Googleへ**書き込む**4機能は、本番では `GOOGLE_BUSINESS_WRITE_ENABLED="true"`（`apps/worker/wrangler.toml`）、検証環境では `false`（`apps/worker/wrangler.staging.toml`）。したがって検証環境では送信操作がフラグで止まる。
- Googleから受け取った内容の保存はすべて「管理画面に表示するための一時的な控え」であり、取得から28日後に定期処理が削除する（上限は30暦日、`apps/worker/src/services/google-business-retention.ts` の `GOOGLE_CONTENT_PURGE_AFTER_DAYS = 28` / `GOOGLE_CONTENT_RETENTION_LIMIT_DAYS = 30`）。連携解除時は28日を待たずその場で削除する（同ファイル `deleteGoogleContentForStore`）。

## 機能一覧

| # | 機能 | 使用API・メソッド | スコープ | 利用者の操作（ルート） | 自動実行 | 保存データ | 保存期間 | 本番到達性 | 申請文の記載箇所 | 根拠 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | OAuth認可の開始（「Googleビジネスと連携」ボタン） | `GET https://accounts.google.com/o/oauth2/v2/auth`（ブラウザ遷移。`state` + PKCE `code_challenge`、`access_type=offline`、`prompt=consent`、`include_granted_scopes` は付けない） | business.manage / openid / email | 連携画面の「Googleビジネスと連携」→ `POST /api/restaurant-test/google/connect/start` | なし | `rt_google_oauth_states`（state、PKCE verifier、有効期限） | 使用済みまたは期限切れを定期処理で削除。解除時は即時削除 | 本番利用可 | §2-1 利用の形（Access model）/ §3 手順4-5 | `routes/restaurant-google.ts:572`、`services/google-business.ts:22,131-163` |
| 2 | OAuthコールバック（state・PKCE検証とトークン取得。許可されたスコープに `business.manage` がなければ接続を保存せず `no_permission` で止める） | `POST https://oauth2.googleapis.com/token`（authorization_code 交換） | 同上 | Google同意画面から戻る → `GET /api/restaurant-test/google/oauth/callback` | なし | `rt_google_connections`（アクセストークン・リフレッシュトークンをAES-GCM-256で暗号化、有効期限） | 連携中は保持。解除・認可取り消しで即時削除 | 本番利用可 | §2-1 利用の形・保存期間 / §3 手順6-7 | `routes/restaurant-google.ts:623`、`services/google-business.ts:186-191,220-244`、`packages/db/src/credential-crypto.ts:28-67` |
| 3 | 連携したGoogleアカウントのメールアドレス取得（どのアカウントで連携したかの画面表示） | `GET https://openidconnect.googleapis.com/v1/userinfo` | openid / email | 上記コールバックの内部処理 | なし | `rt_google_connections.account_email` | 連携中は保持。解除時に即時削除 | 本番利用可 | §2-2 | `routes/restaurant-google.ts:667`、`services/google-business.ts:363` |
| 4 | 管理権限のあるGoogleアカウントと店舗の一覧取得（連携できる店舗だけを出す） | `GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts` → `GET https://mybusinessbusinessinformation.googleapis.com/v1/{account}/locations`（`readMask=name,title,storefrontAddress,metadata`） | business.manage | コールバック内で自動取得し、候補を画面に表示 → 利用者が選択 | なし | `rt_google_location_candidates`（店舗名・住所などの候補一覧） | 取得から28日で削除。選択完了後・解除時は即時削除 | 本番利用可 | §2-1 読み取り1 / §3 手順7 | `routes/restaurant-google.ts:668,817`、`services/google-business.ts:372,409,435` |
| 5 | 連携する店舗の確定 | （Google通信なし。4で取得した候補から確定するだけ） | — | 店舗候補を選んで確定 → `POST /api/restaurant-test/google/connect/select-location` | なし | `rt_google_connections.location_name` など | 連携中は保持。解除時に即時削除 | 本番利用可 | §2-1 読み取り1 | `routes/restaurant-google.ts:790` |
| 6 | 連携状態の表示（対象店舗・最終同期・解除方法） | （Google通信なし。保存済みの控えを表示） | — | 連携画面を開く → `GET /api/restaurant-test/google/connection` | なし | 既存の `rt_google_connections` を読むだけ | 同上 | 本番利用可 | §3 手順13 | `routes/restaurant-google.ts:519` |
| 7 | アクセストークンの更新（更新時も `business.manage` の許可を検証し、後から取り消されていれば接続を `no_permission` にして再連携を案内） | `POST https://oauth2.googleapis.com/token`（`grant_type=refresh_token`） | business.manage | 利用者の操作時に期限切れなら自動更新 | あり（6時間ごとの定期処理「google business token keepalive」で接続維持） | 更新後のアクセストークンを暗号化して上書き | 連携中は保持。解除時に即時削除 | 本番利用可（検証環境は定期実行なし） | §2-1 保存期間（トークンは暗号化して保存） | `routes/restaurant-google.ts:394-404`、`services/google-business.ts:246-267`、`index.ts:1920` |
| 8 | 店舗プロフィールの読み取り（店名・住所・電話・サイト・紹介文・通常/特別営業時間・開店状態） | `GET https://mybusinessbusinessinformation.googleapis.com/v1/{location}?readMask=name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,specialHours,openInfo,profile,metadata` | business.manage | プロフィール画面を開く → `GET /api/restaurant-test/google/profile` / 再取得 `POST /api/restaurant-test/google/profile/sync` | あり（表示時に古ければ取り直す） | `rt_google_profiles.profile_json`（Googleから受け取った内容の控え。写真枚数とGoogle側の提案も同じJSONに含む） | 取得から28日で削除。解除時は即時削除 | 本番利用可 | §2-1 読み取り2 | `routes/restaurant-google-profile.ts:549,555,214-228`、`services/google-business-profile.ts:14,350` |
| 9 | Google側で提案・変更された内容の読み取り（画面での注意表示のみ） | `GET https://mybusinessbusinessinformation.googleapis.com/v1/{location}:getGoogleUpdated`（`diffMask` を受け取る） | business.manage | プロフィール画面の表示に含まれる | あり（8と同じ取り直し時） | `rt_google_profiles.profile_json` 内の `googleUpdates` | 取得から28日で削除。解除時は即時削除 | 本番利用可 | §2-1 読み取り2（Google側で行われた変更の案内） | `routes/restaurant-google-profile.ts:219`、`services/google-business-profile.ts:387` |
| 10 | 通常営業時間・特別営業時間の変更（送信） | `PATCH https://mybusinessbusinessinformation.googleapis.com/v1/{location}?updateMask=regularHours`（または `specialHours`） | business.manage | 変更案を作る `POST /api/restaurant-test/google/hours/propose` → 内容を確認して送信 `POST /api/restaurant-test/google/changes/:id/send`（`confirmed: true` 必須、役割は owner/admin） | なし（利用者がボタンを押したときだけ送信） | `rt_google_changes`（変更前後の内容、送信結果）、`rt_google_write_log`（いつ誰がどの店舗に何を送ったか） | 送信記録は利用者が履歴を確認できるよう保持。記録に含まれるGoogle由来の本文（`before_json` / `before_text`）は28日で削除。解除時は即時削除 | 本番利用可（検証環境のみフラグで無効） | §2-1 書き込み7 | `routes/restaurant-google-profile.ts:589,1038,1094`、`services/google-business-profile.ts:411-447` |
| 11 | 店舗情報の変更（店名・電話・ウェブサイト・紹介文・住所） | `PATCH …/v1/{location}?updateMask=title` / `phoneNumbers.primaryPhone` / `websiteUri` / `profile.description` / `storefrontAddress` | business.manage | 変更案を作る `POST /api/restaurant-test/google/profile/propose` → 確認して送信 `POST …/changes/:id/send`（`confirmed: true`、owner/admin） | なし | 10と同じ | 10と同じ | 本番利用可（検証環境のみフラグで無効） | §2-1 書き込み7 | `routes/restaurant-google-profile.ts:707,1038,1094`、`services/google-business-profile.ts:411-447` |
| 12 | 写真の読み取り（Googleに載っている写真の一覧） | `GET https://mybusiness.googleapis.com/v4/{location}/media` | business.manage | 写真画面を開く → `GET /api/restaurant-test/google/photos` | あり（プロフィール取り直し時に枚数を取得） | 一覧自体はDBに保存しない（枚数のみ `rt_google_profiles` に控える） | 控えは28日で削除 | 本番利用可 | §2-1 読み取り2（写真） | `routes/restaurant-google-profile.ts:813,219`、`services/google-business-profile.ts:470` |
| 13 | 写真の追加 | `POST https://mybusiness.googleapis.com/v4/{location}/media`（`mediaFormat: PHOTO`、二重登録を避けるため自動再試行なし） | business.manage | 追加案を作る `POST …/profile/propose`（`field: photo`, `action: add`）→ 確認して送信 `POST …/changes/:id/send`（`confirmed: true`、owner/admin） | なし | 10と同じ | 10と同じ | 本番利用可（検証環境のみフラグで無効） | §2-1 書き込み8 | `routes/restaurant-google-profile.ts:713-735,1086-1088`、`services/google-business-profile.ts:489` |
| 14 | 写真の削除 | `DELETE https://mybusiness.googleapis.com/v4/{media}` | business.manage | 削除案を作る `POST …/profile/propose`（`field: photo`, `action: delete`）→ 確認して送信 `POST …/changes/:id/send`（`confirmed: true`、owner/admin） | なし | 10と同じ | 10と同じ | 本番利用可（検証環境のみフラグで無効） | §2-1 書き込み8 | `routes/restaurant-google-profile.ts:1086-1089`、`services/google-business-profile.ts:498` |
| 15 | 口コミの読み取り | `GET https://mybusiness.googleapis.com/v4/{location}/reviews?orderBy=updateTime desc` | business.manage | 口コミ画面を開く → `GET /api/restaurant-test/google/reviews`、`GET …/reviews/:id`、再取得 `POST …/reviews/sync` | あり（定期再同期。#22） | `rt_google_reviews`（評価・本文・投稿者名・返信内容） | 取得から28日で削除。解除時は即時削除 | 本番利用可 | §2-1 読み取り3 | `routes/restaurant-google.ts:964,970,990,1032`、`services/google-business.ts:478,505` |
| 16 | 口コミ返信の下書き作成・保存（Googleへは送らない） | （Google通信なし） | — | `POST …/reviews/:id/draft/generate`、`PUT …/reviews/:id/draft` | なし | `rt_google_reviews` の下書き列 | 口コミ本体と同じ28日で削除 | 本番利用可 | §2-1 データの扱い（AIで下書きを作る操作） | `routes/restaurant-google.ts:1071,1109` |
| 17 | 口コミへの返信送信 | 送信前に `GET …/v4/{review}` で最新を確認 → `PUT https://mybusiness.googleapis.com/v4/{review}/reply` | business.manage | 下書きを確認して送信 `POST /api/restaurant-test/google/reviews/:id/reply`（`confirmed: true` 必須、owner/admin） | なし | `rt_google_reviews` の返信内容、`rt_google_write_log` | 口コミ内容は28日で削除。送信記録は保持（Google由来の本文は28日で削除） | 本番利用可（検証環境のみフラグで無効） | §2-1 書き込み6 | `routes/restaurant-google.ts:1127,1152,1171`、`services/google-business.ts:533,551` |
| 18 | ローカル投稿の読み取り | `GET https://mybusiness.googleapis.com/v4/{location}/localPosts` | business.manage | 投稿画面を開く → `GET /api/restaurant-test/google/posts`、再取得 `POST …/posts/sync` | あり（定期再同期。#22） | `rt_google_posts`（`origin='google'` の行＝Google由来の控え） | 取得から28日で削除。解除時は即時削除 | 本番利用可 | §2-1 読み取り4 | `routes/restaurant-google-posts.ts:326,453,466`、`services/google-business-posts.ts:336` |
| 19 | 投稿の作成（Googleへ公開） | 重複確認のため `GET …/localPosts` → `POST https://mybusiness.googleapis.com/v4/{location}/localPosts`（自動再試行なし） | business.manage | 下書きを作る `POST …/posts` / 直す `PUT …/posts/:id` → 内容を確認して公開 `POST …/posts/:id/publish`（`confirmed: true`、owner/admin） | なし | `rt_google_posts`（musubo内の下書きは `origin='local'`）、`rt_google_write_log` | musubo内で作った下書き本文は利用者のデータとして保持。Googleから取り直した内容は28日で削除 | 本番利用可（検証環境のみフラグで無効） | §2-1 書き込み9 | `routes/restaurant-google-posts.ts:478,505,532,566,590`、`services/google-business-posts.ts:326` |
| 20 | 投稿の削除（Googleから取り下げ） | `DELETE https://mybusiness.googleapis.com/v4/{localPost}` | business.manage | `POST …/posts/:id/remove`（`confirmed: true`、owner/admin） | なし | `rt_google_posts` の状態、`rt_google_write_log` | 19と同じ | 本番利用可（検証環境のみフラグで無効） | §2-1 書き込み9 | `routes/restaurant-google-posts.ts:620,638`、`services/google-business-posts.ts:356` |
| 21 | 実績指標の取得と表示（表示回数・通話・経路検索など） | `GET https://businessprofileperformance.googleapis.com/v1/{location}:fetchMultiDailyMetricsTimeSeries` | business.manage | 実績画面を開く → `GET /api/restaurant-test/google/performance`、再取得 `POST …/performance/sync`（owner/admin/staff） | あり（定期再同期。#22。指標は6時間ごとの「google business metrics」でも取り直す） | `rt_google_metrics_daily`（日別の数値） | 取得から28日で削除。解除時は即時削除 | 本番利用可 | §2-1 読み取り5 | `routes/restaurant-google-performance.ts:71,133`、`services/google-business-performance.ts:8,81` |
| 22 | 定期再同期（読み取りのみ） | 15・18・21と同じ読み取りAPIのみ。書き込みAPIは呼ばない | business.manage | 利用者の操作なし（連携済み店舗の表示を新しく保つため） | あり（重い処理用レーン `1-56/5`＝通知レーンと1分ずらした5分間隔の定期処理「google business resync」。接続ごとの55分ゲートで実質1時間ごと） | 上記の各控えを更新 | 各控えと同じ28日 | 本番利用可（検証環境は定期実行なし） | §2-1 自動化 | `index.ts:1658`、`services/.../resync.ts:160,166,228`、`wrangler.toml` の `[triggers]` |
| 23 | 保存した内容の自動削除（28日） | （Google通信なし） | — | 利用者の操作なし | あり（6時間ごとの定期処理「google business content retention」） | 削除のみ | 28日経過分を削除 | 本番利用可（検証環境は定期実行なし） | §2-1 保存期間 / privacy §6 | `services/google-business-retention.ts:77-130`、`index.ts:1878` |
| 24 | 連携解除・Google側の認可取り消し・Googleユーザーデータ削除 | `POST https://oauth2.googleapis.com/revoke` | business.manage | 連携画面の解除 → `POST /api/restaurant-test/google/disconnect`（`confirmed: true` 必須） | なし | 削除のみ（トークン、接続先アカウントのメール、口コミ・プロフィール・投稿・実績の控えを即時削除） | 即時 | 本番利用可 | §2-1 保存期間・データの扱い / §3 手順14-16 | `routes/restaurant-google.ts:858-896`、`services/google-business.ts:270`、`services/google-business-retention.ts:169-187` |
| 25 | 口コミ返信の修正・削除（Google側の返信を消す機能） | なし（`DELETE …/reply` を呼ぶコードはない。返信のやり直しは17の上書き送信で行う） | — | なし | なし | — | — | 未実装 | §2-1 に記載しない | `services/google-business.ts` に `deleteReply` 相当なし |
| 26 | 投稿の更新（Google上の投稿を書き換える） | なし（Google上の投稿は20で取り下げて19で作り直す） | — | なし | なし | — | — | 未実装 | §2-1 に記載しない | `services/google-business-posts.ts` に `PATCH` なし |
| 27 | 動画の追加・削除 | なし（`createMedia` は `mediaFormat: 'PHOTO'` 固定） | — | なし | なし | — | — | 未実装 | §2-1 書き込み8に「写真」と明記 | `services/google-business-profile.ts:489` |
| 28 | Pub/Sub通知の受信 | なし | — | なし | なし | — | — | 未実装 | §2-1 に記載しない | `routes/google-business-application-consistency.test.ts:165-166`（Google連携の実装ファイルに `pubsub` と `notificationsetting` が無いことを検査） |
| 29 | Google側の店舗確認（verification）プロセスの開始 | なし | — | なし | なし | — | — | 未実装 | §2-1 に記載しない（§2-1「店舗の新規作成・削除はしない」と整合） | `routes/google-business-application-consistency.test.ts:167`（同ファイル群に `verifications` が無いことを検査） |
| 30 | 自動の口コミ返信・定期投稿・店舗情報の自動変更 | なし（送信系4機能はすべて `confirmed: true` を要求し、利用者の操作からのみ実行） | — | なし | なし | — | — | 未実装 | §2-1 自動化 / terms §3 / privacy §6 | `routes/restaurant-google*.ts` の送信4ルートすべてに `confirmed !== true → 400 confirmation_required` |
| 31 | Google側で行われた変更を自動で元に戻す機能 | なし（9は画面に注意を出すだけで、戻す送信はしない） | — | なし | なし | — | — | 未実装 | §2-1 自動化 / terms §3 / privacy §6 | `routes/restaurant-google-profile.ts:219` は表示用のみ |
| 32 | 顧客のプログラム・バッチ・外部APIからの間接利用 | なし（`googleAccessGuard` がAPIキーを403で拒否） | — | なし（管理画面にログインした操作のみ） | なし | — | — | 未実装（遮断をテストで固定） | §2-1 利用の形 / terms §3 / privacy §6 | `middleware/auth.ts`、`routes/restaurant-google.test.ts`「受入条件8」4件 |
| 33 | `getLocalPost`（投稿1件取得のサービス関数） | `GET https://mybusiness.googleapis.com/v4/{localPost}` を呼ぶ関数が存在していた | business.manage | なし | なし | — | — | デッドコードだったため削除済み（調査時点でルート・定期処理・テストのいずれからも未参照） | §2-1 に記載しない | `services/google-business-posts.ts`（削除前は `getLocalPost`）、`grep -rn "getLocalPost" apps packages` が0件 |

## 申請文との対応

- 申請文 §2-1 は読み取りを 1〜5、書き込みを 6〜9 の連番で説明している。表との対応は次のとおりで、表にある「本番利用可」の機能はすべて §2-1 に記載済みである。
  - 読み取り1（店舗一覧）＝表の4、5
  - 読み取り2（プロフィール・写真・Google側の変更案内）＝表の8、9、12
  - 読み取り3（口コミ）＝表の15
  - 読み取り4（ローカル投稿）＝表の18
  - 読み取り5（実績指標）＝表の21
  - 書き込み6（口コミ返信）＝表の17
  - 書き込み7（営業時間・店名・住所・電話・サイト・紹介文）＝表の10、11
  - 書き込み8（写真の追加・削除）＝表の13、14
  - 書き込み9（ローカル投稿の作成・削除）＝表の19、20
  - 番号なしの説明段落との対応：OAuthと認可の仕組み（表の1、2、5）＝「利用の形（Access model）」、トークンの暗号化保存と保存期間（表の7、23、24）＝「保存期間」、AIによる返信下書き（表の16）＝「データの扱い」、読み取りだけの定期再同期（表の22）＝「自動化」。連携したGoogleアカウントのメールアドレス（表の3）は §2-2 に記載。
- 「未実装」の行（25〜32）は申請文の提供機能に含めない。うち自動化の不在（30、31）と間接利用の不在（32）は、`/terms/` §3 と `/privacy/` §6 にも明記している。
- デッドコード（33）は申請文に書いていない。コードと文書の不一致を残さないため削除した。
