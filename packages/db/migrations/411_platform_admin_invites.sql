-- 運営メンバーの招待（★V6 37-10）。
--
-- 「既存の権限者のメールを入れると即登録」をやめ、メールで招待 → パスワード設定 →
-- 2要素認証の登録が終わって初めて運営マスターになる。状態は platform_admins に持ち、
-- 招待のリンクは platform_admin_invites に残す（auth_email_tokens は purpose に
-- CHECK があり作り直しが要るため、別表にした）。
--
-- activation_state:
--   invited        メールを送った。相手はまだリンクを開いていない
--   awaiting_totp  パスワード設定（またはログイン）まで済み、2要素認証がまだ
--   active         登録完了。既存の行はすべて active

ALTER TABLE platform_admins ADD COLUMN activation_state TEXT NOT NULL DEFAULT 'active'
  CHECK (activation_state IN ('invited', 'awaiting_totp', 'active'));
ALTER TABLE platform_admins ADD COLUMN invited_by TEXT;
ALTER TABLE platform_admins ADD COLUMN invited_at TEXT;
ALTER TABLE platform_admins ADD COLUMN activated_at TEXT;

CREATE TABLE IF NOT EXISTS platform_admin_invites (
  id          TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  invited_by  TEXT,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_admin_invites_staff ON platform_admin_invites(staff_id, created_at DESC);
