export const MEDIA_CONTENT_DELETION_GUARD_SQL = `INSERT INTO media_deletion_guards(blocked)
    SELECT 1 WHERE EXISTS (
      SELECT 1 FROM media_deletion_jobs j, json_each(?) content
      WHERE content.value = j.media_id
         OR EXISTS (SELECT 1 FROM json_tree(CASE WHEN json_valid(content.value) THEN content.value ELSE 'null' END) item WHERE item.type = 'text' AND item.value = j.media_id)
         OR instr(content.value, '/media/' || j.media_id || '/content') > 0
         OR EXISTS (SELECT 1 FROM json_each(j.r2_keys_json) key
           WHERE length(key.value) > 0 AND instr(content.value, key.value) > 0)
    )`;

/** Add the assertion to the same batch as the body which introduces a reference. */
export async function mediaContentDeletionGuard(db: D1Database, values: Array<string | null | undefined>): Promise<D1PreparedStatement[]> {
  const content = values.filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (!content.length) return [];
  return [db.prepare(MEDIA_CONTENT_DELETION_GUARD_SQL).bind(JSON.stringify(content)), ...await mediaDeletedKeyFingerprintGuard(db, content)];
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
