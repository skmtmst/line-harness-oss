-- V8 SyQA1: 日ごとの累計。生涯累計と混ぜず、直近30日を数える。
CREATE TABLE nen_photo_publication_daily_views (
  publication_id TEXT NOT NULL REFERENCES nen_photo_publications(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  view_date TEXT NOT NULL CHECK (length(view_date) = 10),
  placement_label TEXT NOT NULL DEFAULT '',
  view_count INTEGER NOT NULL CHECK (view_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (publication_id, view_date, placement_label)
);
CREATE INDEX idx_photo_daily_views_account_date
  ON nen_photo_publication_daily_views(line_account_id, view_date);
