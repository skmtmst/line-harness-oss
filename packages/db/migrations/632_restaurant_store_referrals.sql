-- オーナー承認 2026-10-11 / PLAN §2「系列店へ案内」（仮631→空き632）。
-- 案内への参加は既定で無効。組織の権限と顧客情報は移送しない。
ALTER TABLE rt_stores ADD COLUMN latitude REAL CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE rt_stores ADD COLUMN longitude REAL CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180);
CREATE TABLE rt_store_groups (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL REFERENCES rt_organizations(id) ON DELETE CASCADE,
 name TEXT NOT NULL
);
CREATE TABLE rt_store_group_members (
 group_id TEXT NOT NULL REFERENCES rt_store_groups(id) ON DELETE CASCADE,
 store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
 referral_enabled INTEGER NOT NULL DEFAULT 0 CHECK(referral_enabled IN(0,1)),
 max_distance REAL NOT NULL DEFAULT 5 CHECK(max_distance>=0 AND max_distance<=1000),
 PRIMARY KEY(group_id,store_id)
);
CREATE TRIGGER rt_referral_member_org BEFORE INSERT ON rt_store_group_members
WHEN NOT EXISTS(SELECT 1 FROM rt_store_groups g JOIN rt_stores s ON s.organization_id=g.organization_id WHERE g.id=NEW.group_id AND s.id=NEW.store_id)
BEGIN SELECT RAISE(ABORT,'referral_organization_conflict'); END;
CREATE TRIGGER rt_referral_member_org_update BEFORE UPDATE ON rt_store_group_members
WHEN NOT EXISTS(SELECT 1 FROM rt_store_groups g JOIN rt_stores s ON s.organization_id=g.organization_id WHERE g.id=NEW.group_id AND s.id=NEW.store_id)
BEGIN SELECT RAISE(ABORT,'referral_organization_conflict'); END;
CREATE TABLE rt_reservation_referrals (
 id TEXT PRIMARY KEY,
 source_store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
 target_store_id TEXT NOT NULL REFERENCES rt_stores(id) ON DELETE CASCADE,
 source_reservation_id TEXT REFERENCES rt_reservations(id) ON DELETE SET NULL,
 source_waitlist_id TEXT REFERENCES rt_seat_waitlist(id) ON DELETE SET NULL,
 offered_at TEXT NOT NULL DEFAULT(datetime('now')),
 accepted_at TEXT,
 CHECK(source_store_id<>target_store_id)
);
