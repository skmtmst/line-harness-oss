export type { HqSupportKind, HqSupportStatus, HqSupportRequest } from './hq-support-types.js';
export { HQ_SUPPORT_KINDS, HQ_SUPPORT_STATUSES } from './hq-support-types.js';
import { HQ_SUPPORT_KINDS, HQ_SUPPORT_STATUSES } from './hq-support-types.js';
import type { HqSupportKind, HqSupportStatus, HqSupportRequest } from './hq-support-types.js';
import { jstNow, toJstString } from './utils.js';
import { nextSupportTicketNo } from './ops-support.js';

export async function listHqSupportRequests(
  db: D1Database,
  tenantId: string,
  limit = 50,
): Promise<HqSupportRequest[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM hq_support_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(tenantId, Math.min(Math.max(limit, 1), 200))
    .all<HqSupportRequest>();
  return results ?? [];
}

export async function getHqSupportRequest(
  db: D1Database,
  id: string,
  tenantId: string,
): Promise<HqSupportRequest | null> {
  return db
    .prepare('SELECT * FROM hq_support_requests WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first<HqSupportRequest>();
}

export async function createHqSupportRequest(
  db: D1Database,
  input: {
    tenantId: string;
    staffId: string | null;
    staffName: string;
    staffEmail: string | null;
    kind: HqSupportKind;
    subject: string;
    body: string;
    lineAccountId: string | null;
    attachmentKeys: string[];
  },
): Promise<HqSupportRequest> {
  const id = crypto.randomUUID();
  const now = jstNow();
  // 運営側のチケット番号（★37-6）。統括の画面にも同じ番号を出す。
  const ticketNo = await nextSupportTicketNo(db);
  await db
    .prepare(
      `INSERT INTO hq_support_requests
         (id, tenant_id, staff_id, staff_name, staff_email, kind, subject, body, line_account_id, attachment_keys, status,
          ticket_no, stage, priority, channel, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, 'new', 'medium', 'admin', ?, ?, ?)`,
    )
    .bind(
      id,
      input.tenantId,
      input.staffId,
      input.staffName,
      input.staffEmail,
      input.kind,
      input.subject,
      input.body,
      input.lineAccountId,
      JSON.stringify(input.attachmentKeys),
      ticketNo,
      now,
      now,
      now,
    )
    .run();
  return (await getHqSupportRequest(db, id, input.tenantId))!;
}

/**
 * M028：確定応答を失った再送の重複判定。
 *
 * 同じ統括・同じ送信者・同じ内容（種類・件名・本文・関係店舗）が
 * 直近 10 分にあれば、その行を返す。要求キー台帳は migration が要るため
 * 番号待ちで、番号不要の範囲で重複チケットを作らない。
 * 添付の違いまでは見ない（送り直しは同じ添付のため）。
 */
export const HQ_SUPPORT_DUPLICATE_WINDOW_MINUTES = 10;

export async function findRecentDuplicateHqSupportRequest(
  db: D1Database,
  input: {
    tenantId: string;
    staffId: string | null;
    staffName: string;
    kind: HqSupportKind;
    subject: string;
    body: string;
    lineAccountId: string | null;
  },
): Promise<HqSupportRequest | null> {
  const cutoff = toJstString(new Date(Date.now() - HQ_SUPPORT_DUPLICATE_WINDOW_MINUTES * 60 * 1000));
  return db
    .prepare(
      `SELECT * FROM hq_support_requests
       WHERE tenant_id = ?
         AND (staff_id = ? OR (staff_id IS NULL AND ? IS NULL))
         AND staff_name = ?
         AND kind = ?
         AND subject = ?
         AND body = ?
         AND (line_account_id = ? OR (line_account_id IS NULL AND ? IS NULL))
         AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(
      input.tenantId,
      input.staffId,
      input.staffId,
      input.staffName,
      input.kind,
      input.subject,
      input.body,
      input.lineAccountId,
      input.lineAccountId,
      cutoff,
    )
    .first<HqSupportRequest>();
}

export async function markHqSupportRequestNotified(db: D1Database, id: string): Promise<void> {
  await db
    .prepare('UPDATE hq_support_requests SET notified_at = ?, updated_at = ? WHERE id = ?')
    .bind(jstNow(), jstNow(), id)
    .run();
}
