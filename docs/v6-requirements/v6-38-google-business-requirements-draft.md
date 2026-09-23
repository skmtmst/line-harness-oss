# V6 38 Googleビジネス（飲食店向け）要件定義（下書き）— 第1段：設定＋口コミ

作成日: 2026-09-23
対象: 飲食店パック内「Googleビジネス」（Pencil `V6正本.pen` ★V6 GB-1〜GB-16、1920px×16・1440px×3）
今回の範囲: **第1段＝設定タブ（Google接続）＋口コミタブ（一覧・AI返信下書き・公開）**。投稿・パフォーマンス・プロフィール／営業時間は第2段以降。
決定の元: プロジェクト文書 `claude/decision-google-business-v6-20260923.md`、`claude/review-google-business-v6-20260923.md`

---

## 【環境基準】

| 項目 | 値 |
|---|---|
| 確認日時 | 2026-09-23 JST |
| EC基準SHA | `origin/codex/development` = `8c3a0fc7`（EC側 `NEN_ENVIRONMENT_STATUS.md` 19:19 JST）。**今回EC側の変更なし** |
| LINE基準SHA | `origin/codex/development` = `e02b1086`（LINE側 `NEN_ENVIRONMENT_STATUS.md` 19:25 JST）。要件作成時の読み取りは `1f6cc1c4`（統合PR 466、同日18:03 UTC+7）で実施 |
| 検証環境 | LINE側：`e02b1086` をWorker・管理画面とも配備済み（GitHub Actions run 35842377511）。EC側：`75f67b1a`（devより古い、今回無関係） |
| 本番環境 | 両側とも配備SHA未確認。**本番は今回の対象外** |
| 対象環境 | 開発 → 検証（staging）。本番は含めない |
| 作業ツリー | LINE側の未コミット46項目は所有者確認済み（Claude・運営コンソール第1段の作業コピー、devに取り込み済み。`claude/finding-line-worktree-46-changes-owner-20260923.md`）。整理はCodexが実施中 |
| 使用した資料 | Pencil GB-1〜GB-16、`docs/restaurant-test-architecture.md`、`apps/worker/src/routes/restaurant-test.ts`、`packages/db/migrations/168_restaurant_test_foundation.sql`・`173_restaurant_store_line_account.sql`、`apps/worker/src/routes/admin-auth.ts`（OAuthの型）、`apps/worker/src/routes/ops-support.ts`（AI下書きの型）、`packages/db/src/credential-crypto.ts`、`docs/line-credential-encryption.md`、`apps/worker/src/middleware/feature-enforcement.ts`、`docs/v6-common-rules.md`、`AGENTS.md` |

---

## 【目的】

- 飲食店の現場担当者が、LINE管理システムの中で、自店のGoogleビジネスプロフィールの口コミを確認し、AIの下書きを人が確認してから返信できるようにする。
- 利用者：飲食店パックを付与された統括（owner）、店舗管理者（admin）、スタッフ（staff）。
- 解決する問題：口コミ返信のためにGoogleの管理画面へ切り替える手間、返信漏れ、返信文を書く負担。

---

## 【現在の状態】

### 実装済み（`restaurant-test.ts` 読み取り）
- 飲食店パックの土台：`rt_organizations` / `rt_stores`（`line_account_id` で 1店舗＝1 LINEアカウント）/ `rt_memberships`。
- 旧「Google・口コミ」画面（`/restaurant-test/google`、`GooglePanel`）：外部通信なしのダミー。`rt_gbp_reviews` の下書き保存（`PUT /api/restaurant-test/gbp/reviews/:id/draft`）と `rt_gbp_posts` への承認申請登録のみ。
- 認可：`/api/restaurant-test/*` は `RESTAURANT_TEST_ENABLED=true` のときだけ有効。`tenant_id`・`account_id` の範囲検査あり。機能キーは `restaurant_test`（`FEATURE_ROUTE_MANIFEST`）。
- 秘密値の暗号化：`encryptCredential` / `decryptCredential`（AES-256-GCM、鍵 `LINE_CREDENTIAL_ENCRYPTION_KEY`）。
- AI：Workers AI バインディング `AI`（`ops-support.ts` の下書き生成パターン、タイムアウト45秒、注入対策文あり）。

### 未実装
- Google OAuth（利用者のGoogleアカウントで認可する流れ）。Google Calendar等はサービスアカウント方式で、今回の型には使えない。
- Google Business Profile API への通信一切。
- 口コミの取得・保存・返信公開。
- 新設計（GB-1〜GB-16）のV6画面。

### 既知の問題・制約
- 旧テーブル `rt_gbp_reviews` / `rt_gbp_posts` はCHECK制約が新設計と合わない（返信公開日時・Googleのリソース名・公開済み返信文の列が無い）。SQLiteでCHECKを変えるには表の作り直しが要るため、**新しい表を追加し、旧表は読まない**（決定#2）。
- **検証環境の `wrangler.staging.toml` には意図的にCronが無い。** 定期再同期・予約投稿は検証環境では動かない。第1段は「画面を開いたとき／同期ボタン」の手動同期だけで成立させる。
- `google_business_profile` という機能IDは `REMOVED_GHOST_FEATURE_IDS` で禁止されている。機能キーは `restaurant_test` のまま。
- 旧画面の `rt_connector_status.mode` は `disabled|inbound_only` のみ。書き込みを表す値が無いので、接続状態は新表で持つ。

### 今回変更しない範囲
- 投稿（GB-4〜GB-8、GB-14）、パフォーマンス（GB-9）、プロフィール・営業時間（GB-10〜GB-12）。
- 権限の実効化（閲覧／下書き／公開／接続管理の4分類は要件として記録し、第1段では既存の owner/admin/staff にそのまま対応させる）。
- Pub/Sub通知、Cronによる定期再同期、予約投稿。
- EC側リポジトリ。本番環境。

---

## 【機能要件】

### A. 設定タブ（GB-1 未接続 / GB-13 接続済み）

| # | 利用者の操作 | システムの動作 | 正常時の結果 |
|---|---|---|---|
| A-1 | 「Googleアカウントを接続」を押す | state（CSRF用の乱数）とPKCEを発行し、HttpOnly Cookieに保存してGoogleの認可画面へ転送する。スコープは `business.manage` のみ。`access_type=offline`、`prompt=consent` | Googleの同意画面が開く |
| A-2 | Googleで許可する | コールバックで state を照合 → 認可コードをトークンに交換 → リフレッシュトークンを暗号化して保存 → Googleの `accounts` と各 `locations` を取得 | 管理可能な店舗が1つなら自動で紐付け、複数なら設定タブ内で「どの店舗をこのLINEアカウントに結びつけますか」と1つ選ばせる（独立画面は作らない：決定#3） |
| A-3 | 店舗を選ぶ | 選んだロケーションの**リソース名**（`locations/…`）を保存する。店舗名は表示用に別途保存 | 「接続済み」表示。LINEアカウント／接続店舗／Googleアカウント（メール）を表示。口コミタブへ移動し初回取得を始める |
| A-4 | 「Googleアカウントを再接続」を押す | A-1〜A-2と同じ。ただしコールバックで**保存済みのロケーションと同一か検証**する | 同一なら接続を更新。違う店舗なら「別の店舗が選ばれました。変更するには一度接続を解除してください」と表示して**保存しない** |
| A-5 | 「接続を解除」を押す | 確認ダイアログを必須にする。承認後、トークンを破棄し、接続状態を `disconnected` にする。**取得済み口コミ・下書き・監査ログは残す**（決定#4） | 未接続表示に戻る。以後、同期とGoogleへの書き込みを止める |

- 未接続時は口コミ・投稿・パフォーマンス・プロフィールの4タブを**表示したまま無効**にし、押すと「Googleアカウントを接続すると使えます」の案内だけ出す（レビュー結論）。
- 初期表示は口コミタブ固定。未接続なら設定タブを直接開く。認可切れなら口コミタブ＋上部に「認可切れ」帯（GB-15）。

### B. 口コミタブ（GB-2 一覧 / GB-3 AI下書き / GB-16 公開確認 / GB-15 状態）

| # | 利用者の操作 | システムの動作 | 正常時の結果 |
|---|---|---|---|
| B-1 | 口コミタブを開く | 保存済みの口コミを表示する。最終同期から一定時間（既定10分）過ぎていれば裏で同期を開始する | 要約帯：総合評価・総件数（**Googleの集計値**）・新着件数・未返信件数。一覧：投稿者名・評価・本文・受信日時・状態 |
| B-2 | 「同期する」を押す | 口コミ一覧APIをページの最後まで取得し、`external_review_id` で upsert する。総合評価・総件数はAPI応答の値を保存する | 「取得済み（今日 12:42）」。新着は前回同期以降に増えた件数 |
| B-3 | 絞り込み（未返信／下書きあり／すべて／評価／並び順／検索） | サーバー側で絞り込む。検索は投稿者名・本文の部分一致 | 一覧が更新される。戻ったときフィルタ・ページを保持する |
| B-4 | 「返信を作成」または「下書きを確認」 | GB-3を開く。AI下書きが無ければ「作り直す」で生成できる | 原文・評価・日時・「Googleで原文を確認」リンク（口コミURLが取れなければ店舗のマップURL） |
| B-5 | 「作り直す」「短くする」 | Workers AI に**口コミ本文・評価・店舗名だけ**を送る（投稿者名は送らない）。注入対策文を付ける。生成文に「AIが作成した文章です」の注記 | 下書きが返信文欄に入る。`ai_generated=true`・生成日時を保存 |
| B-6 | 「下書き保存」 | 返信文を `reply_draft` に保存（Googleへは送らない） | 一覧の状態が「AI下書きあり」または「下書きあり」 |
| B-7 | 「返信内容を確認」→ GB-16 で「この内容で返信する」 | チェック「返信先・内容・個人情報の有無を確認しました」が必須。送信直前に**その口コミを個別に再取得**し、すでに返信済みなら止めて差分を表示する。返信APIを呼ぶ | 状態を `replied`（受理）にし、公開済み返信文と公開日時を保存。「送信後、Googleの処理を経て表示」の案内。次回同期でGoogle側の返信文と照合し `published` へ |
| B-8 | 状態表示（GB-15） | 取得中／初回取得（n／総数）／0件／認可切れ／権限なし／反映確認中 | 前回取得分を0件で上書きしない。取得時刻を併記 |

- 「要確認」ラベル：**評価が★3以下の口コミに自動で付ける**（決定#9）。AI判定はしない。
- 返信文の長さ上限はサーバー側でも検証する（Google側の上限は要確認。暫定 4,096 文字）。

### エラー・中断・再送・重複時の動作

| 状況 | 動作 |
|---|---|
| state不一致・Cookie欠落 | 保存せず設定タブへ戻し「認可をやり直してください」 |
| トークン交換失敗／`invalid_grant`（失効・取り消し） | 接続状態を `expired` にし、GB-15「認可切れ」帯。下書きは保持 |
| Googleが403（店舗の管理権限なし） | 接続状態 `no_permission`。「この店舗を操作する権限がありません」。店舗切替は出さない |
| 429・5xx（割当超過・Google側障害） | 指数バックオフで最大3回。失敗したら「あとで確認」表示。前回データは保持 |
| 返信送信後に応答不明（タイムアウト） | 状態を `pending_confirm` にし、**再送前に個別再取得で照合**。Google側に返信があれば `replied` に揃え、無ければ再送を許可 |
| 同じ口コミに2人が同時に返信 | 送信直前の個別再取得で「すでに返信済み」を検出して止め、相手の返信文を表示 |
| 検証・本番の二重接続 | 接続時に「この店舗は別環境で接続済み」を検出する手段は無い（Google側に情報が無い）ため、**運用ルール**で同じ店舗を同時に接続しない（決定#8'）。環境帯に環境名を常時表示 |

### 権限ごとの違い（第1段の対応）

| 操作単位（要件上の名前） | owner（統括） | admin（店舗管理者） | staff |
|---|---|---|---|
| 閲覧（一覧・下書き・状態） | ○ | ○ | ○ |
| 下書き作成（AI生成・保存） | ○ | ○ | ○ |
| Googleへ公開（返信送信） | ○ | ○ | × |
| 接続管理（接続・再接続・解除） | ○ | × | × |

- 実装は既存の `requireRole` で行う。staff が使う読み取り・下書きルートは `STAFF_EXPLICIT_ALLOW` に追加する。
- 上表は決定#7（統括＝全部、店舗管理者＝閲覧〜公開、スタッフ＝閲覧・下書き）に対応する。

---

## 【データ・外部連携】

### DB変更：あり（追加のみ。旧 `rt_gbp_*` は変更・削除しない）

| 表 | 役割 | 主な列（案） |
|---|---|---|
| `rt_google_connections` | 店舗ごとのGoogle接続 | `id`, `store_id`(UNIQUE), `line_account_id`, `google_account_email`, `location_name`（リソース名）, `location_title`, `refresh_token_enc`（暗号化）, `access_token_enc`, `access_token_expires_at`, `status`(`connected|expired|no_permission|disconnected`), `connected_by_staff_id`, `connected_at`, `disconnected_at`, `last_synced_at`, `last_error`, `average_rating`, `total_review_count`, `created_at`, `updated_at` |
| `rt_google_oauth_states` | 認可中の一時状態（Cookieと突き合わせ） | `state`(PK), `store_id`, `line_account_id`, `staff_id`, `code_verifier_enc`, `mode`(`connect|reconnect`), `expires_at` |
| `rt_google_reviews` | 取得した口コミ | `id`, `store_id`, `review_name`（Googleのリソース名, UNIQUE with store）, `reviewer_display_name`, `star_rating`(1–5), `comment`, `create_time`, `update_time`, `needs_attention`(★3以下), `reply_status`(`unreplied|draft|pending_confirm|replied|published`), `reply_draft`, `reply_draft_ai_generated`, `reply_draft_generated_at`, `reply_comment`（公開済み）, `reply_update_time`, `first_seen_at`, `updated_at` |
| `rt_google_write_log` | Googleへの書き込みの監査 | `id`, `store_id`, `kind`(`review_reply|disconnect|…`), `target_name`, `staff_id`, `before_text`, `after_text`, `request_id`, `result`(`accepted|failed|unknown`), `error`, `created_at` |

- 投稿者の表示名はGoogleが公開している情報だが、返信AIへは送らない。`reviewer_display_name` 以外の個人情報は保存しない。
- マイグレーション番号は作成直前に `origin/codex/development` と公開中PRで未使用の最大番号＋1を採番する（要件作成時点の最大は `444`）。

### API変更：あり（すべて `/api/restaurant-test/google/*` 配下、機能キー `restaurant_test`）

| メソッド・パス | 役割 | 権限 |
|---|---|---|
| `GET  /google/connection` | 接続状態・店舗・要約 | owner/admin/staff |
| `POST /google/connect/start` | state発行→認可URLを返す（画面側で遷移） | owner |
| `GET  /api/auth/google-business/callback` | Googleからの戻り（公開境界。stateで本人確認） | 公開（stateで保護） |
| `POST /google/connect/select-location` | 複数店舗時に1つ選ぶ | owner |
| `POST /google/disconnect` | 解除（確認トークン必須） | owner |
| `POST /google/reviews/sync` | 全件同期 | owner/admin/staff |
| `GET  /google/reviews` | 一覧（絞り込み・ページ） | owner/admin/staff |
| `GET  /google/reviews/:id` | 詳細 | owner/admin/staff |
| `POST /google/reviews/:id/draft/generate` | AI下書き生成（`mode`: `new|shorter|polite`） | owner/admin/staff |
| `PUT  /google/reviews/:id/draft` | 下書き保存 | owner/admin/staff |
| `POST /google/reviews/:id/reply` | 返信を公開（確認済みフラグ必須） | owner/admin |

- コールバックは `/api/auth/google-business/callback` とし、`isPublicApiBoundary` と `openapi.ts` に追加する（`openapi-coverage.test.ts` の対象）。
- `route-guard-coverage.test.ts` の `STAFF_FAIL_CLOSED_SNAPSHOT` に owner/admin 専用ルートを追加する。

### 外部連携への影響

| 対象 | 影響 |
|---|---|
| Google Business Profile API | 新規。`accounts.list`、`accounts.locations.list`、`reviews.list`、`reviews.get`、`reviews.updateReply`。既定割当300 QPM |
| LINE / 決済 / メール / TikTok / 倉庫 | なし |
| Webhook | なし（Pub/Sub通知は第2段以降） |
| Cron | **なし**（検証環境にCronが無いため、第1段は手動同期のみ） |
| Workers AI | 既存バインディング `AI` を使用。モデルは `ops-support.ts` と同じ既定値。呼び出し記録は `rt_google_write_log` とは別に `platform_ai_calls` を使えない（purpose CHECK）ため、`rt_google_reviews` の生成日時で代替 |

### 環境変数・秘密情報（値は記載しない）

| 名前 | 種別 | 検証 | 本番 |
|---|---|---|---|
| `GOOGLE_BUSINESS_OAUTH_CLIENT_ID` | 環境変数（新規） | 未設定 → Masatoが設定 | 対象外 |
| `GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET` | Secret（新規） | 未設定 → Masatoが設定 | 対象外 |
| `GOOGLE_BUSINESS_WRITE_ENABLED` | 環境変数（新規、`true` のときだけGoogleへ書き込む。既定 `false`） | 検証で明示的に `true` にする（決定#8'） | 対象外 |
| `LINE_CREDENTIAL_ENCRYPTION_KEY` | 既存Secret（トークン暗号化に流用） | 設定済み（既存機能が使用中） | 対象外 |
| `RESTAURANT_TEST_ENABLED` / `NEXT_PUBLIC_RESTAURANT_TEST_ENABLED` | 既存 | `true` | `false` |
| `AI` バインディング | 既存 | 設定済み | 設定済み |

- OAuthクライアントは検証用と本番用で分ける（決定#8'）。リダイレクトURIはWorkerの `/api/auth/google-business/callback`。

---

## 【セキュリティ要件】

- **認証・認可**：全ルートは既存の `authMiddleware` → `tenantScopeMiddleware` → `featureEnforcementMiddleware` を通す。店舗は必ず `rt_stores.line_account_id ∈ 許可されたLINEアカウント` で絞る（`design-restaurant-account-isolation-20260827.md` 原則3）。
- **OAuth**：state はランダム値、HttpOnly・Secure・SameSite=Lax、10分で失効、1回使い切り。PKCE（S256）を使う。コールバックの `state` はDBの `rt_google_oauth_states` と Cookie の両方で照合。
- **トークン**：リフレッシュトークン・アクセストークンは `encryptCredential` で暗号化して保存。ログ・エラー文・API応答に平文を含めない。`GET /google/connection` はトークンを返さない。
- **入力値検証**：返信文は空・上限超過・制御文字を拒否。`mode` は列挙値のみ。`review id` は自店舗に属するものだけ。
- **CSRF**：既存の `X-CSRF-Token` を全ミューテーションに適用。コールバックはGET（副作用は state 検証後の保存のみ）。
- **再送・重複防止**：返信公開は「確認済みフラグ」＋送信直前の個別再取得＋`rt_google_write_log` の `request_id`。応答不明時は `pending_confirm` にして自動再送しない。
- **個人情報・ログ**：AIへ送るのは本文・評価・店舗名のみ。投稿者名・口コミURL・トークンはAIとログに出さない。`audit_events` には対象口コミのIDだけ。
- **環境分離**：`GOOGLE_BUSINESS_WRITE_ENABLED` が `true` でない環境ではGoogleへの書き込みAPIを呼ばず、画面に「この環境では公開できません」を出す。検証と本番でOAuthクライアントを分ける。環境帯（`OGkIw`）を常時表示。
- **外部AIの利用説明**：GB-3の注記「AIが作成した文章です。事実・表現を確認し…」を実装に含める。口コミ本文をWorkers AIへ送ることを設定タブの説明文に明記する。

---

## 【テスト・合格条件】

### 正常系
1. 未接続 → 接続開始 → コールバック（state一致）→ 店舗1件 → 接続済み。`rt_google_connections.status='connected'`、トークンが暗号化形式（`v1.` 始まり）で保存される。
2. 店舗が複数のGoogleアカウント → 選択画面（設定タブ内）→ 選択後に接続済み。
3. 同期：モックのGoogle応答（2ページ、計60件）を最後まで取得し、`rt_google_reviews` が60行、総合評価・総件数がAPI値と一致。2回目の同期で件数が増えない（upsert）。
4. AI下書き生成：Workers AIモックが返す文が下書きに入り、`reply_draft_ai_generated=1`。AIへ送ったペイロードに投稿者名が含まれない。
5. 返信公開：確認フラグありで `reviews.updateReply` モックが呼ばれ、`reply_status='replied'`、`rt_google_write_log` に1行。
6. 再接続：同一ロケーションなら更新、別ロケーションなら拒否。
7. 解除：確認トークンありで `disconnected`、口コミ行は残る。

### 異常系
1. state不一致 → 401/リダイレクト、DBに接続が作られない。
2. `invalid_grant` → `status='expired'`、下書きが消えない。
3. 403 → `status='no_permission'`。
4. 429×3 → 同期失敗、前回の行が残る、`last_error` に記録、トークン平文なし。
5. 返信送信でタイムアウト → `pending_confirm`。次の同期で返信ありなら `replied` に揃う。
6. 送信直前に既に返信済み → 409 と相手の返信文。
7. `GOOGLE_BUSINESS_WRITE_ENABLED` 未設定で返信公開 → 403、Googleモックが呼ばれない。
8. 返信文 4,097 文字 → 400。

### 権限テスト
- staff：一覧・詳細・生成・下書き保存は 200、返信公開・接続・解除は 403。
- admin：返信公開 200、接続・解除 403。
- 別テナント／範囲外の `account_id` → 403（既存ミドルウェア）。
- 別店舗の口コミIDを指定 → 404。

### 回帰テスト
- `feature-route-manifest.test.ts`、`route-guard-coverage.test.ts`、`openapi-coverage.test.ts`、`restaurant-db-routing.test.ts`、`feature-catalog.test.ts`、`sidebar-design.test.ts`、`bootstrap-drift.test.ts`、`check-migrations` が全て通る。
- 旧 `rt_gbp_*` ルート・表を変更しないこと（旧画面は新画面に置き換えるため、メニュー項目名は「Googleビジネス」に変更し、`sidebar-design.test.ts` と `menu-catalog.ts` を同時に更新）。

### 検証環境で確認する項目
1. Masatoの実店舗でOAuth接続 → 店舗名が正しく表示される。
2. 実口コミの全件取得件数と総合評価が、Googleの管理画面の表示と一致する。
3. テスト用の口コミ1件に対し、AI下書き→編集→公開→Google側に表示されるまでを確認し、取り消す（Google側で返信を削除）。
4. 接続解除 → 再接続で同一店舗が維持される。
5. `GOOGLE_BUSINESS_WRITE_ENABLED` を外した状態で公開ボタンが止まる。

### 完了と判断できる条件
- 上記の正常系7・異常系8・権限4が自動テストで通り、回帰テストが全て緑。
- 検証環境で「検証環境で確認する項目」1〜5が確認できる。
- Pencil GB-1・GB-2・GB-3・GB-13・GB-15・GB-16 の実ノードIDと1920pxの比較画像がPRの Visual Parity 欄に記録されている。

---

## 【要確認事項】

### Masatoの判断が必要
1. **旧「Google・口コミ」メニュー項目の扱い**：新画面へ差し替える際、URLは `/restaurant-test/google` のまま流用してよいか（推奨：流用。ブックマーク互換）。
2. **Google Cloud側の設定**：OAuthクライアント（検証用）の作成と、リダイレクトURI `https://<検証Workerのホスト>/api/auth/google-business/callback` の登録。**手順書は要件承認後にClaudeが書く。**
3. **Cron**：第1段は手動同期のみ。第2段（定期再同期・予約投稿）に進むとき、`wrangler.staging.toml` へ `[triggers]` を足すか（環境設定変更のため要承認）。

### 現在の資料だけでは断定できない
1. Business Profile API の返信文の文字数上限（暫定 4,096）。
2. 口コミ個別URL（`reviews.get` の応答にURLが含まれるか）。取れなければ店舗のマップURLへ。
3. Google側の「同一店舗を複数のOAuthクライアントが操作する」ことへの制限の有無。
4. Workers AI の既定モデルで日本語の返信文品質が十分か（検証環境で確認）。

### 本番前に確認が必要（今回は対象外）
1. OAuth同意画面の公開ステータスとアプリ審査の完了。
2. 本番用OAuthクライアントの分離。
3. 本番 `RESTAURANT_TEST_ENABLED` は現在 `false`。飲食店パックの本番有効化は別の判断。
