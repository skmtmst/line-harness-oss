import type { CodexMentionQueueMessage } from './services/codex-cloud-types.js';

export type WorkerBindings = {
    OPERATOR_PUSH_VAPID_PUBLIC_KEY?:string;
    OPERATOR_PUSH_VAPID_PRIVATE_KEY?:string;
    OPERATOR_PUSH_VAPID_SUBJECT?:string;
    DB: D1Database;
    BUILD_GIT_COMMIT?: string;
    BUILD_VERSION?: string;
    BUILD_RELEASED_AT?: string;
    /** 外部ファイル検査の許可組（host=FILE_SCAN_SECRET_X、カンマ区切り）。未設定なら内蔵検査のみ。 */
    FILE_SCAN_ALLOWED_PAIRS?: string;
    IMAGES: R2Bucket;
    /** 飲食店向けの受信メール原本。本番 wrangler.toml には束縛が無いので任意 */
    RAW_MAIL?: R2Bucket;
    ASSETS: Fetcher;
    AI?: Ai;
    /**
     * バナー生成の用途寸法への整形（Cloudflare Images・R120）。
     * R2 の `IMAGES` とは別物なので `CF_IMAGES` という名前にしている。
     * 未設定の環境（手元・試験）では変換を飛ばして元の画像を保存する。
     */
    CF_IMAGES?: ImagesBinding;
    /** 運営コンソールの返信下書きに使う Workers AI のモデル名。未設定なら routes/ops-support.ts の既定。 */
    OPS_SUPPORT_AI_MODEL?: string;
    EMAIL?: SendEmail;
    CONTACT_EMAIL?: string;
    SUPPORT_INBOUND_EMAIL?: string;
    RESTAURANT_INTAKE_DOMAIN?: string;
    RESTAURANT_TEST_ENABLED?: string;
    GOOGLE_BUSINESS_ENABLED?: string;
    DEPLOY_ENV?: string;
    /** Q-75: staging only, with a mandatory outbound stop and resource identity checks. */
    STAGING_QA_ENABLED?: string;
    STAGING_QA_OUTBOUND_DISABLED?: string;
    /** Positive integer overrides by fixed security rule key (JSON). Invalid values use safe defaults. */
    SECURITY_MONITOR_THRESHOLDS?: string;
    /** Dedicated AES-GCM key held as a Worker secret, never a normal var. */
    GOOGLE_CALENDAR_CREDENTIAL_ENCRYPTION_KEY?: string;
    /**
     * デリバリー受注（Uber Eats・出前館・ロケットナウ）の接続設定。
     * 送信は 'true' のときだけ行う。未設定の環境では台帳へ記録して送らない。
     * 受信の合言葉は32文字以上でないと受け取らない（短い鍵は使わない）。
     */
    RT_DELIVERY_SEND_ENABLED?: string;
    RT_DELIVERY_UBEREATS_API_BASE_URL?: string;
    RT_DELIVERY_UBEREATS_API_TOKEN?: string;
    RT_DELIVERY_UBEREATS_WEBHOOK_SECRET?: string;
    RT_DELIVERY_DEMAECAN_API_BASE_URL?: string;
    RT_DELIVERY_DEMAECAN_API_TOKEN?: string;
    RT_DELIVERY_DEMAECAN_WEBHOOK_SECRET?: string;
    RT_DELIVERY_ROCKETNOW_API_BASE_URL?: string;
    RT_DELIVERY_ROCKETNOW_API_TOKEN?: string;
    RT_DELIVERY_ROCKETNOW_WEBHOOK_SECRET?: string;
    /**
     * Uber Eats のログイン連携（設定 › デリバリー連携からお店の人が自分でつなぐ経路）。
     * Uber の開発者画面で発行された値を、環境ごとの秘密設定として入れる。
     * 入れるのは2つだけで、戻り先URLは WORKER_PUBLIC_URL から組み立てる。
     * 2つそろわない環境では連携の口を開けない。
     */
    RT_DELIVERY_UBEREATS_CLIENT_ID?: string;
    RT_DELIVERY_UBEREATS_CLIENT_SECRET?: string;
    /** 既定では使わない。Uber 側の登録が別の文字列のときだけ上書きとして入れる。 */
    RT_DELIVERY_UBEREATS_REDIRECT_URI?: string;
    RAW_MAIL_RETENTION_DAYS?: string;
    RESTAURANT_REQUEST_HOLD_END_HOUR?: string;
    XSERVER_MAIL_HOST?: string;
    XSERVER_MAIL_USER?: string;
    XSERVER_MAIL_PASSWORD?: string;
    XSERVER_RELAY_URL?: string;
    XSERVER_RELAY_SECRET?: string;
    MEET_CALLBACK_SECRET?: string;
    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    API_KEY: string;
    LEGACY_API_KEY?: string;
    LIFF_URL: string;
    LINE_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_SECRET: string;
    /**
     * 管理画面ログイン専用のLINE Loginチャネル。他社向けサービスの入口を
     * 自社プロバイダーから切り離すために使う。未設定なら
     * `LINE_LOGIN_CHANNEL_ID` / `LINE_LOGIN_CHANNEL_SECRET` を使う。
     * 会員向けLIFF連携（`routes/liff.ts`）はこの設定を見ない。
     */
    ADMIN_LINE_LOGIN_CHANNEL_ID?: string;
    ADMIN_LINE_LOGIN_CHANNEL_SECRET?: string;
    /** Stripe Webhook署名キー。未設定時はStripe受信ルートだけ503で拒否する。 */
    STRIPE_WEBHOOK_SECRET?: string;
    BOOKING_STRIPE_TEST_SECRET_KEY?: string;
    BOOKING_STRIPE_TEST_CLIENT_ID?: string;
    BOOKING_STRIPE_CONNECT_REDIRECT_URI?: string;
    /** 統括のバナー生成（OpenAI 画像生成）。未設定時は生成だけ503で断る。 */
    OPENAI_API_KEY?: string;
    /** operations-only deployment flag; production is always closed. */
    G2_OPENAI_ENABLED?: string;
    /** 画像生成モデル名。未設定時は gpt-image-1。 */
    OPENAI_IMAGE_MODEL?: string;
    /** 統括ごとの月間生成上限（枚）。未設定時は150。料金プラン導入後はプランの値を使う。 */
    BANNER_MONTHLY_IMAGES?: string;
    /** 生成の品質（low|medium|high）。運用者には選ばせず、未設定時は medium。 */
    BANNER_IMAGE_QUALITY?: string;
    /** 統括からのお問い合わせを知らせる運営の宛先。未設定なら CONTACT_EMAIL。 */
    SUPPORT_NOTIFY_EMAIL?: string;
    /** 統括の課金（Stripe サブスクリプション）。値は secret／var で持ち、ここには書かない。 */
    STRIPE_SECRET_KEY?: string;
    STRIPE_BILLING_WEBHOOK_SECRET?: string;
    STRIPE_PRICE_LIGHT?: string;
    STRIPE_PRICE_STANDARD?: string;
    STRIPE_PRICE_PRO?: string;
    STRIPE_PRICE_LIGHT_YEAR?: string;
    STRIPE_PRICE_STANDARD_YEAR?: string;
    STRIPE_PRICE_PRO_YEAR?: string;
    /** 会員登録・パスワード再設定のロボット対策（Cloudflare Turnstile）の秘密の鍵。未設定なら登録を受け付けない。 */
    TURNSTILE_SECRET_KEY?: string;
    TOTP_ENCRYPTION_KEY?: string;
    /** 署名済みの配備イベント受信用。管理画面へは公開しない。 */
    OPERATIONS_DEPLOYMENT_SIGNING_SECRET?: string;
    // AES-GCM key for credentials stored in line_accounts. Optional so a
    // missing secret does not stop unrelated Worker routes from starting.
    LINE_CREDENTIAL_ENCRYPTION_KEY?: string;
    /** 飲食店向けGoogleビジネス：利用者のGoogleアカウントで認可するOAuthクライアント。環境ごとに分ける。 */
    GOOGLE_BUSINESS_OAUTH_CLIENT_ID?: string;
    GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET?: string;
    /** 'true' のときだけGoogleへ書き込む（口コミ返信の公開）。既定は読み取りのみ。 */
    GOOGLE_BUSINESS_WRITE_ENABLED?: string;
    /** 口コミ返信の下書きに使う Workers AI のモデル。未設定なら OPS_SUPPORT_AI_MODEL → 既定値。 */
    GOOGLE_BUSINESS_AI_MODEL?: string;
    /** 口コミ返信の下書きに使う OpenAI のモデル。未設定なら既定値。OPENAI_API_KEY が無い環境では Workers AI を使う。 */
    GOOGLE_BUSINESS_TEXT_MODEL?: string;
    /** Google Sheets連携(#838)：利用者のGoogleアカウントで認可するOAuthクライアント。環境ごとに分ける。 */
    GOOGLE_SHEETS_OAUTH_CLIENT_ID?: string;
    GOOGLE_SHEETS_OAUTH_CLIENT_SECRET?: string;
    ECCUBE_WEBHOOK_SECRET?: string;
    /** 予約のStripeテストの知らせ署名の検証鍵。値ではなく有無だけ画面に出す。 */
    STRIPE_TEST_WEBHOOK_SECRET?: string;
    NEN_EC_BASE_URL?: string;
    /** ECの会員別ランクAPIを配備した後だけ true にする。未設定は送信停止。 */
    NEN_EC_MEMBER_RANK_SYNC_ENABLED?: string;
    NEN_RICH_MENU_STORE_URL?: string;
    WORKER_URL: string;
    // Admin auth topology (see middleware/admin-auth-config.ts):
    ADMIN_ORIGIN?: string;          // Comma-separated admin web origin allowlist for credentialed CORS
    ADMIN_COOKIE_SAMESITE?: string; // Optional override: 'Strict' | 'Lax' | 'None'
    ADMIN_ALLOW_CROSS_SITE?: string; // 'true' opts into SameSite=None cross-site cookies
    X_HARNESS_URL?: string;  // Optional: X Harness API URL for account linking
    META_APP_ID?: string;
    META_APP_SECRET?: string;
    // Instagram API with Instagram Login (no Facebook Page). Separate credentials
    // from META_APP_*: App Dashboard > Instagram > API setup with Instagram login.
    INSTAGRAM_APP_ID?: string;
    INSTAGRAM_APP_SECRET?: string;
    META_REDIRECT_URI?: string;
    META_GRAPH_API_VERSION?: string;
    META_TOKEN_ENCRYPTION_KEY?: string;
    META_WEBHOOK_VERIFY_TOKEN?: string;
    IG_HARNESS_URL?: string;  // Optional: IG Harness API URL for cross-platform linking
    IG_HARNESS_LINK_SECRET?: string;  // Shared secret for IG Harness link-line webhook
    // Phase 5 self-update — consumed by /admin/update/*. Defaults live in
    // wrangler.toml [vars]; secrets (CF_API_TOKEN, ADMIN_API_KEY) come from
    // `wrangler secret put`. All are optional at the type level so the rest
    // of the worker still type-checks in test environments that don't set
    // them; the /admin/update/* route guards on their presence at runtime.
    ADMIN_API_KEY?: string;
    CF_API_TOKEN?: string;
    CF_ACCOUNT_ID?: string;
    /** R2 S3 API credentials are Worker secrets. Bucket name is a non-secret deployment var. */
    MEDIA_R2_ACCESS_KEY_ID?: string;
    MEDIA_R2_SECRET_ACCESS_KEY?: string;
    MEDIA_R2_BUCKET_NAME?: string;
    WORKER_NAME?: string;
    ADMIN_PAGES_PROJECT?: string;
    LIFF_PAGES_PROJECT?: string;
    D1_DATABASE_ID?: string;
    MANIFEST_URL?: string;
    WORKER_PUBLIC_URL?: string;
    /**
     * Comma-separated extra origins that reach this same Worker (for example
     * its workers.dev address). A LINE webhook registered on one of them is
     * treated as pointing at this environment.
     */
    WORKER_ALIAS_URLS?: string;
    ADMIN_PUBLIC_URL?: string;
    LIFF_PUBLIC_URL?: string;
    // Google Calendar booking sync. Store the private key as a Worker secret.
    // Calendar owners only enter/share their Google Calendar ID in admin UI.
    GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
    // Read-only Google Search Console performance dashboard.
    SEARCH_CONSOLE_SITE_URL?: string;
    // Codex lifecycle events -> Slack relay. Tokens/secrets are Worker secrets;
    // channel ids and range mapping are non-secret deployment variables.
    CODEX_SLACK_RELAY_SECRET?: string;
    CODEX_SLACK_RELAY_SECRET_KENTA?: string;
    CODEX_SLACK_RELAY_SECRET_MASATO?: string;
    /** AI開発ループの報告専用HMAC鍵。既存のCodex中継鍵と共有しない。 */
    AI_LOOP_SLACK_REPORT_SECRET?: string;
    SLACK_BOT_TOKEN?: string;
    SLACK_COMMAND_CHANNEL_ID?: string;
    SLACK_ERROR_CHANNEL_ID?: string;
    SLACK_IDEA_CHANNEL_ID?: string;
    SLACK_DEFAULT_PR_CHANNEL_ID?: string;
    SLACK_PR_CHANNELS_JSON?: string;
    SLACK_KENTA_USER_ID?: string;
    SLACK_MASATO_USER_ID?: string;
    SLACK_TASK_CHANNEL_ID?: string;
    /** AI開発ループの一方向レポート専用。Slackからの操作には使用しない。 */
    SLACK_AI_LOOP_CHANNEL_ID?: string;
    SLACK_SIGNING_SECRET?: string;
    SLACK_USER_TOKEN?: string;
    // Slack mention -> official Codex receipt -> user-authored Slack relay.
    // User ids and grace time are non-secret vars. Tokens and signing secret
    // must be stored with `wrangler secret put`.
    CODEX_SLACK_USER_ID?: string;
    CODEX_SLACK_MONITOR_SIGNING_SECRET?: string;
    CODEX_ALLOWED_TEAM_IDS?: string;
    CODEX_ALLOWED_CHANNEL_IDS?: string;
    CODEX_ALLOWED_CHANNEL_NAME_PREFIXES?: string;
    CODEX_RELAY_SOURCE_USER_IDS?: string;
    CODEX_RELAY_ENABLED?: string;
    // Claude監査合格のSlack合図 -> codex/development専用マージ。
    // GitHub tokenはWorker secret。未設定・falseなら検知のみで停止する。
    CODEX_AUTO_MERGE_ENABLED?: string;
    CODEX_AUTO_MERGE_REPOSITORY?: string;
    CODEX_AUTO_MERGE_GITHUB_TOKEN?: string;
    CODEX_QUEUE_MAX_ATTEMPTS?: string;
    CODEX_OFFICIAL_RECEIPT_GRACE_SECONDS?: string;
    CODEX_MENTION_QUEUE?: Queue<CodexMentionQueueMessage>;
};
