-- migration-policy: table-rebuild
-- 見本のない媒体は準備中として登録し、解析対象にしない。既存の媒体IDと参照を保つ。
PRAGMA defer_foreign_keys = ON;
CREATE TABLE rt_media_next (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('retty', 'gurunavi', 'tabelog', 'hotpepper', 'google_reservation', 'ikyu', 'tablecheck')),
  name TEXT NOT NULL,
  sender_addresses TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sender_addresses)),
  parser_key TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);
INSERT INTO rt_media_next SELECT * FROM rt_media;
-- 参照を一時退避してから親の媒体表を置き換える。外部キー検査を無効化しない。
CREATE TABLE migration_545_media_links_backup AS SELECT id, media_id FROM rt_reservations WHERE media_id IS NOT NULL;
CREATE TABLE migration_545_digests_backup AS SELECT * FROM rt_email_digests;
UPDATE rt_reservations SET media_id = NULL WHERE media_id IS NOT NULL;
DELETE FROM rt_email_digests;
DROP TABLE rt_media;
ALTER TABLE rt_media_next RENAME TO rt_media;
UPDATE rt_reservations SET media_id = (SELECT media_id FROM migration_545_media_links_backup WHERE id = rt_reservations.id)
  WHERE id IN (SELECT id FROM migration_545_media_links_backup);
INSERT INTO rt_email_digests SELECT * FROM migration_545_digests_backup;
DROP TABLE migration_545_media_links_backup;
DROP TABLE migration_545_digests_backup;
INSERT INTO rt_media (id, code, name, parser_key, is_active) VALUES
  ('media-google-reservation', 'google_reservation', 'Google の予約通知', 'google_reservation', 0),
  ('media-ikyu', 'ikyu', '一休', 'ikyu', 0),
  ('media-tablecheck', 'tablecheck', 'TableCheck', 'tablecheck', 0);
ALTER TABLE rt_inbound_emails ADD COLUMN media_id TEXT REFERENCES rt_media(id);
UPDATE rt_inbound_emails SET media_id = (
  SELECT m.id FROM rt_sync_events e JOIN rt_media m ON m.code = json_extract(e.payload_json, '$.media')
  WHERE e.store_id = rt_inbound_emails.store_id AND e.external_event_id = rt_inbound_emails.message_id AND e.provider = 'email'
  LIMIT 1
);
UPDATE rt_inbound_emails SET status = 'quarantined', quarantine_reason = (
  SELECT error_message FROM rt_sync_events e
  WHERE e.store_id = rt_inbound_emails.store_id AND e.external_event_id = rt_inbound_emails.message_id AND e.provider = 'email'
  LIMIT 1
) WHERE status = 'received' AND EXISTS (
  SELECT 1 FROM rt_sync_events e WHERE e.store_id = rt_inbound_emails.store_id
  AND e.external_event_id = rt_inbound_emails.message_id AND e.provider = 'email' AND e.status = 'failed'
);
CREATE UNIQUE INDEX idx_rt_manual_email_import ON rt_reservations(inbound_email_id) WHERE parser_key = 'manual_import';
