-- migration-policy: table-rebuild
-- B-316 / A8。既存の送信対象・有効期限・友だちの関連を保持する。
PRAGMA defer_foreign_keys=ON;
CREATE TABLE analytics_result_audiences_new (
 id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
 source_kind TEXT NOT NULL CHECK(source_kind IN('funnel','cross','booking')),
 source_result_id TEXT NOT NULL, selection_key TEXT NOT NULL, member_count INTEGER NOT NULL DEFAULT 0,
 expires_at TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL
);
INSERT INTO analytics_result_audiences_new SELECT * FROM analytics_result_audiences;
CREATE TABLE analytics_result_audience_members_new (
 audience_id TEXT NOT NULL REFERENCES analytics_result_audiences_new(id) ON DELETE CASCADE,
 friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
 PRIMARY KEY(audience_id,friend_id)
);
INSERT INTO analytics_result_audience_members_new SELECT * FROM analytics_result_audience_members;
DROP TABLE analytics_result_audiences;
DROP TABLE analytics_result_audience_members;
ALTER TABLE analytics_result_audiences_new RENAME TO analytics_result_audiences;
ALTER TABLE analytics_result_audience_members_new RENAME TO analytics_result_audience_members;
CREATE INDEX idx_analytics_result_audiences_expiry ON analytics_result_audiences(line_account_id,expires_at);
CREATE TRIGGER trg_analytics_result_audiences_cross_reference BEFORE INSERT ON analytics_result_audiences
WHEN NEW.source_kind='cross' AND NOT EXISTS(SELECT 1 FROM analytics_cross_runs WHERE id=NEW.source_result_id AND line_account_id=NEW.line_account_id)
BEGIN SELECT RAISE(ABORT,'analytics_result_source_not_found'); END;
CREATE TRIGGER trg_analytics_result_audiences_funnel_reference BEFORE INSERT ON analytics_result_audiences
WHEN NEW.source_kind='funnel' AND NOT EXISTS(SELECT 1 FROM analytics_funnel_runs WHERE id=NEW.source_result_id AND line_account_id=NEW.line_account_id)
BEGIN SELECT RAISE(ABORT,'analytics_result_source_not_found'); END;
CREATE TABLE style_analytics_results(id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL REFERENCES line_accounts(id), style TEXT NOT NULL, selection_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TRIGGER trg_analytics_result_audiences_booking_reference BEFORE INSERT ON analytics_result_audiences
WHEN NEW.source_kind='booking' AND NOT EXISTS(SELECT 1 FROM style_analytics_results WHERE id=NEW.source_result_id AND line_account_id=NEW.line_account_id)
BEGIN SELECT RAISE(ABORT,'analytics_result_source_not_found'); END;
