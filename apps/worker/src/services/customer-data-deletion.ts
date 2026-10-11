import { auditEventStatement, RETENTION_R2_KEY_COLUMNS } from '@line-crm/db';
import relations from './customer-data-relations.json';
import protectedRelations from './customer-data-protected-relations.json';

export type DeletionKind = 'form_response' | 'friend_data';
export type DeletionTarget = {
  kind: DeletionKind; id: string; accountId: string | null; friendId: string | null;
  formId?: string; lineUserId?: string;
};
type Journal = { id: string; action: string; detail_json: string; actor_id: string };
type Detail = { accountId: string | null; formId?: string; token: string; leaseUntil: number; completedAt?: string; rows?: number };
type Relation = { friendColumns: string[]; lineUserColumn: boolean; references: Array<{ parent: string; columns: Array<{ column: string; parentColumn: string }> }> };
const graph: Record<string, Relation> = relations;
export const deletionJournalId = (kind: DeletionKind, id: string) => `customer-delete:${kind}:${id}`;
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
export class DeletionFailure extends Error {
  constructor(public status: 409 | 503, public code: string) { super(code); }
}
export async function deletionJournal(db: D1Database, kind: DeletionKind, id: string): Promise<(Journal & { detail: Detail }) | null> {
  const row = await db.prepare('SELECT id, action, detail_json, actor_id FROM operation_audit WHERE id = ?')
    .bind(deletionJournalId(kind, id)).first<Journal>();
  return row ? { ...row, detail: JSON.parse(row.detail_json) as Detail } : null;
}
/** The durable intent survives R2 errors, database rollback and a lost HTTP response. */
export async function customerDeletionPending(db: D1Database, friendId: string | null, submissionId?: string | null): Promise<boolean> {
  return !!await db.prepare(`SELECT 1 FROM operation_audit WHERE target_kind = 'customer_deletion'
    AND action <> 'deleted' AND ((target_id = ? AND id = ?) OR (friend_id = ? AND id = ?)) LIMIT 1`)
    .bind(submissionId ?? '', deletionJournalId('form_response', submissionId ?? ''), friendId ?? '', deletionJournalId('friend_data', friendId ?? '')).first();
}

/** Values are bound; every identifier comes from the reviewed schema relation list. */
export function friendDeletionCondition(table: string, seen = new Set<string>()): string {
  if (table === 'friends') return '"friends".id = ?1';
  if (seen.has(table) || !graph[table]) return '0';
  const next = new Set(seen).add(table);
  const rel = graph[table];
  const conditions = rel.friendColumns.map(col => `${q(table)}.${q(col)} = ?1`);
  if (rel.lineUserColumn) conditions.push(`(${q(table)}.line_user_id = ?2 AND ${q(table)}.line_account_id IS ?3)`);
  for (const ref of rel.references) {
    // These are the customer's own outcome/attribution, not the referrer's data.
    // Their nullable affiliate references are detached in the final atomic batch.
    if (ref.parent === 'affiliates' && ['conversion_events', 'affiliate_attribution_decisions'].includes(table)) continue;
    const inner = friendDeletionCondition(ref.parent, next);
    if (inner !== '0') conditions.push(`EXISTS (SELECT 1 FROM ${q(ref.parent)} WHERE ${inner} AND ${ref.columns.map(col => `${q(ref.parent)}.${q(col.parentColumn)} = ${q(table)}.${q(col.column)}`).join(' AND ')})`);
  }
  return conditions.length ? `(${conditions.join(' OR ')})` : '0';
}
const responseConditions: Record<string, string> = {
  form_submissions: 'id = ?1',
  form_submission_files: 'submission_id = ?1',
  media_file_scans: 'id IN (SELECT scan_id FROM form_submission_files WHERE submission_id = ?1)',
  form_submit_claims: 'submission_id = ?1',
  form_submit_outbox: `EXISTS (SELECT 1 FROM form_submit_claims c WHERE c.submission_id = ?1
    AND c.tenant_id = form_submit_outbox.tenant_id AND c.line_account_id = form_submit_outbox.line_account_id
    AND c.form_id = form_submit_outbox.form_id AND c.friend_id = form_submit_outbox.friend_id
    AND c.idempotency_key = form_submit_outbox.idempotency_key)`,
  form_capacity_claims: 'submission_id = ?1',
};
function conditionsFor(target: DeletionTarget): Record<string, string> {
  if (target.kind === 'form_response') return responseConditions;
  const result = Object.fromEntries(Object.keys(graph).map(table => [table, friendDeletionCondition(table)]));
  result.media_file_scans = 'id IN (SELECT scan_id FROM form_submission_files WHERE friend_id = ?1)';
  return result;
}
function childFirst(tables: string[]): string[] {
  const result: string[] = [], visited = new Set<string>();
  const visit = (table: string) => {
    if (visited.has(table)) return;
    visited.add(table);
    for (const child of tables) if (graph[child]?.references.some(ref => ref.parent === table)) visit(child);
    // Non-FK semantic parents still need to survive until their children are removed.
    if (table === 'form_submissions') for (const child of ['form_submission_files', 'form_submit_outbox', 'form_submit_claims', 'form_capacity_claims', 'media_file_scans']) if (tables.includes(child)) visit(child);
    if (table === 'form_submission_files' && tables.includes('media_file_scans')) visit('media_file_scans');
    if (table === 'form_submit_claims' && tables.includes('form_submit_outbox')) visit('form_submit_outbox');
    result.push(table);
  };
  for (const table of tables) visit(table);
  return result;
}
type Snapshot = { table: string; condition: string; rows: Array<Record<string, unknown> & { _delete_rowid: number }>; keys: string[] };

export async function deleteCustomerData(env: { DB: D1Database; IMAGES?: Pick<R2Bucket, 'delete'> }, target: DeletionTarget, actorId: string): Promise<{ deleted: true; replayed: boolean }> {
  const db = env.DB, id = deletionJournalId(target.kind, target.id);
  const prior = await deletionJournal(db, target.kind, target.id);
  if (prior?.action === 'deleted') return { deleted: true, replayed: true };
  const conditions = conditionsFor(target);
  const params = target.kind === 'friend_data' ? [target.id, target.lineUserId ?? '', target.accountId] : [target.id];
  // Fail closed on an unapplied/partial migration, before intent or R2 changes.
  // SQL identifiers are only from the reviewed 13-table/15-reference manifest.
  if (target.kind === 'friend_data') {
    for (const [table, refs] of Object.entries(protectedRelations)) {
      const columns = (await db.prepare(`PRAGMA table_info(${q(table)})`).all<{ name: string; notnull: number }>()).results;
      const foreignKeys = (await db.prepare(`PRAGMA foreign_key_list(${q(table)})`).all<{ from: string; table: string; on_delete: string }>()).results;
      for (const ref of refs) for (const col of ref.columns) {
        if (!columns.some(c => c.name === `${col.column}_history`)
          || !columns.some(c => c.name === col.column && c.notnull === 0)
          || !foreignKeys.some(f => f.from === col.column && f.table === ref.parent && f.on_delete === 'SET NULL')) {
          throw new DeletionFailure(409, 'deletion_schema_approval_required');
        }
      }
    }
  }
  const protectedChecks = Object.entries(protectedRelations).flatMap(([table, refs]) => refs.flatMap(ref => {
    if (target.kind === 'friend_data') return [];
    const condition = conditions[ref.parent];
    if (!condition) return [];
    return [{ table, condition: `EXISTS (SELECT 1 FROM ${q(ref.parent)} WHERE ${condition} AND ${ref.columns.map(col => `${q(ref.parent)}.${q(col.parentColumn)} = ${q(table)}.${q(col.column)}`).join(' AND ')})` }];
  }));
  // An affiliate can be referenced by another customer's conversion. Do not
  // traverse that relation by erasing the other customer's own records.
  if (target.kind === 'friend_data') {
    for (const [table, relation] of Object.entries(graph)) {
      if (relation.friendColumns.includes('friend_id')) protectedChecks.push({ table,
        condition: `(${conditions[table]}) AND ${q(table)}.friend_id IS NOT NULL AND ${q(table)}.friend_id <> ?1` });
    }
  }
  const preserved = protectedChecks.length ? await db.batch(protectedChecks.map(check => db.prepare(`SELECT 1 AS present FROM ${q(check.table)} WHERE ${check.condition} LIMIT 1`).bind(...(check.condition.includes('?3') ? params : [params[0]])))) : [];
  if (preserved.some(result => result.results.length)) throw new DeletionFailure(409, 'deletion_schema_approval_required');
  const token = crypto.randomUUID();
  const detail: Detail = { accountId: target.accountId, ...(target.formId ? { formId: target.formId } : {}), token, leaseUntil: Date.now() + 300_000 };
  // Serializes different targets for the same friend as well as a double click.
  await db.prepare(`INSERT OR IGNORE INTO operation_audit (id,target_kind,target_id,action,actor_id,friend_id,detail_json,created_at)
    SELECT ?, 'customer_deletion', ?, 'deleting', ?, ?, ?, ? WHERE NOT EXISTS (
      SELECT 1 FROM operation_audit WHERE target_kind = 'customer_deletion' AND action = 'deleting'
      AND friend_id = ? AND json_extract(detail_json,'$.leaseUntil') > ?)`)
    .bind(id, target.id, actorId, target.friendId, JSON.stringify(detail), new Date().toISOString(), target.friendId, Date.now()).run();
  const owned = await db.prepare(`UPDATE operation_audit SET action = 'deleting', actor_id = ?, detail_json = ?
    WHERE id = ? AND action <> 'deleted'
      AND (json_extract(detail_json,'$.token') = ? OR action = 'retryable' OR json_extract(detail_json,'$.leaseUntil') <= ?)
      AND NOT EXISTS (SELECT 1 FROM operation_audit other WHERE other.id <> ? AND other.target_kind = 'customer_deletion'
        AND other.friend_id = ? AND other.action = 'deleting' AND json_extract(other.detail_json,'$.leaseUntil') > ?)`)
    .bind(actorId, JSON.stringify(detail), id, token, Date.now(), id, target.friendId, Date.now()).run();
  if (owned.meta.changes !== 1) {
    if ((await deletionJournal(db, target.kind, target.id))?.action === 'deleted') return { deleted: true, replayed: true };
    throw new DeletionFailure(409, 'deletion_in_progress');
  }
  try {
    const snapshots: Snapshot[] = [];
    // Batched reads keep the number of database round trips bounded.
    const entries = Object.entries(conditions);
    const results = await db.batch(entries.map(([table, condition]) => db.prepare(`SELECT rowid AS _delete_rowid, * FROM ${q(table)} WHERE ${condition}`).bind(...(condition.includes('?3') ? params : [params[0]]))));
    for (let i = 0; i < entries.length; i++) {
      const [table, condition] = entries[i];
      const rows = results[i].results as Snapshot['rows'];
      const columns = RETENTION_R2_KEY_COLUMNS.filter(entry => entry.table === table).map(entry => entry.column);
      snapshots.push({ table, condition, rows, keys: rows.flatMap(row => columns.flatMap(col => typeof row[col] === 'string' && row[col] ? [row[col] as string] : [])) });
    }
    const keys = [...new Set(snapshots.flatMap(snapshot => snapshot.keys))];
    if (keys.length && !env.IMAGES) throw new DeletionFailure(503, 'deletion_retry_required');
    // R2 deletion is idempotent. Never remove database keys until every delete succeeds.
    for (let offset = 0; offset < keys.length; offset += 100) await env.IMAGES!.delete(keys.slice(offset, offset + 100));
    const guard = (condition: string, values: unknown[]) => {
      let cursor = 0;
      const bindings: unknown[] = [];
      const normalized = condition.replace(/\?(\d+)?/g, (_, n: string | undefined) => {
        bindings.push(values[n ? Number(n) - 1 : cursor++]); return '?';
      });
      return db.prepare(`UPDATE operation_audit SET target_kind = CASE WHEN (${normalized}) THEN 'customer_deletion' ELSE NULL END WHERE id = ?`).bind(...bindings, id);
    };
    const statements = [db.prepare('PRAGMA defer_foreign_keys = ON'), guard("action = 'deleting' AND json_extract(detail_json, '$.token') = ?", [token])];
    // A retained record inserted during the R2 call must never be cascaded away.
    for (const check of protectedChecks) statements.push(guard(`NOT EXISTS (SELECT 1 FROM ${q(check.table)} WHERE ${check.condition})`, check.condition.includes('?3') ? params : [params[0]]));
    // A file/child added while awaiting R2 must remain reachable for a retry.
    for (const snapshot of snapshots) {
      const rowids = JSON.stringify(snapshot.rows.map(row => row._delete_rowid));
      const bound = snapshot.condition.includes('?3') ? params : [params[0]];
      const condition = snapshot.condition.replace(/\?([123])/g, (_, n: string) => `?${Number(n)}`);
      const slot = bound.length + 1;
      statements.push(guard(`(SELECT COUNT(*) FROM ${q(snapshot.table)} WHERE ${condition}) = json_array_length(?${slot})
        AND NOT EXISTS (SELECT 1 FROM ${q(snapshot.table)} WHERE ${condition} AND rowid NOT IN (SELECT value FROM json_each(?${slot})))`, [...bound, rowids]));
      // Fence reassignment of a response/friend as well as key replacement.
      // Snapshot values are transient bindings, never persisted in the journal.
      const first = snapshot.rows[0];
      const candidates = ['id', 'line_user_id', 'line_account_id', 'form_id', 'submission_id',
        ...(graph[snapshot.table]?.friendColumns ?? []),
        ...(graph[snapshot.table]?.references.flatMap(ref => ref.columns.map(col => col.column)) ?? []),
        ...RETENTION_R2_KEY_COLUMNS.filter(entry => entry.table === snapshot.table).map(entry => entry.column)];
      const columns = [...new Set(candidates)].filter(col => first && Object.hasOwn(first, col));
      if (columns.length) statements.push(guard(`NOT EXISTS (SELECT 1 FROM json_each(?) expected LEFT JOIN ${q(snapshot.table)} actual
        ON actual.rowid = json_extract(expected.value,'$.rowid') WHERE ${columns.map(col => `actual.${q(col)} IS NOT json_extract(expected.value,'$.values.${col}')`).join(' OR ')})`,
        [JSON.stringify(snapshot.rows.map(row => ({ rowid: row._delete_rowid, values: Object.fromEntries(columns.map(col => [col, row[col] ?? null])) })))]));
    }
    const byTable = new Map(snapshots.map(snapshot => [snapshot.table, snapshot]));
    if (target.kind === 'friend_data') {
      const affiliateCondition = conditions.affiliates;
      // No new schema outside the approved retained tables: both existing
      // references are already nullable. Remove referrer names/codes as well.
      statements.push(db.prepare(`UPDATE conversion_events SET affiliate_id = NULL, affiliate_code = NULL
        WHERE affiliate_id IN (SELECT id FROM affiliates WHERE ${affiliateCondition})`).bind(...(affiliateCondition.includes('?3') ? params : [params[0]])));
      const removed = `SELECT id FROM affiliates WHERE ${affiliateCondition}`;
      statements.push(db.prepare(`UPDATE affiliate_attribution_decisions
        SET affiliate_id = CASE WHEN affiliate_id IN (${removed}) THEN NULL ELSE affiliate_id END,
            ref_code = CASE WHEN affiliate_id IN (${removed}) THEN NULL ELSE ref_code END,
            candidates_json = (SELECT json_group_array(json(CASE
              WHEN json_extract(candidate.value, '$.affiliateId') IN (${removed})
              THEN json_set(candidate.value, '$.affiliateName', '削除済みのお客さま', '$.refCode', '')
              ELSE candidate.value END)) FROM json_each(candidates_json) candidate)
        WHERE affiliate_id IN (${removed}) OR EXISTS (SELECT 1 FROM json_each(candidates_json) candidate
          WHERE json_extract(candidate.value, '$.affiliateId') IN (${removed}))`)
        .bind(...(affiliateCondition.includes('?3') ? params : [params[0]])));
    }
    for (const table of childFirst(Object.keys(conditions))) {
      const snapshot = byTable.get(table)!;
      if (snapshot.rows.length) statements.push(db.prepare(`DELETE FROM ${q(table)} WHERE rowid IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(snapshot.rows.map(row => row._delete_rowid))));
    }
    const formIds = [...new Set(byTable.get('form_submissions')!.rows.map(row => row.form_id as string))];
    for (const formId of formIds) statements.push(db.prepare(`UPDATE forms SET submit_count = (SELECT COUNT(*) FROM form_submissions WHERE form_id = ? AND is_test = 0) WHERE id = ?`).bind(formId, formId));
    const completed: Detail = { ...detail, completedAt: new Date().toISOString(), rows: snapshots.reduce((sum, s) => sum + s.rows.length, 0) };
    statements.push(db.prepare("UPDATE operation_audit SET action = 'deleted', detail_json = ? WHERE id = ? AND json_extract(detail_json,'$.token') = ?").bind(JSON.stringify(completed), id, token));
    const account = target.accountId ? await db.prepare('SELECT tenant_id FROM line_accounts WHERE id = ?').bind(target.accountId).first<{ tenant_id: string | null }>() : null;
    statements.push(auditEventStatement(db, { id, sourceKind: 'operation_audit', sourceId: id,
      tenantId: account?.tenant_id, lineAccountId: target.accountId, category: 'business', actorPrincipalId: actorId,
      action: `customer.${target.kind}.deleted`, targetKind: target.kind, targetId: target.id, result: 'success',
      after: { deletedRows: completed.rows }, createdAt: completed.completedAt, retentionClass: 'general' }));
    await db.batch(statements);
    return { deleted: true, replayed: false };
  } catch {
    // A fixed code only: customer text, filenames, keys and provider errors are never logged.
    await db.prepare("UPDATE operation_audit SET action = 'retryable' WHERE id = ? AND action = 'deleting' AND json_extract(detail_json,'$.token') = ?").bind(id, token).run().catch(() => {});
    throw new DeletionFailure(503, 'deletion_retry_required');
  }
}
