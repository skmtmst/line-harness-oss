-- V: 大事な操作の再確認・いつもと違うログイン（v6-26 §16・v6-30 §14・v6-33 §16）
--
-- step_up_at: そのセッションで最後に本人確認（再確認）が成功した時刻。
--   10分以内は同じセッションの大事な操作へ再確認を求めない。期限切れや
--   未確認の操作は 401 step_up_required で止める。
-- device_hash: 端末の指紋。User-Agent から版番号を除いた形のハッシュで、
--   いつもと違う端末の判定に使う（生のUAは user_agent 側が持つ）。
-- unfamiliar_at: 「いつもと違う端末・場所」と判定した時刻。立っている間は
--   そのセッションの大事な操作へ毎回の再確認を求める。
ALTER TABLE admin_sessions ADD COLUMN step_up_at TEXT;
ALTER TABLE admin_sessions ADD COLUMN device_hash TEXT;
ALTER TABLE admin_sessions ADD COLUMN unfamiliar_at TEXT;

-- 本人の過去の端末を引く検知用（本人ごとの小さい範囲だけを見る）。
CREATE INDEX IF NOT EXISTS idx_admin_sessions_staff_device
  ON admin_sessions(staff_id, device_hash);
