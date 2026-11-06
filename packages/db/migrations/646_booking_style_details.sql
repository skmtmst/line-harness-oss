-- B-316 / API組4: M1-M5。外部サービスへの作成・送信は行わない。
ALTER TABLE menus ADD COLUMN meeting_mode TEXT NOT NULL DEFAULT 'in_person' CHECK(meeting_mode IN('online','in_person','customer_choice'));
ALTER TABLE menus ADD COLUMN meeting_location TEXT;
ALTER TABLE bookings ADD COLUMN meeting_mode TEXT CHECK(meeting_mode IN('online','in_person'));
ALTER TABLE bookings ADD COLUMN meeting_url TEXT;
ALTER TABLE bookings ADD COLUMN meeting_location TEXT;
ALTER TABLE bookings ADD COLUMN consultation_outcome TEXT CHECK(consultation_outcome IN('considering','won','lost'));
ALTER TABLE bookings ADD COLUMN outcome_recorded_at TEXT;
ALTER TABLE bookings ADD COLUMN outcome_recorded_by TEXT;
ALTER TABLE bookings ADD COLUMN cancellation_reason TEXT;
ALTER TABLE bookings ADD COLUMN designation TEXT NOT NULL DEFAULT 'unspecified' CHECK(designation IN('designated','any','unspecified'));
ALTER TABLE bookings ADD COLUMN entry_point TEXT;
ALTER TABLE meet_consultations ADD COLUMN staff_id TEXT REFERENCES staff(id);
ALTER TABLE meet_consultations ADD COLUMN attendance TEXT CHECK(attendance IN('visited','late','no_show'));
ALTER TABLE meet_consultations ADD COLUMN consultation_outcome TEXT CHECK(consultation_outcome IN('considering','won','lost'));
ALTER TABLE meet_consultations ADD COLUMN outcome_recorded_at TEXT;
ALTER TABLE meet_consultations ADD COLUMN outcome_recorded_by TEXT;
ALTER TABLE rt_reservations ADD COLUMN staff_id TEXT REFERENCES staff(id);
CREATE TRIGGER style_booking_meeting_snapshot AFTER INSERT ON bookings
WHEN NEW.meeting_mode IS NULL OR NEW.meeting_location IS NULL
BEGIN UPDATE bookings SET meeting_mode=COALESCE(NEW.meeting_mode,(SELECT CASE WHEN meeting_mode='customer_choice' THEN NULL ELSE meeting_mode END FROM menus WHERE id=NEW.menu_id AND line_account_id=NEW.line_account_id)),meeting_location=COALESCE(NEW.meeting_location,(SELECT meeting_location FROM menus WHERE id=NEW.menu_id AND line_account_id=NEW.line_account_id)) WHERE id=NEW.id; END;
