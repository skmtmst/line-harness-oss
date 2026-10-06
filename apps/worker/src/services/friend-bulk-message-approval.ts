import type { Broadcast } from '@line-crm/db';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { canApproveBroadcast, countActiveOperators, getBroadcastApprovalThreshold } from './broadcast-approval.js';
import { FriendBulkRunError, requireFriendBulkRunAccess } from './friend-bulk-runs.js';

export interface BulkMessageApproval {
  status: 'pending' | 'approved' | 'confirmed' | 'expired';
  recipient_count: number;
  threshold: number;
  requested_by: string;
  decided_by: string | null;
}

export async function bulkMessageThreshold(db: D1Database, accountIds: string[]): Promise<number> {
  return getBroadcastApprovalThreshold(db, {
    line_account_id: accountIds[0] ?? null,
    target_type: 'multi-account-dedup',
    account_ids: JSON.stringify(accountIds),
  } as unknown as Broadcast);
}

export async function getBulkMessageApproval(db: D1Database, runId: string) {
  const row = await db.prepare('SELECT * FROM friend_bulk_message_approvals WHERE run_id = ?')
    .bind(runId).first<BulkMessageApproval>();
  return row ? {
    status: row.status,
    recipientCount: row.recipient_count,
    threshold: row.threshold,
    requestedBy: row.requested_by,
    decidedBy: row.decided_by,
  } : null;
}

export async function approveBulkMessage(
  db: D1Database,
  staff: AuthenticatedStaff,
  runId: string,
  confirmedRecipientCount?: unknown,
) {
  await requireFriendBulkRunAccess(db, staff, runId);
  if (!canApproveBroadcast(staff)) throw new FriendBulkRunError('approval_forbidden', '承認する権限がありません', 403);
  const approval = await getBulkMessageApproval(db, runId);
  if (!approval) throw new FriendBulkRunError('approval_not_required', '承認待ちの一括送信がありません', 409);
  if (approval.status === 'expired') throw new FriendBulkRunError('approval_expired', '承認の期限が切れています', 409);
  if (approval.status !== 'pending') return approval;
  const run = await db.prepare('SELECT scheduled_at FROM friend_bulk_runs WHERE id = ?')
    .bind(runId).first<{ scheduled_at: string | null }>();
  const now = new Date().toISOString();
  if (run?.scheduled_at && run.scheduled_at <= now) {
    await db.batch([
      db.prepare("UPDATE friend_bulk_message_approvals SET status = 'expired', decided_by = ?, decided_at = ? WHERE run_id = ? AND status = 'pending'")
        .bind(staff.id, now, runId),
      db.prepare("INSERT INTO friend_bulk_message_approval_events (id, run_id, actor_staff_id, action, created_at) VALUES (?, ?, ?, 'expired', ?)")
        .bind(crypto.randomUUID(), runId, staff.id, now),
    ]);
    throw new FriendBulkRunError('approval_expired', '予約時刻を過ぎたため、対象と内容を確認して新しく作成してください', 409);
  }
  const singleOperator = await countActiveOperators(db) <= 1;
  if (singleOperator) {
    const confirmed = typeof confirmedRecipientCount === 'string' && confirmedRecipientCount.trim() !== ''
      ? Number(confirmedRecipientCount) : confirmedRecipientCount;
    if (!Number.isInteger(confirmed) || confirmed !== approval.recipientCount) {
      throw new FriendBulkRunError('COUNT_MISMATCH', `送る相手は${approval.recipientCount}人です。人数を入れて一致させてください`, 409);
    }
  } else if (staff.id === approval.requestedBy) {
    throw new FriendBulkRunError('self_approval_forbidden', '送信を依頼した人とは別の人が承認してください', 409);
  }
  const status = singleOperator ? 'confirmed' : 'approved';
  await db.batch([
    db.prepare(`UPDATE friend_bulk_message_approvals
      SET status = ?, decided_by = ?, decided_at = ?, confirmed_count = ?
      WHERE run_id = ? AND status = 'pending'`)
      .bind(status, staff.id, now, singleOperator ? approval.recipientCount : null, runId),
    db.prepare(`INSERT INTO friend_bulk_message_approval_events (id, run_id, actor_staff_id, action, created_at)
      SELECT ?, run_id, ?, ?, ? FROM friend_bulk_message_approvals
      WHERE run_id = ? AND decided_by = ? AND decided_at = ? AND status = ?`)
      .bind(crypto.randomUUID(), staff.id, status, now, runId, staff.id, now, status),
    db.prepare(`UPDATE friend_bulk_runs SET status = 'queued', updated_at = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM friend_bulk_message_approvals a
        WHERE a.run_id = friend_bulk_runs.id AND a.status IN ('approved', 'confirmed'))`)
      .bind(now, runId),
  ]);
  return getBulkMessageApproval(db, runId);
}
