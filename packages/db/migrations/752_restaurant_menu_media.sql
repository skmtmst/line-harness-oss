ALTER TABLE rt_menu_items ADD COLUMN description TEXT;
ALTER TABLE rt_menu_items ADD COLUMN image_media_id TEXT REFERENCES media(id);
