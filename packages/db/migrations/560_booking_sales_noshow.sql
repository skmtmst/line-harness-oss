-- 予約の追加機能（7 売上・8 無断キャンセル）。
-- 来なかった数は bookings.status = 'no_show' を数える。
-- 適用は承認後に行うこと。
CREATE TABLE booking_noshow_thresholds (
  line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  threshold INTEGER NOT NULL DEFAULT 3 CHECK (threshold BETWEEN 1 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 前払いのみの印。mode が auto のときは来なかった数が
-- 基準を超えたら前払いのみ。manual_on / manual_off は店の手動。
CREATE TABLE booking_noshow_flags (
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'manual_on', 'manual_off')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (line_account_id, friend_id)
);
CREATE INDEX idx_booking_noshow_flags_friend
  ON booking_noshow_flags(friend_id, line_account_id);
