-- B-344 approved 2026-10-16: simulation only; never mark rank history as delivered.
ALTER TABLE member_rank_programs ADD COLUMN notify_upgrade INTEGER NOT NULL DEFAULT 1 CHECK(notify_upgrade IN(0,1));
ALTER TABLE member_rank_programs ADD COLUMN notify_downgrade INTEGER NOT NULL DEFAULT 1 CHECK(notify_downgrade IN(0,1));
ALTER TABLE member_rank_tiers ADD COLUMN coupon_code TEXT;
ALTER TABLE member_rank_tiers ADD COLUMN upgrade_message_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(upgrade_message_json));
ALTER TABLE member_rank_tiers ADD COLUMN downgrade_message_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(downgrade_message_json));
CREATE TABLE member_rank_notices (
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES line_accounts(id),friend_id TEXT NOT NULL REFERENCES friends(id),
 change_key TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('upgrade','downgrade_warning')),tier_id TEXT NOT NULL REFERENCES member_rank_tiers(id),
 purpose TEXT NOT NULL CHECK(purpose IN('notice','marketing')),messages_json TEXT NOT NULL CHECK(json_valid(messages_json)),base_messages_json TEXT NOT NULL CHECK(json_valid(base_messages_json)),
 scheduled_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN('scheduled','simulated','cancelled','skipped_late','skipped_opted_out','skipped_blocked','skipped_disabled')),
 processed_at TEXT,test_mode INTEGER NOT NULL DEFAULT 1 CHECK(test_mode=1),UNIQUE(account_id,friend_id,change_key,kind)
);
CREATE INDEX member_rank_notices_due ON member_rank_notices(status,scheduled_at);
UPDATE tags SET manual_assignment_allowed=0 WHERE id IN(SELECT tag_id FROM member_rank_tiers);

-- B-349 LIFF display identity: independent of public/internal friend identifiers.
ALTER TABLE friends ADD COLUMN member_number TEXT;
CREATE UNIQUE INDEX friends_account_member_number ON friends(line_account_id,member_number);
UPDATE friends SET member_number=upper(hex(randomblob(8))) WHERE member_number IS NULL;
CREATE TRIGGER friends_issue_member_number AFTER INSERT ON friends WHEN NEW.member_number IS NULL BEGIN
 UPDATE friends SET member_number=upper(hex(randomblob(8))) WHERE id=NEW.id; END;
ALTER TABLE member_rank_tiers ADD COLUMN benefit_descriptions_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(benefit_descriptions_json));
