-- F-21 成果と広告イベントの対応表。
-- うちの成果地点ごとに、広告側へ返す名前（イベント名）を媒体別に持つ。
-- 対応が無い組み合わせは送らない。適用はしない（PR本文に書く）。

CREATE TABLE IF NOT EXISTS ad_conversion_event_mappings (
  id                  TEXT PRIMARY KEY,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  conversion_point_id TEXT NOT NULL REFERENCES conversion_points(id) ON DELETE CASCADE,
  ad_platform_id      TEXT NOT NULL REFERENCES ad_platforms(id) ON DELETE CASCADE,
  event_name          TEXT NOT NULL CHECK (length(trim(event_name, ' ')) > 0 AND length(event_name) <= 64),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, conversion_point_id, ad_platform_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_conversion_event_mappings_account
  ON ad_conversion_event_mappings (line_account_id);
CREATE INDEX IF NOT EXISTS idx_ad_conversion_event_mappings_point
  ON ad_conversion_event_mappings (conversion_point_id);
