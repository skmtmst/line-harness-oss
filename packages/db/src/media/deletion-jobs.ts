/** Durable deletion state is independent of the user-facing archive state. */
export type MediaDeletionJob = {
  media_id: string;
  line_account_id: string;
  r2_keys_json: string;
  status: 'checking' | 'deleting' | 'completed';
  lease_owner: string | null;
  lease_expires_at: string | null;
};

/**
 * Capture every current object key and claim the operation in one D1 batch.
 * Existing unfinished jobs can be reclaimed after their lease expires; their
 * original key list and phase must never be replaced by a retry.
 */
export async function claimMediaDeletion(
  db: D1Database,
  input: { mediaId: string; accountId: string; owner: string; now: string; leaseUntil: string },
): Promise<MediaDeletionJob | null> {
  const { mediaId, accountId, owner, now, leaseUntil } = input;
  const [claimed, inserted] = await db.batch([
    db.prepare(`UPDATE media_deletion_jobs SET lease_owner=?, lease_expires_at=?, updated_at=?
      WHERE media_id=? AND line_account_id=? AND status IN ('checking','deleting')
        AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at<=?)
        AND NOT EXISTS (SELECT 1 FROM media_send_claims s WHERE s.media_id=media_deletion_jobs.media_id AND s.expires_at>?)`)
      .bind(owner, leaseUntil, now, mediaId, accountId, now, now),
    db.prepare(`INSERT INTO media_deletion_jobs
      (media_id,line_account_id,r2_keys_json,status,lease_owner,lease_expires_at,created_at,updated_at)
      SELECT m.id,m.line_account_id,
        (SELECT json_group_array(key) FROM (
          SELECT m.r2_key AS key UNION SELECT v.r2_key AS key FROM media_versions v WHERE v.media_id=m.id
        )), 'checking',?,?,?,?
      FROM media m WHERE m.id=? AND m.line_account_id=?
        AND NOT EXISTS (SELECT 1 FROM media_deletion_jobs j WHERE j.media_id=m.id)
        AND NOT EXISTS (SELECT 1 FROM media_send_claims s WHERE s.media_id=m.id AND s.expires_at>?)`)
      .bind(owner, leaseUntil, now, now, mediaId, accountId, now),
  ]);
  if (!(claimed.meta?.changes || inserted.meta?.changes)) return null;
  return db.prepare(`SELECT * FROM media_deletion_jobs WHERE media_id=? AND line_account_id=? AND lease_owner=?`)
    .bind(mediaId, accountId, owner).first<MediaDeletionJob>();
}

/** Abandon only a check that never started deleting objects. */
export async function releaseUnstartedMediaDeletion(db: D1Database, mediaId: string, accountId: string, owner: string): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM media_deletion_jobs WHERE media_id=? AND line_account_id=? AND status='checking' AND lease_owner=?`)
    .bind(mediaId, accountId, owner).run();
  return (result.meta?.changes ?? 0) === 1;
}

/** Fence the final check before the first irreversible R2 operation. */
export async function beginMediaObjectDeletion(db: D1Database, mediaId: string, accountId: string, owner: string, now: string): Promise<boolean> {
  const job = await db.prepare(`SELECT r2_keys_json FROM media_deletion_jobs WHERE media_id=? AND line_account_id=? AND status='checking' AND lease_owner=? AND lease_expires_at>?`)
    .bind(mediaId, accountId, owner, now).first<{r2_keys_json:string}>();
  if (!job) return false;
  const keys = JSON.parse(job.r2_keys_json) as string[];
  const fingerprints = await Promise.all(keys.map(async key => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), byte => byte.toString(16).padStart(2, '0')).join('')));
  const [result] = await db.batch([
    db.prepare(`UPDATE media_deletion_jobs SET status='deleting',updated_at=?
      WHERE media_id=? AND line_account_id=? AND status='checking' AND lease_owner=? AND lease_expires_at>? AND r2_keys_json=?`)
      .bind(now, mediaId, accountId, owner, now, job.r2_keys_json),
    db.prepare(`INSERT OR IGNORE INTO media_deleted_key_fingerprints(sha256)
      SELECT value FROM json_each(?) WHERE EXISTS(SELECT 1 FROM media_deletion_jobs
        WHERE media_id=? AND line_account_id=? AND status='deleting' AND lease_owner=? AND lease_expires_at>? AND r2_keys_json=?)`)
      .bind(JSON.stringify(fingerprints), mediaId, accountId, owner, now, job.r2_keys_json),
  ]);
  return (result.meta?.changes ?? 0) === 1;
}

/** Remove the metadata and mark the durable record complete in the same batch. */
export async function finishMediaDeletion(db: D1Database, mediaId: string, accountId: string, owner: string, now: string): Promise<boolean> {
  const [removed, completed] = await db.batch([
    db.prepare(`DELETE FROM media WHERE id=? AND line_account_id=? AND EXISTS (
      SELECT 1 FROM media_deletion_jobs WHERE media_id=? AND line_account_id=?
        AND status='deleting' AND lease_owner=? AND lease_expires_at>?)`)
      .bind(mediaId, accountId, mediaId, accountId, owner, now),
    db.prepare(`UPDATE media_deletion_jobs SET status='completed',lease_owner=NULL,lease_expires_at=NULL,updated_at=?
      WHERE media_id=? AND line_account_id=? AND status='deleting' AND lease_owner=? AND changes()=1`)
      .bind(now, mediaId, accountId, owner),
  ]);
  return (removed.meta?.changes ?? 0) === 1 && (completed.meta?.changes ?? 0) === 1;
}

/** Release ownership after a failure without reopening registration. */
export async function releaseMediaDeletionLease(db: D1Database, mediaId: string, accountId: string, owner: string, now: string): Promise<boolean> {
  const result = await db.prepare(`UPDATE media_deletion_jobs SET lease_owner=NULL,lease_expires_at=NULL,updated_at=?
    WHERE media_id=? AND line_account_id=? AND status='deleting' AND lease_owner=?`)
    .bind(now, mediaId, accountId, owner).run();
  return (result.meta?.changes ?? 0) === 1;
}
