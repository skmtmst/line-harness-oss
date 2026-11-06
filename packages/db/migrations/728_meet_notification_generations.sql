-- Owner approval B-394. Append-only generations; legacy rows and retry keys are retained.
ALTER TABLE meet_consultations ADD COLUMN schedule_revision INTEGER NOT NULL DEFAULT 0 CHECK(schedule_revision>=0);
CREATE TABLE meet_consultation_notification_runs (
 id TEXT PRIMARY KEY,
 consultation_id TEXT NOT NULL REFERENCES meet_consultations(id) ON DELETE CASCADE,
 schedule_revision INTEGER NOT NULL DEFAULT 0 CHECK(schedule_revision>=0),
 booking_id TEXT, booking_version INTEGER,
 line_account_id TEXT NOT NULL DEFAULT '' REFERENCES line_accounts(id),
 friend_id TEXT NOT NULL DEFAULT '', recipient_id TEXT NOT NULL DEFAULT '',
 starts_at TEXT NOT NULL DEFAULT '', ends_at TEXT NOT NULL DEFAULT '', meet_url TEXT NOT NULL DEFAULT '',
 kind TEXT NOT NULL CHECK(kind IN('day_before','hour_before')),
 scheduled_at TEXT NOT NULL,
 retry_key TEXT NOT NULL DEFAULT '' UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','failed','sent','cancelled')),
 retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 3),
 next_at TEXT, call_state TEXT, result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 sent_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(consultation_id,schedule_revision,kind)
);
CREATE INDEX idx_meet_notification_runs_due ON meet_consultation_notification_runs(status,scheduled_at);
INSERT INTO meet_consultation_notification_runs
 (id,consultation_id,schedule_revision,booking_id,booking_version,line_account_id,friend_id,recipient_id,
 starts_at,ends_at,meet_url,kind,scheduled_at,retry_key,status,retry_count,sent_at,last_error,created_at,updated_at)
 SELECT r.id,c.id,0,c.booking_id,c.booking_version,f.line_account_id,c.friend_id,f.line_user_id,
 c.starts_at,c.ends_at,c.meet_url,r.kind,r.scheduled_at,r.id,r.status,r.retry_count,r.sent_at,r.last_error,r.created_at,r.updated_at
 FROM meet_consultation_reminders r JOIN meet_consultations c ON c.id=r.consultation_id JOIN friends f ON f.id=c.friend_id
 WHERE f.line_account_id IS NOT NULL;
CREATE TRIGGER meet_run_snapshot AFTER INSERT ON meet_consultation_notification_runs WHEN NEW.retry_key='' BEGIN UPDATE meet_consultation_notification_runs SET retry_key=NEW.id,booking_id=(SELECT booking_id FROM meet_consultations WHERE id=NEW.consultation_id),booking_version=(SELECT booking_version FROM meet_consultations WHERE id=NEW.consultation_id),line_account_id=(SELECT f.line_account_id FROM meet_consultations c JOIN friends f ON f.id=c.friend_id WHERE c.id=NEW.consultation_id),friend_id=(SELECT friend_id FROM meet_consultations WHERE id=NEW.consultation_id),recipient_id=(SELECT f.line_user_id FROM meet_consultations c JOIN friends f ON f.id=c.friend_id WHERE c.id=NEW.consultation_id),starts_at=(SELECT starts_at FROM meet_consultations WHERE id=NEW.consultation_id),ends_at=(SELECT ends_at FROM meet_consultations WHERE id=NEW.consultation_id),meet_url=(SELECT meet_url FROM meet_consultations WHERE id=NEW.consultation_id),schedule_revision=(SELECT schedule_revision FROM meet_consultations WHERE id=NEW.consultation_id) WHERE id=NEW.id; END;
