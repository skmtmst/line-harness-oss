-- B-316 / M6-M8。最初の会員判定はタグ。詳細は任意に追加できる。
ALTER TABLE event_slots ADD COLUMN instructor_id TEXT REFERENCES staff(id);
ALTER TABLE event_slots ADD COLUMN classroom_capacity INTEGER CHECK(classroom_capacity IS NULL OR classroom_capacity>=0);
ALTER TABLE event_slots ADD COLUMN online_capacity INTEGER CHECK(online_capacity IS NULL OR online_capacity>=0);
ALTER TABLE events ADD COLUMN is_trial INTEGER NOT NULL DEFAULT 0 CHECK(is_trial IN(0,1));
ALTER TABLE event_bookings ADD COLUMN participation_mode TEXT NOT NULL DEFAULT 'classroom' CHECK(participation_mode IN('classroom','online'));
ALTER TABLE event_waitlist ADD COLUMN participation_mode TEXT NOT NULL DEFAULT 'classroom' CHECK(participation_mode IN('classroom','online'));
CREATE TABLE lesson_memberships (
 id TEXT PRIMARY KEY, line_account_id TEXT NOT NULL REFERENCES line_accounts(id), friend_id TEXT NOT NULL REFERENCES friends(id),
 plan_name TEXT, joined_at TEXT NOT NULL, ended_at TEXT, withdrawal_reason TEXT, expires_at TEXT,
 remaining_uses INTEGER CHECK(remaining_uses IS NULL OR remaining_uses>=0), updated_by TEXT,
 version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
 UNIQUE(line_account_id,friend_id)
);
