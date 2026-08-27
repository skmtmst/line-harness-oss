-- 高危険操作の直前に行うTOTP再確認を、現在の管理画面sessionへ結び付ける。
-- token本体は保存せずhashだけを持ち、5分以内・1回だけ利用できる。
CREATE TABLE IF NOT EXISTS admin_step_up_grants (
  token_hash         TEXT PRIMARY KEY,
  staff_id           TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL REFERENCES admin_sessions(token_hash) ON DELETE CASCADE,
  purpose            TEXT NOT NULL CHECK (purpose IN ('operation-stop', 'operation-restore')),
  expires_at         TEXT NOT NULL,
  consumed_at        TEXT,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_step_up_grants_session
  ON admin_step_up_grants(session_token_hash, expires_at);

CREATE INDEX IF NOT EXISTS idx_admin_step_up_grants_expires
  ON admin_step_up_grants(expires_at);

-- 6桁コードの総当たりを、現在のsession単位で5分間に5回までに抑える。
CREATE TABLE IF NOT EXISTS admin_step_up_failures (
  id                 TEXT PRIMARY KEY,
  staff_id           TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL REFERENCES admin_sessions(token_hash) ON DELETE CASCADE,
  occurred_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_step_up_failures_session_time
  ON admin_step_up_failures(session_token_hash, occurred_at DESC);
