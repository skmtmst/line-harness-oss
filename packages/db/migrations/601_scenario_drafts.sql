-- 草稿。D1への適用にはオーナー承認が必要。
-- 実際のシナリオと分離し、配信処理から参照しない。保存後30日で消去。
CREATE TABLE scenario_edit_drafts (
 line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
 draft_key TEXT NOT NULL,
 content_json TEXT NOT NULL CHECK(json_valid(content_json)),
 scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL, step_id TEXT REFERENCES scenario_steps(id) ON DELETE SET NULL,
 version TEXT NOT NULL CHECK(length(version) = 36),
 updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 PRIMARY KEY(line_account_id,draft_key)
);
CREATE INDEX idx_scenario_edit_drafts_expiry ON scenario_edit_drafts(expires_at);
