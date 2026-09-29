-- V: いつもと違うログイン判定（v6-30 §14）の場所側の索引。
-- 494 で端末（device_hash）側の索引を足した。こちらは接続元（ip_prefix）側で、
-- 本人の過去セッションから同じ場所の形跡を引く検知クエリが使う。
CREATE INDEX IF NOT EXISTS idx_admin_sessions_staff_ip_prefix
  ON admin_sessions(staff_id, ip_prefix);
