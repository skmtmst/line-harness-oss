-- B-316 / M8。教室とオンラインの在庫を、予約・招待の同じ書き込みで守る。
CREATE TRIGGER style_event_bookings_insert_capacity BEFORE INSERT ON event_bookings
WHEN NEW.status IN('requested','confirmed') AND EXISTS(SELECT 1 FROM event_slots s WHERE s.id=NEW.slot_id AND (s.classroom_capacity IS NOT NULL OR s.online_capacity IS NOT NULL)
 AND CASE WHEN NEW.participation_mode='classroom' THEN s.classroom_capacity ELSE s.online_capacity END IS NOT NULL
 AND COALESCE((SELECT SUM(b.party_size) FROM event_bookings b WHERE b.slot_id=s.id AND b.id<>NEW.id AND b.participation_mode=NEW.participation_mode AND b.status IN('requested','confirmed')),0)
 + COALESCE((SELECT SUM(w.party_size) FROM event_waitlist w WHERE w.slot_id=s.id AND w.participation_mode=NEW.participation_mode AND w.status IN('offered','accepted') AND w.identity_key IS NOT NEW.identity_key),0)
 + NEW.party_size > CASE WHEN NEW.participation_mode='classroom' THEN s.classroom_capacity ELSE s.online_capacity END)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER style_event_bookings_update_capacity BEFORE UPDATE ON event_bookings
WHEN NEW.status IN('requested','confirmed') AND EXISTS(SELECT 1 FROM event_slots s WHERE s.id=NEW.slot_id AND (s.classroom_capacity IS NOT NULL OR s.online_capacity IS NOT NULL)
 AND CASE WHEN NEW.participation_mode='classroom' THEN s.classroom_capacity ELSE s.online_capacity END IS NOT NULL
 AND COALESCE((SELECT SUM(b.party_size) FROM event_bookings b WHERE b.slot_id=s.id AND b.id<>NEW.id AND b.participation_mode=NEW.participation_mode AND b.status IN('requested','confirmed')),0)
 + COALESCE((SELECT SUM(w.party_size) FROM event_waitlist w WHERE w.slot_id=s.id AND w.participation_mode=NEW.participation_mode AND w.status IN('offered','accepted') AND w.identity_key IS NOT NEW.identity_key),0)
 + NEW.party_size > CASE WHEN NEW.participation_mode='classroom' THEN s.classroom_capacity ELSE s.online_capacity END)
BEGIN SELECT RAISE(ABORT,'style_mode_capacity_full'); END;
CREATE TRIGGER style_event_waitlist_insert_capacity BEFORE INSERT ON event_waitlist
WHEN NEW.status IN('offered','accepted') AND EXISTS(SELECT 1 FROM event_slots s WHERE s.id=NEW.slot_id AND (s.classroom_capacity IS NOT NULL OR s.online_capacity IS NOT NULL)
 AND CASE WHEN NEW.participation_mode='classroom' THEN s.classroom_capacity ELSE s.online_capacity END IS NOT NULL
 AND COALESCE((SELECT SUM(b.party_size) FROM event_waitlist b WHERE b.slot_id=s.id AND b.id<>NEW.id AND b.participation_mode=NEW.participation_mode AND b.status IN('offered','accepted')),0)
 + COALESCE((SELECT SUM(w.party_size) FROM event_bookings w WHERE w.slot_id=s.id AND w.participation_mode=NEW.participation_mode AND w.status IN('requested','confirmed') AND w.identity_key IS NOT NEW.identity_key),0)
 + NEW.party_size > CASE WHEN NEW.participation_mode='classroom' THEN s.classroom_capacity ELSE s.online_capacity END)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER style_event_waitlist_update_capacity BEFORE UPDATE ON event_waitlist
WHEN NEW.status IN('offered','accepted') AND EXISTS(SELECT 1 FROM event_slots s WHERE s.id=NEW.slot_id AND (s.classroom_capacity IS NOT NULL OR s.online_capacity IS NOT NULL)
 AND CASE WHEN NEW.participation_mode='classroom' THEN s.classroom_capacity ELSE s.online_capacity END IS NOT NULL
 AND COALESCE((SELECT SUM(b.party_size) FROM event_waitlist b WHERE b.slot_id=s.id AND b.id<>NEW.id AND b.participation_mode=NEW.participation_mode AND b.status IN('offered','accepted')),0)
 + COALESCE((SELECT SUM(w.party_size) FROM event_bookings w WHERE w.slot_id=s.id AND w.participation_mode=NEW.participation_mode AND w.status IN('requested','confirmed') AND w.identity_key IS NOT NEW.identity_key),0)
 + NEW.party_size > CASE WHEN NEW.participation_mode='classroom' THEN s.classroom_capacity ELSE s.online_capacity END)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER style_slot_capacity_update BEFORE UPDATE OF classroom_capacity,online_capacity ON event_slots
WHEN EXISTS(SELECT 1 FROM (SELECT 'classroom' mode,NEW.classroom_capacity capacity UNION ALL SELECT 'online',NEW.online_capacity) c WHERE c.capacity IS NOT NULL
 AND COALESCE((SELECT SUM(party_size) FROM event_bookings b WHERE b.slot_id=NEW.id AND b.participation_mode=c.mode AND b.status IN('requested','confirmed')),0)
 +COALESCE((SELECT SUM(party_size) FROM event_waitlist w WHERE w.slot_id=NEW.id AND w.participation_mode=c.mode AND w.status IN('offered','accepted')),0)>c.capacity)
BEGIN SELECT RAISE(ABORT,'style_mode_capacity_full'); END;
