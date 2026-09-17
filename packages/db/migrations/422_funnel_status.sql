-- V6ファネルの運用状態。物理削除せず、停止（再開可）・保管（復帰不可）で一覧と再集計から外す。
ALTER TABLE funnels
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'stopped', 'archived'));
