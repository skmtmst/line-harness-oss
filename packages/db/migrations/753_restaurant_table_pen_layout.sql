-- Pen seat management: floors/areas and table display conditions.
ALTER TABLE rt_floors ADD COLUMN kind TEXT NOT NULL DEFAULT 'floor' CHECK(kind IN ('floor','area'));
ALTER TABLE rt_floors ADD COLUMN parent_floor_id TEXT REFERENCES rt_floors(id);
ALTER TABLE rt_floors ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE rt_tables ADD COLUMN smoking_policy TEXT NOT NULL DEFAULT 'non_smoking' CHECK(smoking_policy IN ('non_smoking','smoking','heated_tobacco'));
ALTER TABLE rt_tables ADD COLUMN partition_type TEXT NOT NULL DEFAULT 'open' CHECK(partition_type IN ('open','semi_private','private'));
ALTER TABLE rt_tables ADD COLUMN shoes_allowed INTEGER NOT NULL DEFAULT 1 CHECK(shoes_allowed IN (0,1));
ALTER TABLE rt_tables ADD COLUMN visible_on_map INTEGER NOT NULL DEFAULT 1 CHECK(visible_on_map IN (0,1));
ALTER TABLE rt_tables ADD COLUMN chair_arrangement TEXT NOT NULL DEFAULT 'both' CHECK(chair_arrangement IN ('both','one','all'));
ALTER TABLE rt_tables ADD COLUMN chair_side TEXT CHECK(chair_side IN ('top','right','bottom','left'));
ALTER TABLE rt_tables ADD COLUMN seat_detail_type TEXT CHECK(seat_detail_type IN ('table','counter','horigotatsu','zashiki','private_room','terrace'));
