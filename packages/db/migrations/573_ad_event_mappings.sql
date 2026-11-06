CREATE TABLE ad_event_mappings (
  conversion_point_id TEXT NOT NULL REFERENCES conversion_points(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('meta','google')),
  mode TEXT NOT NULL CHECK(mode IN ('auto','manual','off')),
  event_name TEXT,
  google_action_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(conversion_point_id,line_account_id,provider)
);
-- 新規成果だけを、その時の所属で残す。既存成果の遡及送信はしない。
CREATE TABLE ad_conversion_event_accounts (
  conversion_event_id TEXT PRIMARY KEY REFERENCES conversion_events(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  platform_ids_json TEXT NOT NULL CHECK(json_valid(platform_ids_json))
);
-- 内部の文末を同じ行に置き、既存のSQL分割器でも1文として読む。
CREATE TRIGGER capture_ad_conversion_account AFTER INSERT ON conversion_events BEGIN INSERT INTO ad_conversion_event_accounts(conversion_event_id,line_account_id,platform_ids_json) SELECT NEW.id,f.line_account_id,(SELECT json_group_array(p.id) FROM ad_platforms p WHERE p.line_account_id = f.line_account_id AND p.is_active = 1 AND p.verified_at IS NOT NULL AND p.name IN ('meta','google')) FROM friends f WHERE f.id = NEW.friend_id AND f.line_account_id IS NOT NULL; END;
CREATE TABLE ad_event_mapping_dispatches (
  conversion_event_id TEXT NOT NULL REFERENCES conversion_events(id) ON DELETE CASCADE,
  ad_platform_id TEXT NOT NULL REFERENCES ad_platforms(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(conversion_event_id,ad_platform_id)
);
CREATE INDEX idx_ad_mapping_dispatch_account ON ad_event_mapping_dispatches(line_account_id,completed);
