-- B7: 店と担当の両方がオンの方向だけ動く。新規の店・担当は初期オフ。
CREATE TABLE booking_calendar_switches (
 line_account_id TEXT NOT NULL REFERENCES line_accounts(id),scope_id TEXT NOT NULL DEFAULT '',
 read_enabled INTEGER NOT NULL DEFAULT 0 CHECK(read_enabled IN(0,1)),write_enabled INTEGER NOT NULL DEFAULT 0 CHECK(write_enabled IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL,mutation_token TEXT,PRIMARY KEY(line_account_id,scope_id)
);
CREATE TABLE booking_calendar_switch_audit (
 id TEXT PRIMARY KEY,line_account_id TEXT NOT NULL,scope_id TEXT NOT NULL,actor_id TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE booking_calendar_busy_cache (
 line_account_id TEXT NOT NULL,staff_id TEXT NOT NULL,connection_id TEXT NOT NULL,calendar_id TEXT NOT NULL,
 time_min TEXT NOT NULL,time_max TEXT NOT NULL,busy_json TEXT NOT NULL CHECK(json_valid(busy_json)),last_read_at TEXT NOT NULL,
 PRIMARY KEY(line_account_id,staff_id)
);
CREATE TABLE booking_calendar_switch_jobs (
 id TEXT PRIMARY KEY,line_account_id TEXT NOT NULL,staff_id TEXT NOT NULL,booking_id TEXT NOT NULL REFERENCES bookings(id),
 action TEXT NOT NULL CHECK(action IN('delete','write')),external_event_id TEXT,calendar_id TEXT,
 switch_scope TEXT NOT NULL,switch_version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','failed','done','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,error_code TEXT,created_at TEXT NOT NULL,UNIQUE(booking_id,action,switch_scope,switch_version)
);
CREATE TABLE booking_calendar_read_health (
 line_account_id TEXT NOT NULL,staff_id TEXT NOT NULL,last_success_at TEXT,failed_since TEXT,error_code TEXT,
 PRIMARY KEY(line_account_id,staff_id)
);
