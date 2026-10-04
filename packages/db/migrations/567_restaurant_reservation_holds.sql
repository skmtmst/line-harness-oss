-- 仮押さえは期限まで席を占有し、解除後も予約台帳に履歴を残す。
ALTER TABLE rt_reservations ADD COLUMN hold_expires_at TEXT;
CREATE INDEX idx_rt_reservation_hold_expiry ON rt_reservations(hold_expires_at) WHERE status = 'pending' AND hold_expires_at IS NOT NULL;

-- 時間の異なる同時要求も、同じ卓の重なりを一回の書き込みで止める。
CREATE TRIGGER rt_reservation_hold_insert BEFORE INSERT ON rt_reservations
WHEN NEW.table_id IS NOT NULL AND NEW.status NOT IN ('cancelled', 'no_show')
 AND EXISTS (SELECT 1 FROM rt_reservations r WHERE r.store_id = NEW.store_id AND r.table_id = NEW.table_id
  AND r.status NOT IN ('cancelled', 'no_show') AND datetime(r.starts_at) < datetime(NEW.ends_at) AND datetime(r.ends_at) > datetime(NEW.starts_at)
  AND (NEW.hold_expires_at IS NOT NULL OR r.hold_expires_at IS NOT NULL)
  AND (r.hold_expires_at IS NULL OR r.status <> 'pending' OR datetime(r.hold_expires_at) > datetime('now')))
BEGIN SELECT RAISE(ABORT, 'restaurant_table_conflict'); END;
CREATE TRIGGER rt_reservation_hold_update BEFORE UPDATE OF table_id, starts_at, ends_at, status ON rt_reservations
WHEN NEW.table_id IS NOT NULL AND NEW.status NOT IN ('cancelled', 'no_show')
 AND EXISTS (SELECT 1 FROM rt_reservations r WHERE r.id <> NEW.id AND r.store_id = NEW.store_id AND r.table_id = NEW.table_id
  AND r.status NOT IN ('cancelled', 'no_show') AND datetime(r.starts_at) < datetime(NEW.ends_at) AND datetime(r.ends_at) > datetime(NEW.starts_at)
  AND (NEW.hold_expires_at IS NOT NULL OR r.hold_expires_at IS NOT NULL)
  AND (r.hold_expires_at IS NULL OR r.status <> 'pending' OR datetime(r.hold_expires_at) > datetime('now')))
BEGIN SELECT RAISE(ABORT, 'restaurant_table_conflict'); END;
