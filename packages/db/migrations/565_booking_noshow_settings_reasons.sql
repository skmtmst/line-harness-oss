-- 予約の追加機能の画面（売上・無断キャンセルの段と印）。
-- 無断キャンセルの数え方（オン／オフ・何回目から・数える期間・
-- 決済が無い店の扱い）と、印を外した理由の記録を足す。
-- 適用は承認後に行うこと。
ALTER TABLE booking_noshow_thresholds
  ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));
ALTER TABLE booking_noshow_thresholds
  ADD COLUMN window_months INTEGER NOT NULL DEFAULT 6 CHECK (window_months BETWEEN 1 AND 120);
ALTER TABLE booking_noshow_thresholds
  ADD COLUMN no_payment_mode TEXT NOT NULL DEFAULT 'notice_call'
    CHECK (no_payment_mode IN ('notice', 'notice_call'));

-- 印を付け外しした記録。理由は1行、だれがいつしたか残す。
-- お客さまの画面には理由を出さない（店だけが見る）。
CREATE TABLE booking_noshow_flag_events (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('manual_on', 'manual_off')),
  reason TEXT,
  staff_id TEXT,
  staff_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_booking_noshow_flag_events_friend
  ON booking_noshow_flag_events(line_account_id, friend_id, created_at DESC);
