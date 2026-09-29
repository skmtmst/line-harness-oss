-- 担当者の日付指定の休憩(N-405 #655)。この日だけの休み時間。
-- fold(存在が2回ある時刻)は保存時に決めたUTCオフセットで区別する。
-- 枠への差し引きは #1471 合流後に availability 側で有効化する。
CREATE TABLE IF NOT EXISTS staff_break_dates (
  id               TEXT PRIMARY KEY,
  staff_id         TEXT NOT NULL,
  work_date        TEXT NOT NULL, -- YYYY-MM-DD
  start_time       TEXT NOT NULL, -- HH:MM
  end_time         TEXT NOT NULL, -- HH:MM
  time_zone        TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  start_utc_offset TEXT NOT NULL DEFAULT '+09:00',
  end_utc_offset   TEXT NOT NULL DEFAULT '+09:00',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (staff_id, work_date, start_time, end_time),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);
CREATE INDEX IF NOT EXISTS idx_staff_break_dates_staff
  ON staff_break_dates (staff_id, work_date);
