-- B-316: 選択は予約と同じbatch、確定時の減算は同じDBトランザクション。
CREATE TABLE booking_entitlement_uses (
  booking_id TEXT UNIQUE REFERENCES bookings(id) ON DELETE SET NULL,
  booking_id_history TEXT PRIMARY KEY NOT NULL,
  entitlement_id TEXT NOT NULL REFERENCES booking_entitlements(id) ON DELETE RESTRICT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL CHECK(julianday(period_end)>julianday(period_start)),
  consumed_at TEXT
);
CREATE INDEX idx_booking_entitlement_uses_balance ON booking_entitlement_uses(entitlement_id,consumed_at);
CREATE TRIGGER booking_entitlement_use_validate BEFORE INSERT ON booking_entitlement_uses
BEGIN  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM bookings b JOIN booking_entitlements e ON e.id=NEW.entitlement_id WHERE b.id=NEW.booking_id AND b.line_account_id=e.line_account_id AND b.friend_id=e.friend_id AND e.status='active' AND (e.menu_id IS NULL OR e.menu_id=b.menu_id) AND julianday(b.starts_at)>=julianday(e.valid_from) AND julianday(b.starts_at)<julianday(e.expires_at) AND b.status IN ('requested','confirmed') AND NEW.consumed_at IS NULL) THEN RAISE(ABORT,'entitlement_unavailable') END; END;
CREATE TRIGGER booking_entitlement_confirm AFTER UPDATE OF status ON bookings
WHEN NEW.status='confirmed' AND OLD.status<>'confirmed'
BEGIN  UPDATE booking_entitlement_uses SET consumed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE booking_id=NEW.id AND consumed_at IS NULL; END;
CREATE TRIGGER booking_entitlement_immediate AFTER INSERT ON booking_entitlement_uses
WHEN (SELECT status FROM bookings WHERE id=NEW.booking_id)='confirmed'
BEGIN  UPDATE booking_entitlement_uses SET consumed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE booking_id=NEW.booking_id AND consumed_at IS NULL; END;
CREATE TRIGGER booking_entitlement_consume_guard BEFORE UPDATE OF consumed_at ON booking_entitlement_uses
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
BEGIN  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM booking_entitlements e JOIN bookings b ON b.id=NEW.booking_id WHERE e.id=NEW.entitlement_id AND b.line_account_id=e.line_account_id AND b.friend_id=e.friend_id AND (e.menu_id IS NULL OR e.menu_id=b.menu_id) AND e.status='active' AND julianday(b.starts_at)>=julianday(e.valid_from) AND julianday(b.starts_at)<julianday(e.expires_at) AND (e.kind='ticket' AND e.remaining>0 OR e.kind='monthly' AND julianday(b.starts_at)>=julianday(NEW.period_start) AND julianday(b.starts_at)<julianday(NEW.period_end) AND (SELECT COUNT(*) FROM booking_entitlement_uses u JOIN bookings other ON other.id=u.booking_id WHERE u.entitlement_id=e.id AND u.consumed_at IS NOT NULL AND julianday(other.starts_at)>=julianday(NEW.period_start) AND julianday(other.starts_at)<julianday(NEW.period_end))<COALESCE((SELECT allowance FROM booking_entitlement_month_limits ml WHERE ml.entitlement_id=e.id AND ml.period_start=NEW.period_start),e.monthly_limit))) THEN RAISE(ABORT,'entitlement_unavailable') END; END;
CREATE TRIGGER booking_entitlement_consume AFTER UPDATE OF consumed_at ON booking_entitlement_uses
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
BEGIN  UPDATE booking_entitlements SET remaining=CASE WHEN kind='ticket' THEN remaining-1 ELSE NULL END,version=version+1,updated_at=NEW.consumed_at WHERE id=NEW.entitlement_id;  INSERT INTO booking_entitlement_events(id,entitlement_id,line_account_id,action,reason,actor_type,actor_id,request_key,request_json,after_json,created_at) SELECT lower(hex(randomblob(16))),e.id,e.line_account_id,'consume','予約確定による1回利用','system',NEW.booking_id,'consume:'||NEW.booking_id,json_object('bookingId',NEW.booking_id),json_object('remaining',e.remaining,'version',e.version),NEW.consumed_at FROM booking_entitlements e WHERE e.id=NEW.entitlement_id; END;
-- 月をまたぐ変更は元の月を黙って付け替えない。店が予約を取り直す。
CREATE TRIGGER booking_entitlement_month_change BEFORE UPDATE OF starts_at ON bookings
WHEN EXISTS(SELECT 1 FROM booking_entitlement_uses u JOIN booking_entitlements e ON e.id=u.entitlement_id WHERE u.booking_id=NEW.id AND e.kind='monthly' AND (julianday(NEW.starts_at)<julianday(u.period_start) OR julianday(NEW.starts_at)>=julianday(u.period_end)))
BEGIN  SELECT RAISE(ABORT,'entitlement_month_change'); END;

CREATE TRIGGER booking_entitlement_reschedule BEFORE UPDATE OF starts_at,menu_id,friend_id,line_account_id ON bookings
WHEN EXISTS(SELECT 1 FROM booking_entitlement_uses u JOIN booking_entitlements e ON e.id=u.entitlement_id WHERE u.booking_id=NEW.id AND (NEW.line_account_id<>e.line_account_id OR NEW.friend_id IS NOT NULL AND NEW.friend_id IS NOT e.friend_id OR e.menu_id IS NOT NULL AND NEW.menu_id<>e.menu_id OR julianday(NEW.starts_at)<julianday(e.valid_from) OR julianday(NEW.starts_at)>=julianday(e.expires_at)))
BEGIN SELECT RAISE(ABORT,'entitlement_unavailable'); END;
