-- 担当者の休憩(N-405 #655)。曜日ごとの勤務時間内の休み時間。
-- 保存時の店舗時間帯も残す。枠への差し引きは #1471 合流後に availability 側で有効化する。
CREATE TABLE IF NOT EXISTS staff_breaks (
  id          TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Sun
  start_time  TEXT NOT NULL,                                    -- HH:MM
  end_time    TEXT NOT NULL,                                    -- HH:MM
  time_zone   TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (staff_id, weekday, start_time, end_time),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);
CREATE INDEX IF NOT EXISTS idx_staff_breaks_staff
  ON staff_breaks (staff_id, weekday);
