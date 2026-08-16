-- メディアライブラリと共通情報。

CREATE TABLE IF NOT EXISTS media (
  id          TEXT PRIMARY KEY,
  folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('image','video','audio','file')),
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER,
  r2_key      TEXT NOT NULL UNIQUE,
  public_url  TEXT,
  uploaded_by TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_media_kind ON media(kind, created_at DESC);

-- 使用箇所。削除前に「5か所で使われています」と出すための表。
-- 本文をスキャンして作り直すので、正確さは最後のスキャン時点まで。
CREATE TABLE IF NOT EXISTS media_usages (
  media_id   TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  ref_kind   TEXT NOT NULL CHECK (ref_kind IN (
               'template','broadcast','rich_menu','scenario_step',
               'nen_column','event','webinar')),
  ref_id     TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  PRIMARY KEY (media_id, ref_kind, ref_id)
);

CREATE TABLE IF NOT EXISTS common_vars (
  id          TEXT PRIMARY KEY,
  folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  -- {shop_hours} のように使う。形の制約は friend_fields.field_key と同じ。
  var_key     TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL DEFAULT 'text'
                CHECK (type IN ('text','url','image','number')),
  value       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

-- 日付での自動切り替え。予約した時刻を過ぎたものを Cron が反映して
-- applied_at を打つ。applied_at が NULL の行だけを見るので、
-- 二度反映されない。
CREATE TABLE IF NOT EXISTS common_var_schedules (
  id             TEXT PRIMARY KEY,
  var_id         TEXT NOT NULL REFERENCES common_vars(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  value          TEXT NOT NULL,
  applied_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_cvs_pending
  ON common_var_schedules(var_id, effective_from) WHERE applied_at IS NULL;
