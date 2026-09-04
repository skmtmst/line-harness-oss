-- メディア使用先の定期走査を複数回のcronへ分割する進捗。
CREATE TABLE IF NOT EXISTS media_usage_scan_state (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  source_index     INTEGER NOT NULL DEFAULT 0,
  last_ref_id      TEXT NOT NULL DEFAULT '',
  cycle_started_at TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
