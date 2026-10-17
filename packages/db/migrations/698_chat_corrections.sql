-- B-344/B-349: gap1。DBへの適用は司令塔が別工程で行う。
ALTER TABLE messages_log ADD COLUMN correction_of_message_id TEXT REFERENCES messages_log(id);
CREATE INDEX idx_message_correction_of ON messages_log(correction_of_message_id) WHERE correction_of_message_id IS NOT NULL;
ALTER TABLE scheduled_chat_sends ADD COLUMN cancellation_reason TEXT;
