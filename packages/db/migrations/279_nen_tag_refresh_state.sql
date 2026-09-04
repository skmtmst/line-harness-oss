-- NEN自動タグの定期再判定を複数回のcronへ分割する進捗。
CREATE TABLE IF NOT EXISTS nen_tag_refresh_state (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  last_friend_id   TEXT NOT NULL DEFAULT '',
  cycle_started_at TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- 20人分をまとめて読むとき、対象外の全件走査を避ける。
CREATE INDEX IF NOT EXISTS idx_nen_health_logs_friend_date
  ON nen_health_logs(friend_id, logged_on DESC);
CREATE INDEX IF NOT EXISTS idx_nen_pet_profiles_friend
  ON nen_pet_profiles(friend_id);
CREATE INDEX IF NOT EXISTS idx_nen_care_flags_friend_status
  ON nen_care_flags(friend_id, status);
CREATE INDEX IF NOT EXISTS idx_nen_photo_submissions_friend_status
  ON nen_photo_submissions(friend_id, status);
