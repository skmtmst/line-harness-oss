import { jstNow } from '@line-crm/db';

type Options = { lineAccountId?: string; expectedUpdatedAt?: string; deleteNull?: boolean; maxBytes?: number; firstTouchKeys?: string[] };
/** Merge top-level fields inside the UPDATE so concurrent writers never reuse a stale JSON document. */
export function friendMetadataPatchStatement(db: D1Database, friendId: string, patch: Record<string, unknown>, options: Options = {}): D1PreparedStatement {
  const data = JSON.stringify(patch);
  const merged = `(SELECT json_group_object(key, json(encoded)) FROM (
    SELECT key, CASE WHEN type IN ('array','object') THEN value WHEN type='true' THEN 'true' WHEN type='false' THEN 'false' ELSE json_quote(value) END AS encoded
      FROM json_each(CASE WHEN json_valid(metadata) AND json_type(metadata)='object' THEN metadata ELSE '{}' END)
      WHERE key NOT IN (SELECT key FROM json_each(?))
    UNION ALL SELECT key, CASE WHEN type IN ('array','object') THEN value WHEN type='true' THEN 'true' WHEN type='false' THEN 'false' ELSE json_quote(value) END AS encoded
      FROM json_each(?) WHERE (?=0 OR type<>'null')
  ))`;
  const args: unknown[] = [data, data, options.deleteNull ? 1 : 0, jstNow(), friendId];
  let where = 'id=?';
  if (options.lineAccountId !== undefined) { where += ' AND line_account_id=?'; args.push(options.lineAccountId); }
  if (options.expectedUpdatedAt !== undefined) { where += ' AND updated_at=?'; args.push(options.expectedUpdatedAt); }
  if (options.maxBytes !== undefined) { where += ` AND length(CAST(${merged} AS BLOB))<=?`; args.push(data, data, options.deleteNull ? 1 : 0, options.maxBytes); }
  for (const key of options.firstTouchKeys ?? []) {
    where += ` AND NOT EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END) WHERE key=? AND type<>'null')`;
    args.push(key);
  }
  return db.prepare(`UPDATE friends SET metadata=${merged}, updated_at=? WHERE ${where}`).bind(...args);
}
export async function patchFriendMetadata(db: D1Database, friendId: string, patch: Record<string, unknown>, options: Options = {}): Promise<boolean> {
  const result = await friendMetadataPatchStatement(db, friendId, patch, options).run();
  return Number(result.meta?.changes ?? 0) === 1;
}
