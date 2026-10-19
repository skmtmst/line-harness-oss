import { jstNow } from '../utils.js';
import { type ConversionDefinitionScope } from './types.js';
import { ConversionDefinitionError } from './reads.js';
import { currentDefinitionForMutation, requireExpectedDefinition, getConversionDefinitionDeleteImpact } from './revisions-mutation-guards.js';


export async function deleteUnusedConversionDefinition(
  db: D1Database,
  input: { id: string; scope: ConversionDefinitionScope; expectedVersion: number; reason?: string | null; staffId: string },
) {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  requireExpectedDefinition(current, input.expectedVersion, { allowDraft: true });
  const impact = await getConversionDefinitionDeleteImpact(db, input.id, input.scope);
  if (!impact?.canDelete) {
    throw new ConversionDefinitionError('definition_in_use', '成果または利用先があるため、削除せず停止してください', 409);
  }
  const now = jstNow();
  const operationId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`DELETE FROM conversion_points
      WHERE id = ? AND version = ?
        AND NOT EXISTS (SELECT 1 FROM conversion_events WHERE conversion_point_id = ?)
        AND NOT EXISTS (SELECT 1 FROM conversion_definition_usages WHERE conversion_point_id = ?)`)
      .bind(input.id, input.expectedVersion, input.id, input.id),
    db.prepare(`INSERT INTO conversion_definition_operations
      (id, conversion_point_id, action, replacement_id, affected_usages, reason, performed_by, created_at)
      SELECT ?, ?, 'delete', NULL, 0, ?, ?, ? WHERE changes() = 1`)
      .bind(operationId, input.id, input.reason ?? null, input.staffId, now),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return { id: input.id, deleted: true as const };
}

/**
 * N-268: 下書きを計測中へ。設定は変えずに status だけ進める。
 * 版は他操作と同じく +1 して、同時操作の競合を版の一致で検出する。
 */
export async function publishConversionDefinition(
  db: D1Database,
  input: { id: string; scope: ConversionDefinitionScope; expectedVersion: number; staffId: string },
) {
  const current = await currentDefinitionForMutation(db, input.id, input.scope);
  if (!current) throw new ConversionDefinitionError('not_found', '成果地点が見つかりません', 404);
  if (Number(current.version) !== input.expectedVersion) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  if (current.status !== 'draft') {
    throw new ConversionDefinitionError('not_draft', '下書きではありません', 409);
  }
  const now = jstNow();
  const result = await db
    .prepare(`UPDATE conversion_points SET status = 'active', updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'draft'`)
    .bind(now, input.id, input.expectedVersion)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ConversionDefinitionError('version_conflict', '成果地点が更新されています。読み直してください', 409);
  }
  return { id: input.id, status: 'active' as const, version: input.expectedVersion + 1 };
}
