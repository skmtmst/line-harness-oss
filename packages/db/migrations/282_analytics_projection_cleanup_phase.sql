-- 日別集計を確定した後の中間行整理も、複数cronへ分ける。
ALTER TABLE analytics_projection_progress
  ADD COLUMN phase TEXT NOT NULL DEFAULT 'scan';
