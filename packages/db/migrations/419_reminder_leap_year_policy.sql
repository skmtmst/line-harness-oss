-- 419: リマインダの2月29日方針（N-068）
-- 'feb28' = 平年は2月28日に届ける / 'mar1' = 平年は3月1日に届ける / 'skip' = その年は送らない。
-- 既存行は従来の固定動作（3月1日）を維持するため 'mar1' で埋める。
-- 無断で2/28へ変えると既存リマインダの配信日がずれるため、規定値の変更は行わない。
ALTER TABLE reminders
  ADD COLUMN leap_year_policy TEXT NOT NULL DEFAULT 'mar1'
  CHECK (leap_year_policy IN ('feb28', 'mar1', 'skip'));
