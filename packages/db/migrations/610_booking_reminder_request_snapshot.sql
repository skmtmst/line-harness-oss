-- W4: Freeze the first outbound request before sending. Existing rows remain
-- NULL and use the existing renderer on their next attempt, then retain it.
ALTER TABLE booking_reminders ADD COLUMN retry_key TEXT;
ALTER TABLE booking_reminders ADD COLUMN recipient_line_user_id TEXT;
ALTER TABLE booking_reminders ADD COLUMN messages_json TEXT;
