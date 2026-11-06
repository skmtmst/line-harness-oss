-- B-324: API組5、番号668承認済み。既存マークの表示は従来どおり全3か所。
ALTER TABLE support_marks ADD COLUMN display_locations_json TEXT NOT NULL DEFAULT '["inbox","friends","friend_detail"]'
  CHECK(json_valid(display_locations_json) AND json_type(display_locations_json)='array');
