-- 草稿。D1への適用にはオーナー承認が必要。
-- migration-policy: table-rebuild
PRAGMA defer_foreign_keys = ON;
CREATE TABLE rt_media_next (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sender_addresses TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sender_addresses)),
  parser_key TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);
INSERT INTO rt_media_next SELECT * FROM rt_media;
-- 参照をいったん退避する。外部キーを切らずに親表を作り直す。
CREATE TABLE rt_reservations_media_next AS SELECT id,media_id FROM rt_reservations WHERE media_id IS NOT NULL;
CREATE TABLE rt_inbound_emails_next AS SELECT id,media_id FROM rt_inbound_emails WHERE media_id IS NOT NULL;
CREATE TABLE rt_email_digests_next AS SELECT * FROM rt_email_digests;
DELETE FROM rt_email_digests;
UPDATE rt_reservations SET media_id=NULL WHERE media_id IS NOT NULL;
UPDATE rt_inbound_emails SET media_id=NULL WHERE media_id IS NOT NULL;
DROP TABLE rt_media;
ALTER TABLE rt_media_next RENAME TO rt_media;
UPDATE rt_reservations SET media_id=(SELECT media_id FROM rt_reservations_media_next WHERE id=rt_reservations.id) WHERE id IN (SELECT id FROM rt_reservations_media_next);
UPDATE rt_inbound_emails SET media_id=(SELECT media_id FROM rt_inbound_emails_next WHERE id=rt_inbound_emails.id) WHERE id IN (SELECT id FROM rt_inbound_emails_next);
INSERT INTO rt_email_digests SELECT * FROM rt_email_digests_next;
DROP TABLE rt_reservations_media_next;
DROP TABLE rt_inbound_emails_next;
DROP TABLE rt_email_digests_next;
ALTER TABLE rt_media ADD COLUMN accepts_reservations INTEGER NOT NULL DEFAULT 1 CHECK(accepts_reservations IN (0,1));
CREATE TABLE rt_store_media_links (
 store_id TEXT NOT NULL REFERENCES rt_stores(id), media_id TEXT NOT NULL REFERENCES rt_media(id),
 page_url TEXT, login_url TEXT, close_on_booking INTEGER NOT NULL DEFAULT 0 CHECK(close_on_booking IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT(datetime('now')),
 PRIMARY KEY(store_id,media_id)
);
CREATE TABLE rt_reservation_links (
 store_id TEXT PRIMARY KEY REFERENCES rt_stores(id), token TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
-- 席数の在庫管理を使わない店でも、予約ごと×媒体ごとの手動閉鎖を記録する。
CREATE TABLE rt_reservation_close_tasks (
 id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES rt_stores(id), reservation_id TEXT NOT NULL REFERENCES rt_reservations(id),
 channel TEXT NOT NULL, starts_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('close','done','reopen')),
 generation INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT(datetime('now')), updated_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(reservation_id,channel,starts_at)
);
CREATE TABLE rt_reservation_close_outbox (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES rt_reservation_close_tasks(id), generation INTEGER NOT NULL,
 membership_id TEXT NOT NULL REFERENCES rt_memberships(id), retry_key TEXT NOT NULL, sent_at TEXT, lease_until TEXT, lease_token TEXT,
 UNIQUE(task_id,generation,membership_id)
);
