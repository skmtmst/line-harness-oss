-- 二段階認証の初回設定確認を、重要操作のstep-up試行枠と分けて制限する。
CREATE TABLE IF NOT EXISTS staff_two_factor_setup_attempts (
  staff_id          TEXT PRIMARY KEY,
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE CASCADE
);
