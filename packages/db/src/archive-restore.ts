import { jstNow } from './utils.js';
import type { SupportMarkScope } from './support-marks.js';

export class ArchiveRestoreError extends Error {
  constructor(public readonly code: 'not_found' | 'version_conflict') { super(code); }
}

type RestoreInput = { id: string; lineAccountId: string; expectedVersion: number; actorId?: string | null };

/** 保管時の置換は巻き戻さず、定義だけを同じIDで戻す。監査と版は一度だけ進める。 */
async function restore(
  db: D1Database,
  input: RestoreInput,
  kind: 'tag' | 'support_mark',
  tenantId?: string,
): Promise<{ restored: true; version: number }> {
  const table = kind === 'tag' ? 'tags' : 'support_marks';
  const scope = kind === 'tag' ? 'line_account_id = ?'
    : 'EXISTS (SELECT 1 FROM support_mark_scopes s WHERE s.mark_id = support_marks.id AND s.line_account_id = ? AND s.tenant_id = ?)';
  const scopeValues = kind === 'tag' ? [input.lineAccountId] : [input.lineAccountId, tenantId!];
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND ${scope}`)
    .bind(input.id, ...scopeValues).first<{ version: number; status?: string; archived_at?: string | null }>();
  if (!row) throw new ArchiveRestoreError('not_found');
  const archived = kind === 'tag' ? row.status === 'archived' : row.archived_at != null;
  if (!archived) return { restored: true, version: row.version };
  if (row.version !== input.expectedVersion) throw new ArchiveRestoreError('version_conflict');
  const now = jstNow();
  const archivedCondition = kind === 'tag' ? "status = 'archived'" : 'archived_at IS NOT NULL';
  const changes = kind === 'tag' ? "status = 'active'" : 'archived_at = NULL';
  const result = await db.batch([
    db.prepare(`UPDATE ${table} SET ${changes}, version = version + 1, updated_at = ?, updated_by = ?
      WHERE id = ? AND ${scope} AND version = ? AND ${archivedCondition}`)
      .bind(now, input.actorId ?? null, input.id, ...scopeValues, input.expectedVersion),
    db.prepare(`INSERT INTO operation_audit (id, target_kind, target_id, action, actor_id, detail_json, created_at)
      SELECT ?, ?, ?, 'changed', ?, ?, ? WHERE changes() = 1`)
      .bind(crypto.randomUUID(), kind, input.id, input.actorId ?? null, JSON.stringify({ restored: true }), now),
  ]);
  if ((result[0].meta?.changes ?? 0) !== 1) throw new ArchiveRestoreError('version_conflict');
  return { restored: true, version: row.version + 1 };
}

export function restoreTag(db: D1Database, input: RestoreInput) {
  return restore(db, input, 'tag');
}

export function restoreSupportMark(db: D1Database, scope: SupportMarkScope, input: Omit<RestoreInput, 'lineAccountId'>) {
  return restore(db, { ...input, lineAccountId: scope.lineAccountId }, 'support_mark', scope.tenantId);
}
