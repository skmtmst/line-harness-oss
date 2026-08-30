-- 写真の採用と公開を分離する。既存の採用写真は、明示同意がないため非公開のまま移行する。
ALTER TABLE nen_photo_submissions ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);
ALTER TABLE nen_photo_submissions ADD COLUMN publication_consent_version TEXT;
ALTER TABLE nen_photo_submissions ADD COLUMN publication_consent_at TEXT;
ALTER TABLE nen_photo_submissions ADD COLUMN publication_withdrawn_at TEXT;
ALTER TABLE nen_photo_submissions ADD COLUMN public_pet_name INTEGER NOT NULL DEFAULT 0
  CHECK (public_pet_name IN (0, 1));

UPDATE nen_photo_submissions
   SET line_account_id = (
     SELECT f.line_account_id FROM friends f WHERE f.id = nen_photo_submissions.friend_id
   )
 WHERE line_account_id IS NULL;

CREATE INDEX idx_nen_photos_account_status
  ON nen_photo_submissions(line_account_id, status, created_at DESC);
CREATE INDEX idx_nen_photos_publication
  ON nen_photo_submissions(line_account_id, publication_consent_at, reviewed_at DESC)
  WHERE status = 'adopted' AND publication_withdrawn_at IS NULL;
