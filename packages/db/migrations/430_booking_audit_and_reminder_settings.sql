-- 機能27 監査 remediation（#932）。
--
-- 1) booking_audit_logs: いつ・誰が・何を変えたかの追記型台帳。
--    予約作成・状態遷移・内容変更・通知/同期の再試行を1行ずつ残す。
--    更新・削除の経路は作らない。
-- 2) booking_settings へリマインダ時刻の設定列。
--    全部屋で固定だった「前日=24時間前」「当日=2時間前」を、
--    アカウントごとの設定で変えられるようにする。

CREATE TABLE booking_audit_logs (
  id              TEXT PRIMARY KEY,
  booking_id      TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  before_json     TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json      TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  reason          TEXT,
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('customer', 'staff', 'system')),
  actor_id        TEXT,
  actor_name      TEXT,
  occurred_at     TEXT NOT NULL,   -- UTC ISO8601。Worker が書く
  request_id      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX idx_booking_audit_logs_booking
  ON booking_audit_logs(line_account_id, booking_id, occurred_at);

-- 前日お知らせの送信時刻（店舗タイムゾーンの壁時刻 HH:MM）。
-- NULL = 従来どおり予約の24時間前。
ALTER TABLE booking_settings
  ADD COLUMN reminder_day_before_time TEXT
  CHECK (reminder_day_before_time IS NULL
         OR (reminder_day_before_time GLOB '[0-2][0-9]:[0-5][0-9]'
             AND substr(reminder_day_before_time, 1, 2) <= '23'));

-- 当日お知らせを開始の何時間前に送るか。NULL = 既定の2時間前。
ALTER TABLE booking_settings
  ADD COLUMN reminder_hours_before INTEGER
  CHECK (reminder_hours_before IS NULL
         OR reminder_hours_before BETWEEN 1 AND 72);
