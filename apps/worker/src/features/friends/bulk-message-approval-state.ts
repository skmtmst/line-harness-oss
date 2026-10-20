import type { Broadcast } from '@line-crm/db';
import { getBroadcastApprovalThreshold } from '../broadcasts/broadcast-approval/index.js';
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
