# 会員登録・メールログイン・パスワード再設定（★V6 0-1／36-4／36-6）

2026-09-13。決定は `docs/v6-requirements/v6-36-hq-account-billing-requirements-draft.md` §0-1・§3・§7。

## 流れ

1. `/register` でメールアドレスだけ入れる（Turnstile と同意が必要）
2. Worker が本登録の URL（24 時間・1 回限り）をメールで送る。返事は登録済みでも同じ「送りました」。登録済みの人には「すでに登録されています」のメールが届く
3. `/register/complete?token=` で会社名・名前・パスワードを入れる
4. 統括（`plan_status='trialing'`、`trial_ends_at=+30日`）とオーナー権限者ができ、そのままログイン状態で `/hq` へ
5. 以後は `/login` でメール＋パスワード。LINE で登録した権限者は今までどおり LINE で入れる
6. 忘れたら `/password/forgot` → メールの URL（1 時間・1 回限り）→ `/password/reset?token=`。設定するとその人のセッションはすべて失効

## 守り

| 何 | どう | どこ |
|---|---|---|
| ロボット | Cloudflare Turnstile。鍵が無ければ受け付けない | `services/turnstile.ts` |
| 同じブラウザで 2 回登録 | 本登録の返事の印を localStorage と Cookie（`lh_signup_marker`、1 年）に置き、次の依頼で一致したら 409 | `routes/auth-email.ts`、`tenants.signup_device_marker` |
| 迷惑な連打 | 登録依頼: 同じ接続元 5 件/日・同じメール 3 件/日。再設定: 10 件/日・3 件/日。パスワード失敗: メール＋接続元で 15 分に 10 回 | `auth_throttles`（D1） |
| メールの当て推量 | 返事はいつも同じ。ログイン失敗の言葉も 1 種類 | 同上 |
| URL の使い回し | ハッシュだけ保存、期限、1 回で消費（本登録は二重送信を防ぐため先に消費） | `auth_email_tokens` |
| パスワード | 8 文字以上・128 文字以内・英字と数字・空白なし。PBKDF2-SHA256（100,000 回、Workers の上限） | `services/password-hash.ts` |
| 二段階認証 | 有効な人はパスワードのあと既存の 6 桁コードへ | `services/admin-session.ts` |

「1 ブラウザ 1 回」は、ブラウザのデータを消す・別のブラウザを使うと抜けられる。普通の人の二重登録を防ぐためのもので、意図的な複数トライアルを完全には止めない。

## 設定

| 名前 | 場所 | 内容 |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Worker **secret** | Turnstile の秘密の鍵。未設定は登録と再設定が 503 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Web のビルド変数 | Turnstile のサイト用の鍵（公開してよい）。未設定は枠を出さず、送信ボタンが押せない |
| `NEXT_PUBLIC_TERMS_URL` `NEXT_PUBLIC_PRIVACY_URL` `NEXT_PUBLIC_COMMERCE_LAW_URL` | Web のビルド変数（任意） | 同意欄とフッターのリンク先。ページができるまでは未設定（文字だけ出す） |
| `ADMIN_PUBLIC_URL` | Worker var（既存） | メールに入れる URL の元 |
| `CONTACT_EMAIL` ほか | Worker（既存） | メールの差出人と送信経路（`services/plain-mail.ts`） |

Turnstile の鍵は Cloudflare ダッシュボード（Turnstile）でサイトを作ると 2 つ出る。値は Git にもチャットにも書かない。検証環境は `--config apps/worker/wrangler.staging.toml` を付けて `wrangler secret put TURNSTILE_SECRET_KEY`。Cloudflare が公開している常に通るテスト用の鍵は、検証環境で画面の確認に使える。

## データ（migration 292）

| 表・列 | 役割 |
|---|---|
| `staff_members.password_hash` / `password_updated_at` | パスワード。持つ人のメールは重複させない（部分ユニーク索引） |
| `auth_email_tokens` | 本登録・再設定の URL の元（ハッシュ・期限・消費済み・接続元のハッシュ・印） |
| `auth_throttles` | 回数制限（key ごとの回数と窓の開始） |
| `tenants.signup_device_marker` | 本登録したブラウザの印 |

## API（すべて認証なし。`middleware/auth.ts` の公開パス、`rate-limit.ts` の低い上限）

| 経路 | 内容 |
|---|---|
| `POST /api/auth/register/request` | `{ email, turnstileToken, agreed: true, deviceMarker? }` → `{ sent: true }` |
| `GET /api/auth/register/check?token=` | `{ email, trialDays }`。切れていれば 410、でたらめなら 404 |
| `POST /api/auth/register/complete` | `{ token, tenantName, name, password, deviceMarker? }` → `{ tenantId, deviceMarker, sessionToken? }` と Cookie |
| `POST /api/auth/password/login` | `{ email, password }` → `{ twoFactor: false, sessionToken? }` か `{ twoFactor: true, challengeToken }` |
| `POST /api/auth/password/forgot` | `{ email, turnstileToken }` → `{ sent: true }` |
| `GET /api/auth/password/reset/check?token=` | `{ email }` |
| `POST /api/auth/password/reset` | `{ token, password }` → `{ email }`。セッションはすべて失効 |

## 画面

| 画面 | ルート | Pencil |
|---|---|---|
| 0-1 ログイン | `/login` | `UufG8`（カード `m3tWJ`） |
| 36-4 会員登録 | `/register` | `JBd7P`（`NIOtl`） |
| 36-4-A 確認メールを送りました | `/register/sent` | `q32Ao`（`r7JPOa`） |
| 36-4-B 本登録 | `/register/complete?token=` | `jk88n`（`oVX3x`） |
| 36-6-A パスワードを忘れた | `/password/forgot` | `fmDeV`（`dVI5v`） |
| 36-6-B パスワードの再設定 | `/password/reset?token=` | `KN3y1`（`fWkBE`） |

ログイン前に開ける画面の一覧は `apps/web/src/lib/auth-email.ts` の `PUBLIC_AUTH_PATHS`。`app-shell.tsx` と `auth-guard.tsx` の両方がこれを見る。

## まだやっていないこと

- メール登録した権限者の LINE 連携（PR6、左下メニューの「プロフィールを編集」から）
- 利用規約・プライバシーポリシー・特定商取引法のページ
- 期限切れ URL の掃除（`deleteExpiredAuthEmailTokens` はあるが Cron に載せていない）
