-- B1 最小。店の既定・手動請求のみ。将来の変更で過去の予約の決まりは変えない。
CREATE TABLE booking_cancellation_policies (
 line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id), enabled INTEGER NOT NULL DEFAULT 0,
 tiers_json TEXT NOT NULL CHECK(json_valid(tiers_json)), no_show_percent INTEGER NOT NULL CHECK(no_show_percent BETWEEN 0 AND 100),
 charge_mode TEXT NOT NULL DEFAULT 'manual' CHECK(charge_mode='manual'), version INTEGER NOT NULL DEFAULT 1,
 updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE bookings ADD COLUMN policy_snapshot_json TEXT CHECK(policy_snapshot_json IS NULL OR json_valid(policy_snapshot_json));
CREATE TRIGGER booking_cancellation_policy_snapshot AFTER INSERT ON bookings
BEGIN UPDATE bookings SET policy_snapshot_json=(SELECT json_object('enabled',json(CASE WHEN enabled=1 THEN 'true' ELSE 'false' END),'tiers',json(tiers_json),'noShowPercent',no_show_percent,'version',version)
 FROM booking_cancellation_policies WHERE line_account_id=NEW.line_account_id) WHERE id=NEW.id AND policy_snapshot_json IS NULL; END;
