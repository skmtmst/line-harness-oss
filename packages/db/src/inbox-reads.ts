import { jstNow } from './utils.js';

export type InboxChannel = 'line' | 'email';

/** 会話の読み取り位置を、他の担当者へ影響させずに前へ進める。 */
export async function markInboxConversationRead(
  db: D1Database,
  input: {
    staffId: string;
    channel: InboxChannel;
    conversationId: string;
    lastReadAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO inbox_staff_reads
         (staff_id, channel, conversation_id, last_read_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(staff_id, channel, conversation_id) DO UPDATE SET
         last_read_at = CASE
           WHEN excluded.last_read_at > inbox_staff_reads.last_read_at
           THEN excluded.last_read_at ELSE inbox_staff_reads.last_read_at END,
         updated_at = excluded.updated_at`,
    )
    .bind(input.staffId, input.channel, input.conversationId, input.lastReadAt, jstNow())
    .run();
}
