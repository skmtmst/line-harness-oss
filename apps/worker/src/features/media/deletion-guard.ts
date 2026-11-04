import { mediaDeletedKeyFingerprintGuard, mediaReferenceVariants, mediaTenantGuard } from '@line-crm/db/src/media/deletion-guard.js';

/** Check ownership together with the write, including older fixed versions. */
export function mediaTenantTextGuardStatements(db: D1Database, values: Array<string | null | undefined>, accountIds: string[]): D1PreparedStatement[] {
  return mediaTenantGuard(db, values, accountIds);
}
/** Add these statements to the same D1 batch as the reference write. */
export function mediaDeletionGuardStatements(db: D1Database, mediaIds: Array<string | null>, accountIds?: string[]): D1PreparedStatement[] {
  const ids = [...new Set(mediaIds.filter((id): id is string => Boolean(id)))];
  const result: D1PreparedStatement[] = [];
  for (let offset = 0; offset < ids.length; offset += 90) {
    const chunk = ids.slice(offset, offset + 90);
    result.push(db.prepare(`INSERT INTO media_deletion_guards(blocked)
      SELECT 1 WHERE EXISTS (SELECT 1 FROM json_each(?) candidate WHERE EXISTS (SELECT 1 FROM media_deletion_jobs j WHERE j.media_id=candidate.value) OR NOT EXISTS (SELECT 1 FROM media m WHERE m.id=candidate.value))`).bind(JSON.stringify(chunk)));
  }
  if (accountIds) result.push(...mediaTenantGuard(db, ids, accountIds));
  return result;
}

/** D1 wraps SQLite errors; match only our deliberately named constraint. */
export function isMediaDeletionConflict(error: unknown): boolean {
  return String(error).includes('media_deletion_in_progress');
}
export function isMediaTenantConflict(error: unknown): boolean {
  return String(error).includes('media_cross_tenant_reference');
}

/** For synced payloads which contain R2 keys or live URLs rather than IDs. */
export const MEDIA_DELETION_TEXT_GUARD_SQL = `INSERT INTO media_deletion_guards(blocked)
    SELECT 1 WHERE EXISTS (SELECT 1 FROM media_deletion_jobs j, json_each(?) content
      WHERE content.value = j.media_id
        OR EXISTS (SELECT 1 FROM json_tree(CASE WHEN json_valid(content.value) THEN content.value ELSE 'null' END) item WHERE item.type = 'text' AND item.value = j.media_id)
        OR instr(content.value, '/media/' || j.media_id || '/content') > 0
        OR EXISTS (SELECT 1 FROM json_each(j.r2_keys_json) key WHERE length(key.value) > 0 AND instr(content.value, key.value) > 0))`;

export async function mediaDeletionTextGuardStatements(db: D1Database, values: Array<string | null | undefined>, accountIds?: string[]): Promise<D1PreparedStatement[]> {
  const content = mediaReferenceVariants(values);
  if (!content.length) return [];
  return [db.prepare(MEDIA_DELETION_TEXT_GUARD_SQL).bind(JSON.stringify(content)), ...await mediaDeletedKeyFingerprintGuard(db, content), ...(accountIds ? mediaTenantGuard(db, content, accountIds) : [])];
}
