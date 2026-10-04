-- 成果地点と広告イベント名の対応表(F-21)。
-- どの成果をどの広告イベント名で送るかを地点ごとに持つ。
-- 対応が無い地点は今までどおり固定名(Purchase 等)で送る。
CREATE TABLE ad_event_mappings (
  conversion_point_id TEXT PRIMARY KEY REFERENCES conversion_points(id) ON DELETE CASCADE,
  event_name          TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
