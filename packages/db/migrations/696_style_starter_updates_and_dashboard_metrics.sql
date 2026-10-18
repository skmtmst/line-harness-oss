-- B-335/B-337/B-344: retain local edits during HQ distribution and KPI choices.
ALTER TABLE style_starter_items ADD COLUMN source_snapshot TEXT CHECK(source_snapshot IS NULL OR json_valid(source_snapshot));
ALTER TABLE style_starter_items ADD COLUMN pending_update TEXT CHECK(pending_update IS NULL OR json_valid(pending_update));
ALTER TABLE account_styles ADD COLUMN metrics_json TEXT CHECK(metrics_json IS NULL OR json_valid(metrics_json));
CREATE INDEX idx_style_starter_account_key ON style_starter_items(line_account_id,item_key);
