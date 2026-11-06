-- B-316: API組3に承認された641。適用は司令塔の別工程。
CREATE TABLE booking_assignment_settings (
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('staff','table')),
  scope_id TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'balanced' CHECK(method IN ('balanced','priority','random')),
  balance_period TEXT NOT NULL DEFAULT 'day' CHECK(balance_period IN ('day','week')),
  resources_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(resources_json) AND json_type(resources_json)='array'),
  version INTEGER NOT NULL CHECK(version>0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(scope_kind,scope_id)
);
