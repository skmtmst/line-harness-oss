-- オーナー承認 2026-11-04: 空の階・エリアを履歴を残して一覧から外す。
ALTER TABLE rt_floors ADD COLUMN archived_at TEXT;
ALTER TABLE rt_floors ADD COLUMN archived_name TEXT;
CREATE INDEX idx_rt_floors_active_store ON rt_floors(store_id,archived_at,sort_order);
