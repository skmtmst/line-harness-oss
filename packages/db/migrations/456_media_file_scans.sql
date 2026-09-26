-- 危険なファイルの検査の台帳。上げたファイルごとに検査の状態を持つ。
-- 確かめています(pending)→使えます(clean)／使えません(rejected・理由コード)／しまった(quarantined)。
-- clean になるまで配信・公開・審査・LIFF に出さない。検査が動かない時は pending のまま置く。
CREATE TABLE IF NOT EXISTS media_file_scans (
  id               TEXT PRIMARY KEY,
  -- 全体で使う素材（配信用画像など）はアカウントを持たないため NULL を許す。
  line_account_id  TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
  -- form_file / broadcast_asset / generic_image は R2 キーを subject_id に入れる。
  subject_kind     TEXT NOT NULL CHECK (subject_kind IN (
                     'media', 'media_version', 'upload_session', 'photo',
                     'form_file', 'broadcast_asset', 'generic_image')),
  subject_id       TEXT NOT NULL,
  media_id         TEXT REFERENCES media(id) ON DELETE SET NULL,
  filename         TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL CHECK (size_bytes >= 0),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'clean', 'rejected', 'quarantined')),
  reason_code      TEXT,
  reason_detail    TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_retry_at    TEXT,
  scanned_at       TEXT,
  quarantined_at   TEXT,
  released_at      TEXT,
  release_reason   TEXT,
  released_by      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_media_file_scans_account_status
  ON media_file_scans(line_account_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_file_scans_subject
  ON media_file_scans(subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS idx_media_file_scans_media
  ON media_file_scans(media_id, status) WHERE media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_file_scans_retry
  ON media_file_scans(status, next_retry_at) WHERE status = 'pending';
