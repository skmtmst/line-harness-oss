export const MEDIA_CONTENT_DELETION_GUARD_SQL = `INSERT INTO media_deletion_guards(blocked)
    SELECT 1 WHERE EXISTS (
      SELECT 1 FROM media_deletion_jobs j, json_each(?) content
      WHERE content.value = j.media_id
         OR EXISTS (SELECT 1 FROM json_tree(CASE WHEN json_valid(content.value) THEN content.value ELSE 'null' END) item WHERE item.type = 'text' AND item.value = j.media_id)
         OR instr(content.value, '/media/' || j.media_id || '/content') > 0
         OR EXISTS (SELECT 1 FROM json_each(j.r2_keys_json) key
           WHERE length(key.value) > 0 AND instr(content.value, key.value) > 0)
    )`;

/** Compare decoded nested URLs as well as their original representation. */
export function mediaReferenceVariants(values: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 32) throw new Error('media_reference_too_nested');
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    if (value && typeof value === 'object') { for (const item of Object.values(value)) visit(item, depth + 1); return; }
    if (typeof value !== 'string' || !value || found.has(value)) return;
    found.add(value);
    try { const decoded = decodeURIComponent(value); if (decoded !== value) visit(decoded, depth + 1); } catch { /* retain the original */ }
    try { const parsed: unknown = JSON.parse(value); if (parsed !== value) visit(parsed, depth + 1); } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  };
  for (const value of values) visit(value, 0);
  return [...found];
}

/** Every account receiving the reference must belong to the media owner's tenant. */
export function mediaTenantGuard(db: D1Database, values: Array<string | null | undefined>, accountIds: string[]): D1PreparedStatement[] {
  return mediaTenantGuardByQuery(db, values, 'SELECT value AS account_id FROM json_each(?)', [JSON.stringify(accountIds)]);
}

/** Resolve the accounts in the batch itself when the owner is a mutable row. */
export function mediaTenantGuardByQuery(db: D1Database, values: Array<string | null | undefined>, accountsSql: string, binds: unknown[]): D1PreparedStatement[] {
  const content = mediaReferenceVariants(values);
  if (!content.length) return [];
  return mediaTenantGuardByQueries(db, accountsSql, binds, 'SELECT value FROM json_each(?)', [JSON.stringify(content)]);
}

export function mediaTenantGuardByQueries(db: D1Database, accountsSql: string, accountBinds: unknown[], contentSql: string, contentBinds: unknown[]): D1PreparedStatement[] {
  return [db.prepare(`INSERT INTO media_tenant_guards(blocked)
    WITH targets AS (${accountsSql}), target_summary AS (
      SELECT COUNT(*) AS total, COUNT(target.id) AS known, COUNT(target.tenant_id) AS tenant_count,
             MIN(target.id) AS first_id, MAX(target.id) AS last_id,
             MIN(target.tenant_id) AS first_tenant, MAX(target.tenant_id) AS last_tenant
        FROM targets ids LEFT JOIN line_accounts target ON target.id=ids.account_id
    )
    SELECT 1 WHERE EXISTS (
      SELECT 1 FROM media m LEFT JOIN line_accounts owner ON owner.id=m.line_account_id
      JOIN target_summary targets
      JOIN (${contentSql}) content
      WHERE NOT COALESCE(targets.total>0 AND targets.known=targets.total AND
        ((targets.first_id=owner.id AND targets.last_id=owner.id)
          OR (owner.tenant_id IS NOT NULL AND targets.tenant_count=targets.total
            AND targets.first_tenant=owner.tenant_id AND targets.last_tenant=owner.tenant_id)
          OR (m.line_account_id IS NULL AND targets.tenant_count=targets.total
            AND (SELECT MIN(b.tenant_id) FROM banner_images b WHERE b.media_id=m.id) = targets.first_tenant
            AND (SELECT MAX(b.tenant_id) FROM banner_images b WHERE b.media_id=m.id) = targets.last_tenant
            AND targets.first_tenant=targets.last_tenant)), 0)
        AND (content.value=m.id
          OR EXISTS (SELECT 1 FROM json_tree(CASE WHEN json_valid(content.value) THEN content.value ELSE 'null' END) item WHERE item.type='text' AND item.value=m.id)
          OR EXISTS (SELECT 1 FROM json_tree(CASE WHEN json_valid(content.value) THEN content.value ELSE 'null' END) item,
            json_tree(CASE WHEN json_valid(item.value) THEN item.value ELSE 'null' END) nested
            WHERE item.type='text' AND nested.type='text' AND nested.value=m.id)
          OR instr(content.value, '/media/' || m.id || '/content') > 0
          OR (length(m.r2_key)>0 AND instr(content.value,m.r2_key)>0)
          OR EXISTS (SELECT 1 FROM media_versions v WHERE v.media_id=m.id AND length(v.r2_key)>0 AND instr(content.value,v.r2_key)>0))
    )`).bind(...accountBinds, ...contentBinds)];
}

/** Add the assertion to the same batch as the body which introduces a reference. */
export async function mediaContentDeletionGuard(db: D1Database, values: Array<string | null | undefined>, accountIds?: string[]): Promise<D1PreparedStatement[]> {
  const content = mediaReferenceVariants(values);
  if (!content.length) return [];
  return [db.prepare(MEDIA_CONTENT_DELETION_GUARD_SQL).bind(JSON.stringify(content)), ...await mediaDeletedKeyFingerprintGuard(db, content), ...(accountIds ? mediaTenantGuard(db, content, accountIds) : [])];
}

/** Build an atomic check for stored URLs and keys; no raw keys are persisted here. */
export async function mediaDeletedKeyFingerprintGuard(db: D1Database, values: Array<string | null | undefined>, options: { checkLiveIds?: boolean } = {}): Promise<D1PreparedStatement[]> {
  const candidates = new Set<string>();
  const liveIds = new Set<string>();
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 32) throw new Error('media_reference_too_nested');
    if (value == null) return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    if (typeof value === 'object') { for (const item of Object.values(value)) visit(item, depth + 1); return; }
    if (typeof value !== 'string' || !value) return;
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* plain text */ }
    if (parsed !== value) visit(parsed, depth + 1);
    const words = [value, ...(value.match(/https?:\/\/[^\s<>"'`]+/g) ?? []), ...(value.match(/(?:\/images\/|media\/)[a-zA-Z0-9._~%/\-]+/g) ?? [])];
    const variants = words.flatMap(word => [word, word.replace(/[),.;!?]+$/, '')]);
    for (const word of variants) {
      candidates.add(word);
      let path = word;
      try { path = new URL(word).pathname; } catch { /* R2 key */ }
      try { path = decodeURIComponent(path); } catch { /* preserve original */ }
      path = path.replace(/^\/+/, '');
      const parts = path.split('/');
      for (let index = 0; index < parts.length; index++) candidates.add(parts.slice(index).join('/'));
      const live = path.match(/^(?:api\/)?media\/([^/]+)\/content$/);
      if (live && (word.startsWith('/') || /^https?:\/\//.test(word)) && options.checkLiveIds !== false) liveIds.add(live[1]);
    }
  };
  for (const value of values) visit(value);
  const hashes = await Promise.all([...candidates].filter(Boolean).map(async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')));
  if (!hashes.length && !liveIds.size) return [];
  return [db.prepare(`INSERT INTO media_deletion_guards(blocked)
    SELECT 1 WHERE EXISTS (SELECT 1 FROM media_deleted_key_fingerprints f JOIN json_each(?) h ON h.value=f.sha256)
      OR EXISTS (SELECT 1 FROM json_each(?) live WHERE NOT EXISTS(SELECT 1 FROM media WHERE id=live.value))`)
    .bind(JSON.stringify(hashes), JSON.stringify([...liveIds]))];
}
