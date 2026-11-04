import { DEFAULT_TENANT_ID } from '@line-crm/shared';

export const MEDIA_CONTENT_DELETION_GUARD_SQL = `INSERT INTO media_deletion_guards(blocked)
    SELECT 1 WHERE EXISTS (
      SELECT 1 FROM media_deletion_jobs j, json_each(?) content
      WHERE j.status IN ('checking','deleting') AND (content.value = j.media_id
         OR EXISTS (SELECT 1 FROM json_tree(CASE WHEN json_valid(content.value) THEN content.value ELSE 'null' END) item WHERE item.type = 'text' AND item.value = j.media_id)
         OR instr(content.value, '/media/' || j.media_id || '/content') > 0
         OR EXISTS (SELECT 1 FROM json_each(j.r2_keys_json) key
           WHERE length(key.value) > 0 AND instr(content.value, key.value) > 0))
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
export function mediaTenantGuard(db: D1Database, values: Array<string | null | undefined>, accountIds: string[], tenantId?: string | null): D1PreparedStatement[] {
  return mediaTenantGuardByQuery(db, values, 'SELECT value AS account_id FROM json_each(?)', [JSON.stringify(accountIds)], tenantId);
}

/** Resolve the accounts in the batch itself when the owner is a mutable row. */
export function mediaTenantGuardByQuery(db: D1Database, values: Array<string | null | undefined>, accountsSql: string, binds: unknown[], tenantId?: string | null): D1PreparedStatement[] {
  const content = mediaReferenceCandidates(values);
  if (!content.length) return [];
  return mediaTenantGuardByQueries(db, accountsSql, binds, 'SELECT value FROM json_each(?)', [JSON.stringify(content)], tenantId);
}

export function mediaReferenceCandidates(values: Array<string | null | undefined>): string[] {
  const candidates = new Set<string>();
  let bytes = 2;
  const add = (candidate: string) => {
    if (!candidate || candidates.has(candidate)) return;
    if (candidate.length > 2048 || candidates.size >= 4096) throw new Error('media_reference_limit_exceeded');
    bytes += new TextEncoder().encode(JSON.stringify(candidate)).length + 1;
    if (bytes > 1_000_000) throw new Error('media_reference_limit_exceeded');
    candidates.add(candidate);
  };
  for (const value of mediaReferenceVariants(values)) {
    const standalone = /^[a-zA-Z0-9_.~%-]+$/.test(value);
    const pathValue = /^(?:\/?[a-zA-Z0-9_.~%-]+\/)/.test(value) && !/[<>"'`\r\n]/.test(value);
    function* words() {
      if (pathValue) yield value;
      for (const match of value.matchAll(/https?:\/\/[^\s<>"'`]+|[a-zA-Z0-9_.~%/-]+/g)) yield match[0];
    }
    for (const word of words()) {
      if (!standalone && !word.includes('/') && !/%2f/i.test(word) && !/\.[a-z0-9]{2,8}$/i.test(word)) continue;
      if (word.length > 2048) throw new Error('media_reference_limit_exceeded');
      let path = word.replace(/[),.;!?]+$/, '');
      add(path);
      try { path = new URL(path).pathname; } catch { /* text or key */ }
      let decoded=path;
      try { decoded = decodeURIComponent(path); } catch { /* retain original */ }
      for (const variant of new Set([path,decoded])) {
        const parts=variant.replace(/^\/+/, '').split('/');
        if (parts.length > 64) throw new Error('media_reference_limit_exceeded');
        for (let index=0;index<parts.length;index++) if (parts[index]) add(parts.slice(index).join('/'));
        const live=variant.match(/\/(?:api\/)?media\/([^/]+)\/content(?:$|[?#])/);
        if (live) add(live[1]);
      }
    }
  }
  return [...candidates];
}

export function mediaTenantGuardByQueries(db: D1Database, accountsSql: string, accountBinds: unknown[], contentSql: string, contentBinds: unknown[], tenantId?: string | null): D1PreparedStatement[] {
  return [db.prepare(`INSERT INTO media_tenant_guards(blocked)
    WITH targets AS (${accountsSql}), contents AS (${contentSql}), target_summary AS (
      SELECT COUNT(*) AS total, COUNT(target.id) AS known, COUNT(target.tenant_id) AS tenant_count,
             MIN(target.id) AS first_id, MAX(target.id) AS last_id,
             MIN(target.tenant_id) AS first_tenant, MAX(target.tenant_id) AS last_tenant
        FROM targets ids LEFT JOIN line_accounts target ON target.id=ids.account_id WHERE ids.account_id IS NOT NULL AND ids.account_id<>''
    )
    SELECT 1 WHERE EXISTS (
      SELECT 1 FROM media m LEFT JOIN line_accounts owner ON owner.id=m.line_account_id
      JOIN target_summary targets
      WHERE NOT COALESCE((targets.total=0 AND (owner.tenant_id=? OR (m.line_account_id IS NULL
            AND (SELECT MIN(b.tenant_id) FROM banner_images b WHERE b.media_id=m.id)=?
            AND (SELECT MAX(b.tenant_id) FROM banner_images b WHERE b.media_id=m.id)=?))) OR (targets.total>0 AND targets.known=targets.total AND
        ((targets.first_id=owner.id AND targets.last_id=owner.id)
          OR (owner.tenant_id IS NOT NULL AND targets.tenant_count=targets.total
            AND targets.first_tenant=owner.tenant_id AND targets.last_tenant=owner.tenant_id)
          OR (m.line_account_id IS NULL AND targets.tenant_count=targets.total
            AND (SELECT MIN(b.tenant_id) FROM banner_images b WHERE b.media_id=m.id) = targets.first_tenant
            AND (SELECT MAX(b.tenant_id) FROM banner_images b WHERE b.media_id=m.id) = targets.last_tenant
            AND targets.first_tenant=targets.last_tenant))), 0)
        AND m.id IN (SELECT value FROM contents UNION SELECT found.id FROM contents c JOIN media found ON found.r2_key=c.value UNION SELECT v.media_id FROM media_versions v JOIN contents c ON c.value=v.r2_key)
    )`).bind(...accountBinds, ...contentBinds, tenantId ?? DEFAULT_TENANT_ID, tenantId ?? DEFAULT_TENANT_ID, tenantId ?? DEFAULT_TENANT_ID)];
}

/** Add the assertion to the same batch as the body which introduces a reference. */
export async function mediaContentDeletionGuard(db: D1Database, values: Array<string | null | undefined>, accountIds?: string[], tenantId?: string | null): Promise<D1PreparedStatement[]> {
  const content = mediaReferenceVariants(values);
  if (!content.length) return [];
  return [...(accountIds ? mediaTenantGuard(db, content, accountIds, tenantId) : []), ...await mediaDeletedKeyFingerprintGuard(db, content), db.prepare(MEDIA_CONTENT_DELETION_GUARD_SQL).bind(JSON.stringify(content))];
}

/** Build an atomic check for stored URLs and keys; no raw keys are persisted here. */
export async function mediaDeletedKeyFingerprintGuard(db: D1Database, values: Array<string | null | undefined>, options: { checkLiveIds?: boolean } = {}): Promise<D1PreparedStatement[]> {
  const candidates = mediaReferenceCandidates(values);
  const liveIds = new Set<string>();
  if (options.checkLiveIds !== false) for (const value of mediaReferenceVariants(values)) {
    for (const match of value.matchAll(/(?:https?:\/\/[^\s<>"'`]+|\/(?:api\/)?media\/[^\s<>"'`]+)/g)) {
      let path = match[0].replace(/[),.;!?]+$/, '');
      try { path = new URL(path).pathname; } catch { /* relative URL */ }
      try { path = decodeURIComponent(path); } catch { /* retain original */ }
      const live = path.match(/^\/(?:api\/)?media\/([^/]+)\/content(?:$|[?#])/);
      if (live) liveIds.add(live[1]);
    }
  }
  const hashes = await Promise.all(candidates.map(async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')));
  if (!hashes.length && !liveIds.size) return [];
  return [db.prepare(`INSERT INTO media_tenant_guards(blocked)
    SELECT 1 WHERE EXISTS (SELECT 1 FROM json_each(?) live WHERE NOT EXISTS(SELECT 1 FROM media WHERE id=live.value))`).bind(JSON.stringify([...liveIds])),
    db.prepare(`INSERT INTO media_deletion_guards(blocked)
    SELECT 1 WHERE EXISTS (SELECT 1 FROM media_deleted_key_fingerprints f JOIN json_each(?) h ON h.value=f.sha256)`).bind(JSON.stringify(hashes))];
}
