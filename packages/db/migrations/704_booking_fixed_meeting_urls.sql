ALTER TABLE staff ADD COLUMN fixed_meeting_url TEXT;
ALTER TABLE staff ADD COLUMN meeting_url_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE menus ADD COLUMN fixed_meeting_url TEXT;
ALTER TABLE bookings ADD COLUMN meeting_url_source TEXT CHECK(meeting_url_source IN('staff','menu','manual'));
CREATE TRIGGER booking_fixed_meeting_insert AFTER INSERT ON bookings WHEN NEW.status='confirmed'
BEGIN UPDATE bookings SET meeting_url=COALESCE((SELECT fixed_meeting_url FROM staff WHERE id=NEW.staff_id AND line_account_id=NEW.line_account_id),(SELECT fixed_meeting_url FROM menus WHERE id=NEW.menu_id AND line_account_id=NEW.line_account_id)),
 meeting_url_source=CASE WHEN (SELECT fixed_meeting_url FROM staff WHERE id=NEW.staff_id) IS NOT NULL THEN 'staff' ELSE 'menu' END
 WHERE id=NEW.id AND COALESCE(NEW.meeting_mode,(SELECT meeting_mode FROM menus WHERE id=NEW.menu_id))='online' AND NEW.meeting_url IS NULL; END;
CREATE TRIGGER booking_fixed_meeting_confirm AFTER UPDATE OF status,staff_id ON bookings
WHEN NEW.status='confirmed' AND (OLD.status!='confirmed' OR OLD.staff_id!=NEW.staff_id)
BEGIN UPDATE bookings SET meeting_url=COALESCE((SELECT fixed_meeting_url FROM staff WHERE id=NEW.staff_id AND line_account_id=NEW.line_account_id),(SELECT fixed_meeting_url FROM menus WHERE id=NEW.menu_id AND line_account_id=NEW.line_account_id)),
 meeting_url_source=CASE WHEN (SELECT fixed_meeting_url FROM staff WHERE id=NEW.staff_id) IS NOT NULL THEN 'staff' ELSE 'menu' END
 WHERE id=NEW.id AND NEW.meeting_mode='online'; END;
CREATE TRIGGER booking_fixed_meeting_cancel AFTER UPDATE OF status ON bookings WHEN NEW.status IN('cancelled','rejected','expired')
BEGIN UPDATE bookings SET meeting_url=NULL,meeting_url_source=NULL WHERE id=NEW.id; END;
