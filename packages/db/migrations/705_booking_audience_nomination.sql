-- B-349 / B9。既存予約は価格の控えを保ち、担当変更時だけ指名料を外す。
ALTER TABLE menus ADD COLUMN audience_mode TEXT NOT NULL DEFAULT 'all' CHECK(audience_mode IN('all','include_tags','exclude_tags'));
ALTER TABLE menus ADD COLUMN audience_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(audience_tag_ids_json));
ALTER TABLE staff ADD COLUMN nomination_fee INTEGER NOT NULL DEFAULT 0 CHECK(nomination_fee >= 0);
ALTER TABLE bookings ADD COLUMN nominated INTEGER NOT NULL DEFAULT 0 CHECK(nominated IN(0,1));
ALTER TABLE bookings ADD COLUMN nomination_fee_at_booking INTEGER NOT NULL DEFAULT 0 CHECK(nomination_fee_at_booking >= 0);
CREATE TRIGGER booking_nomination_reassign AFTER UPDATE OF staff_id ON bookings
WHEN OLD.staff_id IS NOT NEW.staff_id AND OLD.nominated=1
BEGIN UPDATE bookings SET nominated=0,nomination_fee_at_booking=0,
 price_at_booking=MAX(0,NEW.price_at_booking-OLD.nomination_fee_at_booking) WHERE id=NEW.id; END;
