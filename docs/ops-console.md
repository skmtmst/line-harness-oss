# 運営コンソール（★V6 37）実装メモ — 第 1 段

- 要件: `docs/v6-requirements/v6-37-master-console-requirements-draft.md`（`docs/v6-requirements/` は司令塔の所有パスのため、このPRには含めず司令塔の枝から取り込む。原本は Claude の作業ツリーにある）
- 入口: `/ops`（ログインは `/ops/login`）
- 第 1 段の範囲: 37-1 ログイン／37-3 契約先一覧／37-4 契約先詳細／37-5 代理ログイン（＋5-A・5-B）／37-8 監査ログ／37-9 アカウントメニュー／37-10 メンバー管理。
  第 2 段で 37-6 お問い合わせ、第 3 段で 37-2 ダッシュボードを足した（このメモの末尾）。お知らせ配信（37-7）は案内だけの画面。

## AI ナレッジ（★V6 37-11）

- 正本: V6 `csVox`（一覧）、`DHdsw`（根拠確認）、`ZAOc7`（編集）。FAQや公開の操作は置かない。運営限定。
- チケットの解決と同じDBトランザクションで生成ジョブを登録。既存5分ジョブが1件ずつ処理する。AI失敗は解決操作を取り消さず、最大3回の試行後は画面から再試行できる。
- AIへ渡す前に既知の人物名・契約先名、メール、URL、電話、LINE ID、秘密値等をローカルで除去する。原文やAIエラー本文をログに残さない。匿名化はパターンに基づくため、未知の表記の個人情報を完全に検出する保証はない。
- 実行済みの対応と後続の成功を会話の発言ID・原文引用と照合。提案のみ・お礼のみ・部分解決・再発・根拠不明・添付資料依存・長すぎる会話は「要確認」。記事の答えは検証済みの引用から構成し、AIが作った原因や解決方法をそのまま採用しない。
- 運営が原文・適用条件を確認して承認するまで検索から除外。記事編集・元会話更新・再オープン後は古い承認を使わない。AIによる因果判断の誤りはあり得るため、人の承認は必須。
- 返信下書きでは承認済みかつ有効・現行の最大5記事を参考にし、画面に参考記事・評価・除外再生成を表示。今月のAI呼び出し数（失敗も含む）と返信下書き呼び出し数、有効記事数をダッシュボードへ表示。
- 個別回答の根拠確認は承認済みV6 `F3zoq` / `LT8m5`。記事の文章を転用せず、お客様の最新の説明、実施済みの操作、契約プランと権限を踏まえて毎回生成する。日本語の語で検索し、同じ分類という理由だけの無関係な記事は渡さない。不明・矛盾・根拠不足は断定せず確認するよう指示するが、AIの正答を保証するものではない。
- 「今回の回答に合う／今回には合わない」は問い合わせとの適合記録で、知識自体の正誤や全顧客共通の検索順位に反映しない。「除外して回答を作り直す」はその画面の問い合わせで除外して再生成し、記事は残す。知識自体の誤りは別途編集・停止する。自動送信・モデルの自動学習はしない。
- migration `442_platform_knowledge.sql` は列・表・索引の追加のみ。未適用のままコードを配備しない。新しい環境変数・Webhook・OAuth・Cron設定は不要。既存AI bindingと `OPS_SUPPORT_AI_MODEL` を使用。
- 切り戻しはコードのrevertと直前のWorker/Pages版。追加表を残す場合、旧コードでは処理されない。DB復元が必要ならapply直前のTime Travel復元点を使う（復元後に作られたデータも戻るため別途承認）。

## 変えたもの

| 場所 | 内容 |
|---|---|
| `packages/db/migrations/405_platform_admins.sql` | `platform_admins` / `platform_audit_logs` / `impersonation_sessions` / `pii_reveal_logs` |
| `packages/db/src/platform-admins.ts` | 上記の読み書き |
| `apps/worker/src/middleware/platform-admin.ts` | 運営マスターの門番。`platform_admins` が空の間だけ「既定の統括のオーナー」を互換で通す |
| `apps/worker/src/middleware/impersonation.ts` | 代理ログイン中の統括の差し替え、閲覧のみの強制、個人情報の伏せ字、禁止操作 |
| `apps/worker/src/middleware/auth.ts` | 認証の直後に代理ログインを解決する |
| `apps/worker/src/routes/ops.ts` | `/api/ops/*` と `/api/hq/operator-history` |
| `apps/worker/src/routes/tenants.ts` | `canManageTenants()` を `platform_admins` 判定へ |
| `apps/worker/src/routes/admin-auth.ts` | LINE ログインの `?next=ops` と2要素認証、`/api/auth/session` に `platformAdmin` と `impersonation` |
| `apps/web/src/app/ops/**` | 画面 |
| `apps/web/src/components/ops/**` | 外枠・環境帯・代理ログイン帯 |
| `apps/web/src/components/app-shell.tsx` | `/ops` は運営の外枠、それ以外には代理ログイン帯 |
| `apps/web/src/components/hq/operator-history.tsx` | 契約先から見える運営の操作（書き込みのみ） |

## 運営マスターの登録（Masato が実行）

移行の順番は要件 §6-2「新しい判定を足す → 登録 → 確認 → 旧判定を外す」。
コードは「新しい判定」まで入っている。`platform_admins` が 1 人でも登録されると、
旧判定（既定の統括のオーナー）は自動で効かなくなる。

```sql
-- 検証環境で、まず自分だけを登録して /ops に入れることを確かめる
INSERT INTO platform_admins (staff_id, is_active)
SELECT id, 1 FROM staff_members WHERE email = '<Masato のメール>' AND is_active = 1;

-- 入れたら残りの 2 名（それぞれの staff_members が要る。無ければ先に権限者として招待する）
INSERT INTO platform_admins (staff_id, is_active, approved_by)
SELECT id, 1, (SELECT id FROM staff_members WHERE email = '<Masato のメール>')
FROM staff_members WHERE email IN ('<Kyohei のメール>', '<Kenta のメール>') AND is_active = 1;
```

SQL を流さない手順（推奨）: `platform_admins` が空の間は、既定の統括のオーナーが互換判定で
`/ops/login` に入れる。そのまま左下のアカウントメニュー →「メンバー管理」→「運営メンバーを招待」で
**自分のメールアドレス**を入れると、最初の 1 人として登録される（空のときだけ自分を加えられる）。
続けて残りの 2 名をメールで加える（それぞれの staff_members が要る。無ければ先に権限者として招待する）。
1 人でも登録された時点で互換判定は自動で効かなくなる。
この互換判定は API（`requirePlatformAdmin`）・`/api/auth/session`・LINE ログインの運営コンソール分岐の
3 か所で同じ関数（`isPlatformAdminRow`）を使う。片方だけ厳しいと最初の 1 人が画面に入れない。

## 動かし方（Codex）

1. `pnpm --filter @line-crm/db build` — `bootstrap.sql` を作り直す（405 を含める）。テストはこれを読む
2. `pnpm --filter worker test` / `pnpm --filter web test` / `pnpm -r typecheck`
3. 検証 D1 に 405 を適用（既存の手順どおり。本番には流さない）
4. 検証へ配備し、上の SQL で登録 → `/ops/login` から入る

## 確かめること（要件 §7 の第 1 段ぶん）

- 登録した LINE / メールで `/ops` に入れる。どちらのログインも、TOTP登録済みなら6桁の確認、未登録なら設定を終えるまで通常セッションを発行しない。統括のオーナーは `/api/ops/*` が 403
- 契約先を停止すると `tenants.status = 'suspended'`、`platform_audit_logs` が 1 件（`visible_to_tenant = 1`）
- 代理ログインで統括の画面が開き、赤い帯が出る。閲覧のみでは書き込み API が 403
- 理由を入れて書き込みに切り替えると書ける。契約先の `/hq` に「運営による操作」が出る
- 代理ログイン中、`/api/friends` の氏名が `友だち#xxxx`、本文が伏せ字。理由を入れて表示すると戻る
- `/ops/audit` に上の操作が並ぶ

## 未実装・注意

- 2 要素認証の画面を通ったあとは `/ops` へ戻る。Worker は `?next=ops` を付け、画面は query を正本、`lh_next=ops` と一時保存を後方互換として読む
- 伏せ字は `/api/friends` `/api/chats` `/api/inbox` `/api/conversations` `/api/support` `/api/nen-members` `/api/form-submissions` `/api/forms/` の応答に掛かる。ほかの経路で氏名を返す API があれば `middleware/impersonation.ts` の `PII_MASK_PREFIXES` に足す
- 代理ログインでも止める操作は `isForbiddenWhileImpersonating`（権限者の削除・LINE アカウントの削除・課金ポータル・契約状態の変更）

## 運営メンバーの招待（★V6 37-10、2026-09-16 決定）

- 「既存の権限者のメールを入れると即登録」はやめた。メンバー管理 →「運営メンバーを招待」にメールを入れる → 招待メール（24 時間有効）
- 相手はメールのリンク（`/ops/invite#invite=…`）を開き、パスワードが無ければ名前とパスワードを設定 → そのまま `/ops/two-factor` で 2要素認証を登録 → 登録完了で運営マスターになる
- 状態は `platform_admins.activation_state`（invited → awaiting_totp → active）。active だけを運営マスターとして扱う（`getPlatformAdminByStaffId`）
- 新しいメールは運営会社（既定の統括）の権限者（role staff）として作る。別の統括の権限者はメール招待では加えられない（Kenta / Kyohei は初期の特例）
- 既存の運営メンバーも `/ops/login` から入ると2要素認証が必須。未設定ならログイン途中の設定画面へ進み、登録完了後に `/ops` へ戻る。左下メニューの「2要素認証の設定」→ `/ops/two-factor` から事前登録もできる
- 招待メールを送り直すと前のリンクは失効する。2要素認証の確認（`/api/staff/:id/two-factor/confirm`）が通った瞬間に `activatePlatformAdminIfAwaitingTotp` が active にする
- 公開の口は `/api/auth/ops-invite/check` と `/api/auth/ops-invite/accept`（トークンだけで守る。Turnstile は使わない）

## 検証配備とD1の整合性

- `Deploy Cloudflare Staging` は配備前に検証D1の `_migrations` とリポジトリ内のmigration一覧を比較する
- dry-run は未適用件数とファイル名をJob Summaryへ出すだけで、DBを書き換えない
- apply は未適用が1件でもあれば失敗する。先に `Migrate D1` の正式経路で適用し、未適用0件にしてから再実行する

## 第 2 段：お問い合わせ（37-6 / 37-6-A / 37-6-B）

統括の 36-3 が書き込む `hq_support_requests` を、運営側で「チケット」として扱う。表は増やさず列を足した（migration 421）。

| 場所 | 内容 |
|---|---|
| `packages/db/migrations/421_ops_support_tickets.sql` | `ticket_no`（#MB-0001 から）・`stage`（新規／対応中／待ち／解決済み／クローズ）・`priority`・`channel`・返信の表 `hq_support_messages`・下書きの表 `hq_support_reply_drafts`・採番の `platform_counters` |
| `packages/db/src/ops-support.ts` | 一覧・数値カード・返信・下書き・契約先の状況の読み書き。`statusForStage` が統括向けの `status` を導く |
| `apps/worker/src/routes/ops-support.ts` | `/api/ops/support/*`。返信は登録メールへ送り、統括の 36-3 の履歴にも載せる。AI の下書きは Workers AI（`AI` binding、`@cf/zai-org/glm-4.7-flash`）で作り、メールアドレスや LINE ID は渡さない |
| `apps/worker/src/routes/hq-support.ts` | 統括側の一覧に `ticketLabel`・`stage`・`replies` を足した |
| `apps/web/src/app/ops/support/page.tsx` | 画面。左が一覧、右が内容と返信。AI の下書きは「作成中…」→「AIが作った下書きです」の 2 状態を持つ |
| `apps/web/src/app/hq/support/page.tsx` | 「これまでの問い合わせ」に運営からの返信を出す |

決まりごと:

- `hq_support_requests.status` の CHECK（open/answered/closed）は後から変えられないので、運営の細かい進み具合は `stage` に持ち、`status` は `stage` から導く。
- 返信すると `stage` は既定で「待ち」（相手の返事待ち）。返信と同時に「解決済み」にもできる。クローズ済みには返信できない。
- 監査: 閲覧 `ticket.view`（統括には見せない）、返信 `ticket.reply`（統括に見せる）、状態変更 `ticket.stage.change`、運営の起票 `ticket.create`。
- 「契約者専用LINEにも通知します」は 37-7（お知らせ配信）の LINE の口ができてから足す。いまは `delivered_via` に `screen` / `email` だけが入る。
- 統括側の続き（★V6 36-3-A `Nt0UH`）: `GET /api/hq/support/requests/:id`・`POST /api/hq/support/requests/:id/messages`（`apps/worker/src/routes/hq-support.ts`）と `apps/web/src/app/hq/support/detail/page.tsx`。36-3 の「これまでの問い合わせ」から開く。続きを送ると運営のチケットは待ち・解決済み・クローズから「対応中」へ戻り、運営（`SUPPORT_NOTIFY_EMAIL` か `CONTACT_EMAIL`）へ通知、送信者に控えが届く。
- 運営コンソールの画面は API の例外を `opsCall`（`apps/web/src/components/ops/ops-ui.tsx`）で受ける。`fetchApi` は 2xx 以外を例外にするため、これが無いと busy のまま画面が固まる。
- AI の下書きモデルは `OPS_SUPPORT_AI_MODEL`（未設定なら `@cf/meta/llama-3.3-70b-instruct-fp8-fast`）。応答は 45 秒で打ち切って 504。
- AI が未設定（`AI` binding なし）の環境ではボタンを押せず、API は 503 を返す。

## 第 3 段：ダッシュボード（37-2）

| 場所 | 内容 |
|---|---|
| `packages/db/src/ops-dashboard.ts` | 契約先・Stripe の出来事・要対応・チケット・LINE 登録・使用量の読み取り |
| `apps/worker/src/routes/ops-dashboard.ts` | `GET /api/ops/dashboard?period=month|prev_month|year`、`GET /api/ops/dashboard/line-unregistered` |
| `apps/worker/src/services/billing-plans.ts` | プランに `monthlyMessages`・`mediaBytes` を足した（使用量の上限） |
| `apps/web/src/app/ops/dashboard/page.tsx` | 画面 |
| `apps/web/src/components/ops/ops-charts.tsx` | 棒グラフとドーナツ（SVG、色はトークンだけ） |
| `apps/web/src/app/ops/tenants/page.tsx` | `?status=past_due` などで来たときの初期絞り込み、決済失敗の札 |

決まりごと:

- **金額は契約中プランの定価**（`fallbackMonthlyYen`）で数える（決定 2026-09-17）。画面に「定価で数えています」と出す。Stripe の実売上は後で差し替える。
- 契約中＝`plan_status` が `active` か `past_due`。トライアルは月額に入れない。運営会社（既定の統括）と `archived` の契約先は数えない。
- 過去の月の売上は「その月末に契約中だった契約先」を、いまの契約先と解約日（`billing_events` の `customer.subscription.deleted`）から逆算した概算。
- 解約数は同じ出来事を期間で数え、解約率は期間はじめの契約数で割る。
- 要対応: 決済失敗（`past_due`）／トライアル期限 3 日以内／LINE トークン期限 14 日以内（`line_accounts.token_expires_at`）／未返信のお問い合わせ（`stage = 'new'`）。
- 「契約者専用LINEの登録」は権限者の `notice_friend_id`（37-7 の確認コードで紐づいた友だち）の有無で数える。「未登録の N 人へ案内」は対象の一覧を出すまで。案内の一斉送信は 37-7 のお知らせ（メール）で代用できる。
- 使用量: 今月の配信通数（`messages_log` の outgoing）・バナー生成（`banner_usage_ledger`）・メディア容量（`media.size_bytes`）を、プランの上限と比べて使用率の高い順に 5 件。

## 第 3 段：お知らせ配信と契約者専用LINE（37-7）

| 場所 | 内容 |
|---|---|
| `packages/db/migrations/429_platform_announcements.sql` | `platform_settings`・`platform_announcements`・`platform_announcement_recipients`・`staff_line_link_codes`、`staff_members.notice_friend_id / notice_linked_at`（追加のみ） |
| `packages/db/src/platform-announcements.ts` | お知らせの読み書き、宛先の解決、予約の claim、既読、確認コードの発行と消費 |
| `apps/worker/src/services/platform-announcements.ts` | 配信本体（LINE push・メール・画面）、予約配信（cron）、確認コードでの紐づけ |
| `apps/worker/src/routes/ops-announcements.ts` | `GET/PUT /api/ops/notice-line-account`、`GET/POST /api/ops/announcements`、`POST /api/ops/announcements/preview`、`PUT/DELETE /api/ops/announcements/:id` |
| `apps/worker/src/routes/hq-notices.ts` | `GET /api/hq/notices`、`POST /api/hq/notices/:id/read`、`GET /api/hq/notices/line-registration` |
| `apps/worker/src/routes/webhook.ts` | 契約者専用LINEに届いた 6 桁のテキストを確認コードとして先に処理する（`handleNoticeLinkCode`） |
| `apps/worker/src/index.ts` | cron `platform announcements`（予約の時刻を過ぎたものを 1 件ずつ送る） |
| `apps/web/src/app/ops/announcements/page.tsx` | 運営の画面（宛先・件名・本文・送り方・公開日時、一覧に LINE送達／画面で既読） |
| `apps/web/src/components/ops/notice-line-account-card.tsx` | メンバー管理「運営の情報」で契約者専用LINEのアカウントを指定する |
| `apps/web/src/components/hq/platform-notices.tsx` | 統括コンソール上部の「運営からのお知らせ」（「読みました」で消える） |
| `apps/web/src/components/hq/notice-line-register-dialog.tsx` | 契約者専用LINEの登録案内（QR・確認コード・友だち追加リンク） |

決まりごと（決定 2026-09-18）:

- **契約者専用LINEは「musubo 運営（契約者専用）」の公式アカウント**。運営会社（既定の統括）のアカウントとして `/accounts/new` で通常どおり登録し、メンバー管理「運営の情報」で指定する（`platform_settings.notice_line_account_id`）。未指定の間は LINE の送り方が使えない（API は 409）。
- **登録の必須化はしない**。統括が LINE アカウント登録の手順 5 を終えた直後に案内の窓を一度だけ出す。ログインは止めない。案内は `/hq/support` の帯からもいつでも開ける。
- **紐づけは 6 桁の確認コード**（24 時間有効、同じ人は再表示で同じコードを返す）。統括が契約者専用LINEを友だち追加してコードをトークで送ると、`staff_members.notice_friend_id` に友だちが入る。コードは契約者専用LINEに届いたときだけ処理し、他のアカウントでは通常のメッセージとして扱う。
- 送り方は LINE（登録済みの権限者へ push）・画面（統括コンソール上部に出て「読みました」で消える）・メール（登録メールアドレス）。**LINE は送達（push が通ったか）まで**。Messaging API に既読はないので「LINE送達」と表示する。
- 宛先は 全契約先／プラン（ライト・スタンダード・プロ・トライアル）／契約先を選ぶ。運営会社と `archived` の契約先は常に外す。
- 送り方は 下書き／今すぐ送る／配信を予約する（日本時間）。送信済みは直せず消せない。予約は cron が `publish_at` を過ぎたものを `sending` に claim してから送るので二重送信しない。
- 本文に共通情報（`{{var.x}}`）は展開しない（契約先の権限者宛ての固定文）。
- 監査: `announcement.create / update / delete / send`、`notice_line_account.change` を `platform_audit_logs` に残す。

検証環境で確かめること:

1. `/accounts/new` で「musubo 運営（契約者専用）」を運営会社のアカウントとして登録する（Masato）。
2. `/ops/members` の「運営の情報」でそのアカウントを指定する。
3. 統括の権限者として `/hq/support` の帯から登録案内を開き、QR で友だち追加 → 6 桁をトークで送る → 「紐づきました」の返事。
4. `/ops/announcements` で LINE＋画面＋メールを選んで「今すぐ送る」→ LINE に届く、`/hq` の上部に出る、登録メールに届く。
5. 公開日時を入れて「配信を予約する」→ 5 分以内に送られ、一覧の状態が「送信済み」になる。
