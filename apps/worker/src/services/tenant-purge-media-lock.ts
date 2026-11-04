/** Expire abandoned checks; deleting jobs remain available for an immediate retry. */
export async function releasePurgeMediaLeases(db:D1Database, input:{mediaIds:string[];owner:string;now:string}):Promise<void> {
  if (!input.mediaIds.length) return;
  await db.prepare(`UPDATE media_deletion_jobs SET lease_owner=NULL,
    lease_expires_at=CASE WHEN status='checking' THEN ? ELSE NULL END,updated_at=?
    WHERE lease_owner=? AND media_id IN (SELECT value FROM json_each(?))`)
    .bind(input.now,input.now,input.owner,JSON.stringify(input.mediaIds)).run();
}

/** Acquire a bounded batch without a read/write gap or per-image round trips. */
export async function lockPurgeMedia(db:D1Database, input:{
  media:Array<{id:string;accountId:string}>; tenantId:string; tenantMarker:string;
  owner:string; now:string; leaseUntil:string;
}):Promise<boolean> {
  if (!input.media.length) return true;
  const candidates=JSON.stringify(input.media);
  try {
    await db.batch([
      db.prepare(`UPDATE media_deletion_jobs SET lease_owner=?,lease_expires_at=?,updated_at=?
        WHERE status IN ('checking','deleting') AND (lease_owner=? OR lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at<=?)
          AND EXISTS (SELECT 1 FROM json_each(?) c WHERE json_extract(c.value,'$.id')=media_deletion_jobs.media_id AND json_extract(c.value,'$.accountId')=media_deletion_jobs.line_account_id)
          AND NOT EXISTS (SELECT 1 FROM media_send_claims s WHERE s.media_id=media_deletion_jobs.media_id AND s.expires_at>?)`)
        .bind(input.owner,input.leaseUntil,input.now,input.owner,input.now,candidates,input.now),
      db.prepare(`INSERT INTO media_deletion_jobs(media_id,line_account_id,r2_keys_json,status,lease_owner,lease_expires_at,created_at,updated_at)
        SELECT m.id,json_extract(c.value,'$.accountId'),
          (SELECT json_group_array(key) FROM (SELECT m.r2_key AS key UNION SELECT v.r2_key FROM media_versions v WHERE v.media_id=m.id)),
          'checking',?,?,?,? FROM json_each(?) c JOIN media m ON m.id=json_extract(c.value,'$.id')
        WHERE ((m.line_account_id=json_extract(c.value,'$.accountId') AND EXISTS
          (SELECT 1 FROM line_accounts a WHERE a.id=m.line_account_id AND a.tenant_id=?)) OR
          (m.line_account_id IS NULL AND json_extract(c.value,'$.accountId')=?
           AND NOT EXISTS(SELECT 1 FROM line_accounts a WHERE a.id=?)
           AND (SELECT tenant_id FROM banner_images b WHERE b.media_id=m.id ORDER BY b.created_at,b.id LIMIT 1)=?))
          AND NOT EXISTS(SELECT 1 FROM media_deletion_jobs j WHERE j.media_id=m.id)
          AND NOT EXISTS(SELECT 1 FROM media_send_claims s WHERE s.media_id=m.id AND s.expires_at>?)`)
        .bind(input.owner,input.leaseUntil,input.now,input.now,candidates,input.tenantId,input.tenantMarker,input.tenantMarker,input.tenantId,input.now),
      db.prepare(`INSERT INTO media_deletion_guards(blocked) SELECT 1 WHERE EXISTS(SELECT 1 FROM json_each(?) c
        WHERE NOT EXISTS(SELECT 1 FROM media_deletion_jobs j WHERE j.media_id=json_extract(c.value,'$.id')
          AND j.line_account_id=json_extract(c.value,'$.accountId') AND j.lease_owner=? AND j.lease_expires_at>?)
        OR NOT EXISTS(SELECT 1 FROM media m WHERE m.id=json_extract(c.value,'$.id') AND
          ((m.line_account_id=json_extract(c.value,'$.accountId') AND EXISTS(SELECT 1 FROM line_accounts a WHERE a.id=m.line_account_id AND a.tenant_id=?))
          OR (m.line_account_id IS NULL AND json_extract(c.value,'$.accountId')=? AND NOT EXISTS(SELECT 1 FROM line_accounts a WHERE a.id=?)
            AND (SELECT tenant_id FROM banner_images b WHERE b.media_id=m.id ORDER BY b.created_at,b.id LIMIT 1)=?))))`)
        .bind(candidates,input.owner,input.now,input.tenantId,input.tenantMarker,input.tenantMarker,input.tenantId),
    ]);
    return true;
  } catch(error) {
    if (String(error).includes('media_deletion_in_progress')) return false;
    throw error;
  }
}

/** Fence the irreversible operation and retain hashes of every captured key. */
export async function beginPurgeMedia(db:D1Database, input:{mediaIds:string[];owner:string;now:string}):Promise<boolean> {
  if (!input.mediaIds.length) return true;
  const ids=JSON.stringify(input.mediaIds);
  const jobs=await db.prepare(`SELECT r2_keys_json FROM media_deletion_jobs
    WHERE media_id IN (SELECT value FROM json_each(?)) AND lease_owner=? AND lease_expires_at>?`)
    .bind(ids,input.owner,input.now).all<{r2_keys_json:string}>();
  if (jobs.results.length!==input.mediaIds.length) return false;
  const keys=new Set<string>();
  for (const job of jobs.results) for (const key of JSON.parse(job.r2_keys_json) as string[]) keys.add(key);
  const hashes=await Promise.all([...keys].map(async key => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),byte=>byte.toString(16).padStart(2,'0')).join('')));
  try {
    await db.batch([
      db.prepare(`UPDATE media_deletion_jobs SET status='deleting',updated_at=? WHERE media_id IN (SELECT value FROM json_each(?))
        AND lease_owner=? AND lease_expires_at>? AND status IN ('checking','deleting')`).bind(input.now,ids,input.owner,input.now),
      db.prepare(`INSERT OR IGNORE INTO media_deleted_key_fingerprints(sha256) SELECT value FROM json_each(?)`).bind(JSON.stringify(hashes)),
      db.prepare(`INSERT INTO media_deletion_guards(blocked) SELECT 1 WHERE EXISTS(SELECT 1 FROM json_each(?) ids
        WHERE NOT EXISTS(SELECT 1 FROM media_deletion_jobs j WHERE j.media_id=ids.value AND j.lease_owner=? AND j.lease_expires_at>? AND j.status='deleting'))`)
        .bind(ids,input.owner,input.now),
    ]);
    return true;
  } catch(error) {
    if (String(error).includes('media_deletion_in_progress')) return false;
    throw error;
  }
}

/** Never use a lease that elapsed while impact scanning was in progress. */
export async function renewPurgeMedia(db:D1Database, input:{mediaIds:string[];owner:string;now:string;leaseUntil:string}):Promise<boolean> {
  if (!input.mediaIds.length) return true;
  const ids=JSON.stringify(input.mediaIds);
  try {
    await db.batch([
      db.prepare(`UPDATE media_deletion_jobs SET lease_expires_at=?,updated_at=? WHERE media_id IN (SELECT value FROM json_each(?))
        AND lease_owner=? AND lease_expires_at>? AND status='deleting'`).bind(input.leaseUntil,input.now,ids,input.owner,input.now),
      db.prepare(`INSERT INTO media_deletion_guards(blocked) SELECT 1 WHERE EXISTS(SELECT 1 FROM json_each(?) ids
        WHERE NOT EXISTS(SELECT 1 FROM media_deletion_jobs j WHERE j.media_id=ids.value AND j.lease_owner=? AND j.lease_expires_at>? AND j.status='deleting'))`)
        .bind(ids,input.owner,input.now),
    ]);
    return true;
  } catch(error) {
    if (String(error).includes('media_deletion_in_progress')) return false;
    throw error;
  }
}
