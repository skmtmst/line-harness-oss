-- Web計測の公開口(#819)。サイトごとの公開IDと、計測を許可するドメインの
-- 一覧を持つ。タグに載せるのはサイトIDだけで、秘密の鍵は埋め込まない。
-- 許可にないドメインから来た分は数えず、件数と最後の来た先だけを残す。

CREATE TABLE IF NOT EXISTS measurement_sites (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_measurement_sites_account ON measurement_sites(line_account_id);

CREATE TABLE IF NOT EXISTS measurement_site_domains (
  site_id    TEXT NOT NULL REFERENCES measurement_sites(id) ON DELETE CASCADE,
  host       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (site_id, host)
);

CREATE TABLE IF NOT EXISTS measurement_domain_rejections (
  site_id        TEXT NOT NULL REFERENCES measurement_sites(id) ON DELETE CASCADE,
  host           TEXT NOT NULL,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at   TEXT NOT NULL,
  PRIMARY KEY (site_id, host)
);

-- 友だちと結び付かない成果(#819)。成果地点ごとの「匿名を数える」設定が
-- 立っているときだけ、1日ごとの合計として残す。
CREATE TABLE IF NOT EXISTS conversion_anonymous_days (
  conversion_point_id TEXT NOT NULL REFERENCES conversion_points(id) ON DELETE CASCADE,
  day                 TEXT NOT NULL,
  anonymous_count     INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (conversion_point_id, day)
);

ALTER TABLE conversion_points ADD COLUMN count_anonymous INTEGER NOT NULL DEFAULT 0;
