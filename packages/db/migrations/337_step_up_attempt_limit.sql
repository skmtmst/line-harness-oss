-- 職員単位でstep-up認証の短時間の試行回数を制限する。
-- purposeを切り替えても上限を迂回できないよう、主キーはstaff_idだけにする。
CREATE TABLE IF NOT EXISTS auth_step_up_attempts (
  staff_id          TEXT PRIMARY KEY,
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE CASCADE
);
