-- オーナー承認 2026-10-10 / B-214 / PLAN §2 633: 結ぶ仕組みだけ。
-- 予約の作成・更新、取り込み、外部への接続は行わない。
CREATE TABLE rt_reservation_external_links (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES rt_stores(id),
  provider TEXT NOT NULL CHECK (provider IN ('restaurant_board','reszaiko','hotpepper','tabelog','gurunavi','ikyu','retty','google_reservation','tablecheck')),
  external_id TEXT NOT NULL CHECK (length(trim(external_id)) BETWEEN 1 AND 200 AND external_id = trim(external_id)),
  reservation_id TEXT NOT NULL REFERENCES rt_reservations(id),
  origin_provider TEXT CHECK (origin_provider IS NULL OR origin_provider IN ('restaurant_board','reszaiko','hotpepper','tabelog','gurunavi','ikyu','retty','google_reservation','tablecheck')),
  provider_updated_at TEXT,
  last_event_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  unlinked_at TEXT,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, provider, external_id)
);
CREATE INDEX rt_external_links_reservation ON rt_reservation_external_links(reservation_id, unlinked_at);
-- API以外の書き込みでも、別店舗の予約へ結ぶことを拒否する。
CREATE TRIGGER rt_external_links_store_insert BEFORE INSERT ON rt_reservation_external_links
WHEN NOT EXISTS (SELECT 1 FROM rt_reservations WHERE id = NEW.reservation_id AND store_id = NEW.store_id)
BEGIN SELECT RAISE(ABORT, 'external_link_store_mismatch'); END;
-- 旧予約の外部IDがすでに指す予約と、別の予約を二重に結ばない。
CREATE TRIGGER rt_external_links_legacy_insert BEFORE INSERT ON rt_reservation_external_links
WHEN NEW.unlinked_at IS NULL AND EXISTS (
  SELECT 1 FROM rt_reservations WHERE store_id = NEW.store_id AND source = NEW.provider
    AND trim(external_id) = NEW.external_id AND id <> NEW.reservation_id
)
BEGIN SELECT RAISE(ABORT, 'external_link_legacy_conflict'); END;
CREATE TRIGGER rt_external_links_legacy_update BEFORE UPDATE ON rt_reservation_external_links
WHEN NEW.unlinked_at IS NULL AND EXISTS (
  SELECT 1 FROM rt_reservations WHERE store_id = NEW.store_id AND source = NEW.provider
    AND trim(external_id) = NEW.external_id AND id <> NEW.reservation_id
)
BEGIN SELECT RAISE(ABORT, 'external_link_legacy_conflict'); END;
CREATE TRIGGER rt_external_links_store_update BEFORE UPDATE OF reservation_id, store_id ON rt_reservation_external_links
WHEN NOT EXISTS (SELECT 1 FROM rt_reservations WHERE id = NEW.reservation_id AND store_id = NEW.store_id)
BEGIN SELECT RAISE(ABORT, 'external_link_store_mismatch'); END;
-- 媒体の表示用。受信解析や予約の取り込みは有効にしない。
INSERT INTO rt_media (id, code, name, parser_key, is_active, accepts_reservations)
SELECT 'media-restaurant-board', 'restaurant_board', 'レストランボード', 'restaurant_board', 0, 0
WHERE NOT EXISTS (SELECT 1 FROM rt_media WHERE code = 'restaurant_board');
