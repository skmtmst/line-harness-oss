-- migration-policy: table-rebuild
-- N-406 3A: 予約時点の資源消費量を固定し、後日の割当変更から既存予約を守る。

-- 割当中の資源を物理削除できないよう、資源側の外部キーを RESTRICT にする。
CREATE TABLE booking_menu_resources_next (
  menu_id TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES booking_resources(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (menu_id, resource_id)
);

INSERT INTO booking_menu_resources_next (menu_id, resource_id, quantity, created_at)
SELECT menu_id, resource_id, quantity, created_at
FROM booking_menu_resources;

DROP TABLE booking_menu_resources;
ALTER TABLE booking_menu_resources_next RENAME TO booking_menu_resources;

CREATE INDEX idx_booking_menu_resources_resource
  ON booking_menu_resources(resource_id, menu_id);

CREATE TABLE booking_resource_consumptions (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE RESTRICT,
  resource_id TEXT NOT NULL REFERENCES booking_resources(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  snapshot_source TEXT NOT NULL
    CHECK (snapshot_source IN ('booking', 'migration_current_assignment')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (booking_id, resource_id)
);

CREATE INDEX idx_booking_resource_consumptions_resource
  ON booking_resource_consumptions(line_account_id, resource_id, booking_id);

-- 予約・資源・snapshotが同じaccountに属することをDB境界でも保証する。
CREATE TRIGGER booking_resource_consumptions_account_insert
BEFORE INSERT ON booking_resource_consumptions
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM bookings b
  INNER JOIN booking_resources r ON r.id = NEW.resource_id
  WHERE b.id = NEW.booking_id
    AND b.line_account_id = NEW.line_account_id
    AND r.line_account_id = NEW.line_account_id
)
BEGIN
  SELECT RAISE(ABORT, 'booking_resource_consumption_account_mismatch'); END;

-- 予約時点の証跡は更新せず、訂正が必要なら予約を作り直す。
CREATE TRIGGER booking_resource_consumptions_immutable
BEFORE UPDATE ON booking_resource_consumptions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'booking_resource_consumption_immutable'); END;

-- 導入前予約は「migration時点の現行メニュー割当」であることを明示して補完する。
INSERT INTO booking_resource_consumptions (
  booking_id, line_account_id, resource_id, quantity, snapshot_source
)
SELECT b.id, b.line_account_id, mr.resource_id, mr.quantity,
       'migration_current_assignment'
FROM bookings b
INNER JOIN booking_menu_resources mr ON mr.menu_id = b.menu_id
INNER JOIN booking_resources r
  ON r.id = mr.resource_id
 AND r.line_account_id = b.line_account_id;
