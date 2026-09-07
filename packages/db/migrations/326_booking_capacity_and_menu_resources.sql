-- 機能28: 時間帯ごとの受付上限と、メニューが消費する設備を定義する。
ALTER TABLE booking_business_hours ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1
  CHECK (capacity BETWEEN 1 AND 1000);

CREATE TABLE booking_menu_resources (
  menu_id TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES booking_resources(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (menu_id, resource_id)
);

CREATE INDEX idx_booking_menu_resources_resource
  ON booking_menu_resources(resource_id, menu_id);
