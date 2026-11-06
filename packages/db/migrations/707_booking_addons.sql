ALTER TABLE menus ADD COLUMN max_party_size INTEGER NOT NULL DEFAULT 1 CHECK(max_party_size BETWEEN 1 AND 6);
ALTER TABLE menus ADD COLUMN addon_menu_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(addon_menu_ids_json));
ALTER TABLE menus ADD COLUMN addon_only INTEGER NOT NULL DEFAULT 0 CHECK(addon_only IN(0,1));
CREATE TABLE booking_addons(booking_id TEXT NOT NULL REFERENCES bookings(id),addon_menu_id TEXT NOT NULL REFERENCES menus(id),duration_min INTEGER NOT NULL CHECK(duration_min>0),price_at_booking INTEGER NOT NULL CHECK(price_at_booking>=0),PRIMARY KEY(booking_id,addon_menu_id));
