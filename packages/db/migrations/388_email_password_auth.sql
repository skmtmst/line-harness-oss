-- メール＋パスワードでのログインと、会員登録（★V6 36-4）・パスワード再設定。
--
-- 権限者はこれまで LINE ログインと API キーだけだった。会員登録で作られる
-- オーナー権限者はパスワードを持ち、既存の権限者も「パスワードを忘れた」から
-- パスワードを後から持てる。LINE ログインの流れは変えない。
--
-- パスワードは PBKDF2-SHA256 のハッシュだけを保存する（Worker の password-hash.ts）。
ALTER TABLE staff_members ADD COLUMN password_hash TEXT;
ALTER TABLE staff_members ADD COLUMN password_updated_at TEXT;

-- パスワードを持つ権限者のメールは重複させない（同じメールで 2 人はログインを決められない）。
-- パスワードを持たない権限者（LINE だけ）は今までどおり重複を許す。
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_members_password_email
  ON staff_members(lower(email)) WHERE password_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_members_email_lower
  ON staff_members(lower(email));

-- メールで送る URL の元（登録の本登録・パスワード再設定）。
-- URL に入れた値そのものは保存せず、SHA-256 のハッシュだけを持つ。1 回使ったら consumed_at が入る。
CREATE TABLE IF NOT EXISTS auth_email_tokens (
  id             TEXT PRIMARY KEY,
  purpose        TEXT NOT NULL CHECK (purpose IN ('signup', 'password_reset')),
  token_hash     TEXT NOT NULL UNIQUE,
  email          TEXT NOT NULL,
  staff_id       TEXT,
  ip_hash        TEXT,
  device_marker  TEXT,
  expires_at     TEXT NOT NULL,
  consumed_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_email
  ON auth_email_tokens(purpose, email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_ip
  ON auth_email_tokens(purpose, ip_hash, created_at DESC);

-- 回数制限（接続元・メールごと）。Worker のメモリ上の制限は再起動で消えるので、
-- 登録依頼とパスワードの失敗は D1 に残して数える。key の例: 'signup:ip:<hash>'。
CREATE TABLE IF NOT EXISTS auth_throttles (
  key           TEXT PRIMARY KEY,
  count         INTEGER NOT NULL DEFAULT 0,
  window_start  TEXT NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 「1 つのブラウザから 1 回だけ登録」の印。本登録が終わったブラウザの印を統括に紐づける。
ALTER TABLE tenants ADD COLUMN signup_device_marker TEXT;
CREATE INDEX IF NOT EXISTS idx_tenants_signup_device_marker
  ON tenants(signup_device_marker) WHERE signup_device_marker IS NOT NULL;
