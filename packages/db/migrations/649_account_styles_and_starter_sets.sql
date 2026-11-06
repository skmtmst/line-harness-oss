-- B-309/B-311/B-313/B-316。tenant_id=NULL は musubo 標準。
CREATE TABLE account_styles (
 line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id),
 style TEXT NOT NULL CHECK(style IN('standard','ec','restaurant','salon','consult','lesson')),
 answers_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(answers_json)),
 cards_json TEXT CHECK(cards_json IS NULL OR json_valid(cards_json)),
 selected_at TEXT,
settings_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(settings_json)),
 version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE style_starter_sets (
 id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id), style TEXT NOT NULL, name TEXT NOT NULL,
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
 version INTEGER NOT NULL DEFAULT 1, archived_at TEXT, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE UNIQUE INDEX idx_style_starter_tenant_style ON style_starter_sets(COALESCE(tenant_id,''),style) WHERE archived_at IS NULL;
CREATE TABLE style_starter_items (
 line_account_id TEXT NOT NULL REFERENCES line_accounts(id), style TEXT NOT NULL, item_key TEXT NOT NULL,
 kind TEXT NOT NULL, target_id TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 1,
 feature TEXT, set_id TEXT, set_version INTEGER NOT NULL, applied_at TEXT NOT NULL,
 PRIMARY KEY(line_account_id,style,item_key)
);
CREATE TABLE style_change_logs(id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL);
