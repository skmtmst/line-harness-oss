import { type UidMigrationRunRow } from '@line-crm/db';

export function runJson(row: UidMigrationRunRow) {
  return {
    id: row.id,
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    purpose: row.purpose,
    sourceKind: row.source_kind,
    sourceFilename: row.source_filename,
    status: row.status,
    dryRunRevision: row.dry_run_revision,
    counts: {
      total: row.total_count,
      auto: row.auto_count,
      review: row.review_count,
      unmatched: row.unmatched_count,
      conflict: row.conflict_count,
      applied: row.applied_count,
      failed: row.failed_count,
    },
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    executedAt: row.executed_at,
    completedAt: row.completed_at,
    rolledBackAt: row.rolled_back_at,
    failureReason: row.failure_reason,
    /*
      FRIEND-34: 一部成功・一部失敗（status='failed' かつ applied>0）でも
      反映済みの行だけは切り戻せる。画面が status 文字列を推測しなくて
      済むよう、復旧可否をここで1つに決める。
    */
    rollbackable: row.status === 'completed' || (row.status === 'failed' && row.applied_count > 0),
  };
}
