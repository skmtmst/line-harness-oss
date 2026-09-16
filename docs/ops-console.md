# 運営コンソール（★V6 37）実装メモ — 第 1 段

- 要件: `docs/v6-requirements/v6-37-master-console-requirements-draft.md`（`docs/v6-requirements/` は司令塔の所有パスのため、このPRには含めず司令塔の枝から取り込む。原本は Claude の作業ツリーにある）
- 入口: `/ops`（ログインは `/ops/login`）
- 第 1 段の範囲: 37-1 ログイン／37-3 契約先一覧／37-4 契約先詳細／37-5 代理ログイン（＋5-A・5-B）／37-8 監査ログ／37-9 アカウントメニュー／37-10 メンバー管理。
  ダッシュボード・お問い合わせ・お知らせは案内だけの画面（第 2・3 段）。

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
| `apps/worker/src/routes/admin-auth.ts` | LINE ログインの `?next=ops`、`/api/auth/session` に `platformAdmin` と `impersonation` |
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

- 登録した LINE / メールで `/ops` に入れる。統括のオーナーは `/api/ops/*` が 403
- 契約先を停止すると `tenants.status = 'suspended'`、`platform_audit_logs` が 1 件（`visible_to_tenant = 1`）
- 代理ログインで統括の画面が開き、赤い帯が出る。閲覧のみでは書き込み API が 403
- 理由を入れて書き込みに切り替えると書ける。契約先の `/hq` に「運営による操作」が出る
- 代理ログイン中、`/api/friends` の氏名が `友だち#xxxx`、本文が伏せ字。理由を入れて表示すると戻る
- `/ops/audit` に上の操作が並ぶ

## 未実装・注意

- 2 要素認証の画面を通ったあとは `/ops` へ戻る（`lh_next=ops`）
- 伏せ字は `/api/friends` `/api/chats` `/api/inbox` `/api/conversations` `/api/support` `/api/nen-members` `/api/form-submissions` `/api/forms/` の応答に掛かる。ほかの経路で氏名を返す API があれば `middleware/impersonation.ts` の `PII_MASK_PREFIXES` に足す
- 代理ログインでも止める操作は `isForbiddenWhileImpersonating`（権限者の削除・LINE アカウントの削除・課金ポータル・契約状態の変更）

## 運営メンバーの招待（★V6 37-10、2026-09-16 決定）

- 「既存の権限者のメールを入れると即登録」はやめた。メンバー管理 →「運営メンバーを招待」にメールを入れる → 招待メール（24 時間有効）
- 相手はメールのリンク（`/ops/invite#invite=…`）を開き、パスワードが無ければ名前とパスワードを設定 → そのまま `/ops/two-factor` で 2要素認証を登録 → 登録完了で運営マスターになる
- 状態は `platform_admins.activation_state`（invited → awaiting_totp → active）。active だけを運営マスターとして扱う（`getPlatformAdminByStaffId`）
- 新しいメールは運営会社（既定の統括）の権限者（role staff）として作る。別の統括の権限者はメール招待では加えられない（Kenta / Kyohei は初期の特例）
- 既存の 3 名（2要素認証 未設定）はそのまま使える（決定 1-A）。左下メニューの「2要素認証の設定」→ `/ops/two-factor` から登録できる。全員が設定を終えたら、未設定の人を `/ops` に入れない切り替え（1-B）を検討する
- 招待メールを送り直すと前のリンクは失効する。2要素認証の確認（`/api/staff/:id/two-factor/confirm`）が通った瞬間に `activatePlatformAdminIfAwaitingTotp` が active にする
- 公開の口は `/api/auth/ops-invite/check` と `/api/auth/ops-invite/accept`（トークンだけで守る。Turnstile は使わない）
