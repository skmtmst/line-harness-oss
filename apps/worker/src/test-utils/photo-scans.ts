import type Database from 'better-sqlite3';
/** Existing review/paging fixtures represent files whose safety scan already completed. */
export function seedCleanPhotoScans(raw: Database.Database): void {
 raw.prepare(`INSERT OR IGNORE INTO media_file_scans
  (id,line_account_id,subject_kind,subject_id,filename,mime_type,size_bytes,status,created_at,updated_at)
  SELECT 'fixture-clean:'||id,line_account_id,'photo',id,'photo.jpg',content_type,1,'clean',created_at,updated_at
  FROM nen_photo_submissions WHERE line_account_id IS NOT NULL`).run();
}
