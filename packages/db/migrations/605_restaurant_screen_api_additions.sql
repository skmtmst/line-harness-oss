-- 草稿。番号別承認後に司令塔が適用する。
ALTER TABLE rt_closures ADD COLUMN notify_media INTEGER NOT NULL DEFAULT 1 CHECK(notify_media IN (0,1));
DROP TRIGGER rt_closure_tasks_insert;
CREATE TRIGGER rt_closure_tasks_insert AFTER INSERT ON rt_closures WHEN NEW.archived_at IS NULL BEGIN INSERT INTO rt_closure_close_tasks(id,store_id,closure_id,closure_version,channel,kind,start_date,end_date,all_day,start_time,end_time,table_ids_json,starts_at,ends_at,status) SELECT lower(hex(randomblob(16))),NEW.store_id,NEW.id,NEW.version,m.code,NEW.kind,NEW.start_date,NEW.end_date,NEW.all_day,NEW.start_time,NEW.end_time,NEW.table_ids_json, json_extract(NEW.periods_json,'$[0].startsAt'),json_extract(NEW.periods_json,'$[#-1].endsAt'),'close' FROM rt_store_media_links l JOIN rt_media m ON m.id=l.media_id WHERE NEW.notify_media=1 AND l.store_id=NEW.store_id AND l.close_on_booking=1 AND m.accepts_reservations=1; INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(NEW.store_id,'closure_saved') ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
DROP TRIGGER rt_closure_tasks_update;
CREATE TRIGGER rt_closure_tasks_update AFTER UPDATE ON rt_closures BEGIN UPDATE rt_closure_close_tasks SET status='reopen',generation=generation+1,updated_at=datetime('now') WHERE closure_id=NEW.id AND status<>'reopen'; INSERT INTO rt_closure_close_tasks(id,store_id,closure_id,closure_version,channel,kind,start_date,end_date,all_day,start_time,end_time,table_ids_json,starts_at,ends_at,status) SELECT lower(hex(randomblob(16))),NEW.store_id,NEW.id,NEW.version,m.code,NEW.kind,NEW.start_date,NEW.end_date,NEW.all_day,NEW.start_time,NEW.end_time,NEW.table_ids_json, json_extract(NEW.periods_json,'$[0].startsAt'),json_extract(NEW.periods_json,'$[#-1].endsAt'),'close' FROM rt_store_media_links l JOIN rt_media m ON m.id=l.media_id WHERE NEW.notify_media=1 AND NEW.archived_at IS NULL AND l.store_id=NEW.store_id AND l.close_on_booking=1 AND m.accepts_reservations=1; INSERT INTO rt_inventory_rule_queue(store_id,cause) VALUES(NEW.store_id,'closure_changed') ON CONFLICT(store_id) DO UPDATE SET generation=generation+1,cause=excluded.cause,updated_at=datetime('now'); END;
CREATE TABLE rt_close_notification_settings (
 store_id TEXT PRIMARY KEY REFERENCES rt_stores(id), notify_reopen INTEGER NOT NULL DEFAULT 1 CHECK(notify_reopen IN (0,1)),
 recipient_mode TEXT NOT NULL DEFAULT 'responsible' CHECK(recipient_mode IN ('responsible','manager','selected')),
 membership_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(membership_ids_json)), version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE visit_stamp_pin_attempts (
 line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id), attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT
);
CREATE TABLE visit_stamp_paper_photos (
 id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES visit_stamp_cards(id), friend_id TEXT NOT NULL REFERENCES friends(id),
 line_account_id TEXT NOT NULL REFERENCES line_accounts(id), object_key TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 5242880), created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
ALTER TABLE visit_stamp_paper_requests ADD COLUMN submitted_friend_id TEXT REFERENCES friends(id);
