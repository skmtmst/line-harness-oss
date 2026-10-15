-- B-324: 通常予約のmenusとは別の対象なので、既存の外部キーを流用しない。
CREATE TABLE restaurant_course_payment_settings (
  menu_id TEXT PRIMARY KEY REFERENCES rt_menu_items(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
  mode TEXT CHECK(mode IS NULL OR mode IN ('none','onsite','online','customer_choice')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE event_payment_settings (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  mode TEXT CHECK(mode IS NULL OR mode IN ('none','onsite','online','customer_choice')),
  unit_price INTEGER NOT NULL DEFAULT 0 CHECK(typeof(unit_price)='integer' AND unit_price BETWEEN 0 AND 9007199254740991),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER restaurant_course_payment_scope_insert BEFORE INSERT ON restaurant_course_payment_settings
WHEN NOT EXISTS(SELECT 1 FROM rt_menu_items m JOIN rt_stores s ON s.id=m.store_id
  WHERE m.id=NEW.menu_id AND m.kind='course' AND s.id=NEW.store_id AND s.line_account_id=NEW.line_account_id)
BEGIN SELECT RAISE(ABORT,'course_payment_scope_mismatch'); END;
CREATE TRIGGER restaurant_course_payment_scope_update BEFORE UPDATE ON restaurant_course_payment_settings
WHEN NOT EXISTS(SELECT 1 FROM rt_menu_items m JOIN rt_stores s ON s.id=m.store_id
  WHERE m.id=NEW.menu_id AND m.kind='course' AND s.id=NEW.store_id AND s.line_account_id=NEW.line_account_id)
BEGIN SELECT RAISE(ABORT,'course_payment_scope_mismatch'); END;
CREATE TRIGGER event_payment_scope_insert BEFORE INSERT ON event_payment_settings
WHEN NOT EXISTS(SELECT 1 FROM events e WHERE e.id=NEW.event_id AND e.line_account_id=NEW.line_account_id)
BEGIN SELECT RAISE(ABORT,'event_payment_scope_mismatch'); END;
CREATE TRIGGER event_payment_scope_update BEFORE UPDATE ON event_payment_settings
WHEN NOT EXISTS(SELECT 1 FROM events e WHERE e.id=NEW.event_id AND e.line_account_id=NEW.line_account_id)
BEGIN SELECT RAISE(ABORT,'event_payment_scope_mismatch'); END;
