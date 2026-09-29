-- 登録メディアの容量上限、R2直接アップロード、差し替え版を同じアカウント境界で管理する。

CREATE TABLE media_storage_quotas (
  line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  limit_bytes     INTEGER NOT NULL DEFAULT 10737418240 CHECK (limit_bytes > 0),
  updated_by      TEXT,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

INSERT INTO media_storage_quotas (line_account_id)
SELECT id FROM line_accounts;

CREATE TABLE media_upload_sessions (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  target_media_id   TEXT REFERENCES media(id) ON DELETE CASCADE,
  result_media_id   TEXT REFERENCES media(id) ON DELETE SET NULL,
  folder_id         TEXT REFERENCES folders(id) ON DELETE SET NULL,
  filename          TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('image','video','audio','file')),
  expected_mime     TEXT NOT NULL,
  expected_size     INTEGER NOT NULL CHECK (expected_size > 0),
  r2_key            TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','verified','completed','failed','expired')),
  failure_code      TEXT,
  etag              TEXT,
  expires_at        TEXT NOT NULL,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  completed_at      TEXT
);
CREATE INDEX idx_media_upload_sessions_account_status
  ON media_upload_sessions(line_account_id, status, expires_at);
CREATE INDEX idx_media_upload_sessions_target
  ON media_upload_sessions(target_media_id, status, created_at DESC);

CREATE TABLE media_versions (
  id             TEXT PRIMARY KEY,
  media_id       TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  version_no     INTEGER NOT NULL CHECK (version_no > 0),
  r2_key         TEXT NOT NULL UNIQUE,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL CHECK (size_bytes >= 0),
  width          INTEGER,
  height         INTEGER,
  duration_ms    INTEGER,
  page_count     INTEGER,
  codec          TEXT,
  content_hash   TEXT,
  etag           TEXT,
  scan_status    TEXT NOT NULL DEFAULT 'verified'
                     CHECK (scan_status IN ('pending','verified','failed','quarantined')),
  scan_result    TEXT,
  scanned_at     TEXT,
  change_reason  TEXT,
  uploaded_by    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  published_at   TEXT,
  UNIQUE (media_id, version_no)
);
CREATE INDEX idx_media_versions_media_created
  ON media_versions(media_id, version_no DESC, created_at DESC);

-- 既存ファイルも版1として扱う。以後の版は別R2キーへ保存し、上書きしない。
INSERT INTO media_versions (
  id, media_id, version_no, r2_key, mime_type, size_bytes, width, height,
  duration_ms, scan_status, uploaded_by, created_at, published_at
)
SELECT
  'media-version-' || id || '-1', id, 1, r2_key, mime_type, size_bytes, width, height,
  duration_ms, 'verified', uploaded_by, created_at, created_at
FROM media;
