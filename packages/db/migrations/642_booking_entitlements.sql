-- B-308/B-316: 手動付与の回数券と月謝。購入/定期決済は行わない。
CREATE TABLE booking_entitlements (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id TEXT REFERENCES friends(id) ON DELETE SET NULL,
  menu_id TEXT REFERENCES menus(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('ticket','monthly')),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  remaining INTEGER CHECK(remaining IS NULL OR remaining>=0),
  monthly_limit INTEGER CHECK(monthly_limit IS NULL OR monthly_limit>0),
  valid_from TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK(julianday(expires_at)>julianday(valid_from)),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK((kind='ticket' AND remaining IS NOT NULL AND monthly_limit IS NULL)
    OR (kind='monthly' AND remaining IS NULL AND monthly_limit IS NOT NULL))
);
CREATE INDEX idx_booking_entitlements_friend ON booking_entitlements(line_account_id,friend_id,status);
CREATE TABLE booking_entitlement_events (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES booking_entitlements(id) ON DELETE RESTRICT,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('grant','adjust','extend','revoke','consume')),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('staff','system')),
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  created_at TEXT NOT NULL,
  UNIQUE(line_account_id,request_key)
);
CREATE INDEX idx_booking_entitlement_events_history ON booking_entitlement_events(entitlement_id,created_at,id);

-- 月謝の手動残数調整はその月だけの利用枠として残す。利用履歴は書き換えない。
CREATE TABLE booking_entitlement_month_limits (
  entitlement_id TEXT NOT NULL REFERENCES booking_entitlements(id) ON DELETE RESTRICT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  allowance INTEGER NOT NULL CHECK(allowance>=0),
  PRIMARY KEY(entitlement_id,period_start)
);
