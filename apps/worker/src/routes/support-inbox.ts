import { Hono } from 'hono';
import PostalMime from 'postal-mime';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { computeUnansweredInbox, countUnanswered } from '../services/unanswered-inbox.js';
import { sendSupportEmailReply, storeSupportEmail } from '../services/support-email.js';
import { verifySupportRelay } from '../services/support-relay.js';
import { markInboxConversationRead } from '@line-crm/db';

export const supportInbox = new Hono<Env>();

export function extractContactFormReceipt(text: string | undefined): {
  customerEmail?: string;
  customerName?: string;
  inquiry?: string;
} {
  if (!text) return {};
  const normalized = text.replace(/\r\n?/g, '\n');
  const email = normalized.match(/^メールアドレス[：:]\s*([^\s]+@[^\s]+)$/m)?.[1]?.trim();
  const rawName = normalized.match(/^お名前[：:]\s*(.+)$/m)?.[1]?.trim();
  const customerName = rawName
    ?.replace(/\s*\([^\n]*\)\s*様?\s*$/, '')
    .replace(/\s+様\s*$/, '')
    .trim();

  const label = normalized.match(/(?:^|\n)お問い合わせ内容[：:]\s*\n?/);
  let inquiry: string | undefined;
  if (label?.index != null) {
    inquiry = normalized.slice(label.index + label[0].length).trim();
    const footer = inquiry.search(
      /\n(?:━{4,}|本メールは自動配信|本メールにお心当たり|然-NEN-\s*$|https?:\/\/nen-petfood\.com\/contact)/m,
    );
    if (footer >= 0) inquiry = inquiry.slice(0, footer).trim();
  }
  return {
    customerEmail: email,
    customerName: customerName || undefined,
    inquiry: inquiry || undefined,
  };
}

supportInbox.post('/webhooks/xserver/support-email', async (c) => {
  const secret = c.env.XSERVER_RELAY_SECRET;
  if (!secret) return c.json({ success: false, error: 'Relay not configured' }, 503);
  const rawBody = await c.req.text();
  const verified = await verifySupportRelay(
    secret,
    c.req.header('x-nen-timestamp'),
    c.req.header('x-nen-signature'),
    rawBody,
  );
  if (!verified) return c.json({ success: false, error: 'Invalid signature' }, 401);

  let payload: { raw?: string };
  try {
    payload = JSON.parse(rawBody) as { raw?: string };
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }
  if (!payload.raw || payload.raw.length > 14 * 1024 * 1024) {
    return c.json({ success: false, error: 'Invalid email payload' }, 400);
  }
  const binary = atob(payload.raw);
  const raw = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const parsed = await PostalMime.parse(raw, {
    attachmentEncoding: 'arraybuffer', maxNestingDepth: 20, maxHeadersSize: 256 * 1024,
  });
  const replyAddress = Array.isArray(parsed.replyTo) ? parsed.replyTo[0] : parsed.replyTo;
  const recipients = Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [];
  const contactEmail = (c.env.CONTACT_EMAIL || 'contact-shed@nen-petfood.com').toLowerCase();
  const formCustomer = recipients.find(
    (recipient) => recipient.address && recipient.address.toLowerCase() !== contactEmail,
  );
  // EC-CUBE sends the customer receipt to the form submitter and BCCs the
  // private support mailbox. In that copy Reply-To is the support mailbox,
  // while To is the actual customer who must own the support thread.
  // The support mailbox receives the customer receipt as BCC. Its visible To
  // address is therefore the form submitter, while ordinary inbound mail has
  // the private contact mailbox in To.
  const isContactFormReceipt = Boolean(formCustomer);
  const formData = isContactFormReceipt ? extractContactFormReceipt(parsed.text) : {};
  const sender = isContactFormReceipt
    ? formCustomer
    : replyAddress?.address
      ? replyAddress
      : parsed.from;
  if (!sender?.address) return c.json({ success: false, error: 'Missing sender' }, 400);
  const result = await storeSupportEmail(c.env, {
    customerEmail: formData.customerEmail || sender.address,
    customerName: isContactFormReceipt
      ? formData.customerName || sender.name
      : parsed.from?.name,
    subject: parsed.subject,
    bodyText: formData.inquiry || parsed.text,
    bodyHtml: formData.inquiry ? undefined : parsed.html,
    messageId: parsed.messageId,
    inReplyTo: parsed.inReplyTo,
    references: parsed.references,
  });
  return c.json({ success: true, duplicate: result.duplicate });
});

type EmailThreadRow = {
  id: string;
  customer_email: string;
  customer_name: string | null;
  subject: string;
  status: 'unread' | 'in_progress' | 'resolved';
  last_message_at: string;
  last_incoming_at: string;
  last_outgoing_at: string | null;
  preview: string | null;
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
};

supportInbox.get('/api/support/summary', async (c) => {
  try {
    const [line, email] = await Promise.all([
      countUnanswered(c.env.DB),
      c.env.DB.prepare(
        `SELECT
           SUM(CASE WHEN status != 'resolved' THEN 1 ELSE 0 END) AS open_count,
           SUM(CASE WHEN status = 'unread' THEN 1 ELSE 0 END) AS unread_count,
           MIN(CASE WHEN status != 'resolved' THEN last_incoming_at END) AS oldest_at
         FROM support_email_threads`,
      ).first<{ open_count: number | null; unread_count: number | null; oldest_at: string | null }>(),
    ]);
    const emailOpen = email?.open_count ?? 0;
    const oldestCandidates = [
      line.oldestWaitMinutes == null ? null : line.oldestWaitMinutes,
      email?.oldest_at
        ? Math.max(0, Math.floor((Date.now() - new Date(email.oldest_at).getTime()) / 60_000))
        : null,
    ].filter((value): value is number => value != null);
    return c.json({
      success: true,
      data: {
        total: line.total + emailOpen,
        line: line.total,
        email: emailOpen,
        emailUnread: email?.unread_count ?? 0,
        oldestWaitMinutes: oldestCandidates.length ? Math.max(...oldestCandidates) : null,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'support_summary_failed', error: String(error) }));
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

supportInbox.get('/api/support/inbox', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const channel = c.req.query('channel') || 'all';
    const status = c.req.query('status') || 'open';
    const query = (c.req.query('q') || '').trim();
    const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query('limit') || '100', 10) || 100));
    const items: Array<Record<string, unknown>> = [];

    if (channel !== 'line') {
      const statusSql = status === 'all'
        ? '1=1'
        : status === 'resolved'
          ? `t.status = 'resolved'`
          : status === 'unread' || status === 'in_progress'
            ? 't.status = ?'
            : `t.status != 'resolved'`;
      // SQL 上は read join の staff_id が最初の placeholder。
      const bindings: Array<string | number> = [c.get('staff').id];
      if (status === 'unread' || status === 'in_progress') bindings.push(status);
      let searchSql = '';
      if (query) {
        searchSql = 'AND (t.customer_email LIKE ? OR t.customer_name LIKE ? OR t.subject LIKE ?)';
        const like = `%${query}%`;
        bindings.push(like, like, like);
      }
      bindings.push(limit);
      const emailRows = await c.env.DB.prepare(
        `SELECT t.id, t.customer_email, t.customer_name, t.subject, t.status,
                t.assigned_staff_id,
                (SELECT name FROM staff_members sm WHERE sm.id = t.assigned_staff_id) AS assigned_staff_name,
                t.last_message_at, t.last_incoming_at, t.last_outgoing_at,
                CASE
                  WHEN sr.last_read_at IS NULL OR t.last_incoming_at > sr.last_read_at
                  THEN 1 ELSE 0
                END AS is_unread_for_staff,
                (SELECT body_text FROM support_email_messages m
                 WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS preview
         FROM support_email_threads t
         LEFT JOIN inbox_staff_reads sr
           ON sr.channel = 'email'
          AND sr.conversation_id = t.id
          AND sr.staff_id = ?
         WHERE ${statusSql} ${searchSql}
         ORDER BY CASE t.status WHEN 'unread' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
                  t.last_message_at DESC
         LIMIT ?`,
      ).bind(...bindings).all<EmailThreadRow>();
      for (const row of emailRows.results) {
        items.push({
          id: `email:${row.id}`,
          threadId: row.id,
          channel: 'email',
          customerName: row.customer_name || row.customer_email,
          customerIdentifier: row.customer_email,
          subject: row.subject,
          preview: row.preview || '(本文なし)',
          status: row.status,
          assignedStaffId: row.assigned_staff_id,
          assignedStaffName: row.assigned_staff_name,
          lastMessageAt: row.last_message_at,
          lastIncomingAt: row.last_incoming_at,
          lastOutgoingAt: row.last_outgoing_at,
          isUnread: Boolean((row as EmailThreadRow & { is_unread_for_staff: number }).is_unread_for_staff),
        });
      }
    }

    if (channel !== 'email' && status !== 'resolved' && status !== 'in_progress') {
      const line = await computeUnansweredInbox(c.env.DB, {
        q: query || undefined,
        page: 1,
        pageSize: limit,
      });
      for (const row of line.rows) {
        items.push({
          id: `line:${row.friendId}`,
          threadId: row.friendId,
          channel: 'line',
          customerName: row.displayName || '(名前なし)',
          customerIdentifier: row.accountName,
          subject: 'LINEお問い合わせ',
          preview: row.lastIncomingContent,
          status: 'unread',
          lastMessageAt: row.lastIncomingAt,
          lastIncomingAt: row.lastIncomingAt,
          lastOutgoingAt: row.lastManualAt,
          pictureUrl: row.pictureUrl,
          accountName: row.accountName,
        });
      }
    }

    const statusPriority = { unread: 0, in_progress: 1, resolved: 2 } as const;
    items.sort((a, b) => {
      const priority = statusPriority[a.status as keyof typeof statusPriority]
        - statusPriority[b.status as keyof typeof statusPriority];
      if (priority !== 0) return priority;
      // 対応漏れを防ぐため、同じ状態では待ち時間が長い顧客を先頭にする。
      return String(a.lastIncomingAt).localeCompare(String(b.lastIncomingAt));
    });
    return c.json({ success: true, data: { items: items.slice(0, limit) } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'support_inbox_failed', error: String(error) }));
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

supportInbox.get('/api/support/email/threads/:id', async (c) => {
  const id = c.req.param('id');
  const thread = await c.env.DB.prepare(
    `SELECT id, customer_email, customer_name, subject, status, assigned_staff_id, notes,
            last_message_at, last_incoming_at, last_outgoing_at, resolved_at
     FROM support_email_threads WHERE id = ?`,
  ).bind(id).first();
  if (!thread) return c.json({ success: false, error: 'Thread not found' }, 404);
  const messages = await c.env.DB.prepare(
    `SELECT id, direction, sender_email, sender_name, recipient_email, subject,
            body_text, sent_by_staff_id,
            (SELECT name FROM staff_members sm WHERE sm.id = support_email_messages.sent_by_staff_id) AS sent_by_staff_name,
            created_at
     FROM support_email_messages WHERE thread_id = ? ORDER BY created_at ASC`,
  ).bind(id).all();
  return c.json({ success: true, data: { thread, messages: messages.results } });
});

supportInbox.post(
  '/api/support/email/threads/:id/read',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const id = c.req.param('id');
    const thread = await c.env.DB
      .prepare(`SELECT last_incoming_at FROM support_email_threads WHERE id = ?`)
      .bind(id)
      .first<{ last_incoming_at: string | null }>();
    if (!thread) return c.json({ success: false, error: 'Thread not found' }, 404);
    if (thread.last_incoming_at) {
      await markInboxConversationRead(c.env.DB, {
        staffId: c.get('staff').id,
        channel: 'email',
        conversationId: id,
        lastReadAt: thread.last_incoming_at,
      });
    }
    return c.json({ success: true, data: { isUnread: false } });
  },
);

supportInbox.post(
  '/api/support/email/read-all',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const now = new Date().toISOString();
    await c.env.DB
      .prepare(
        `INSERT INTO inbox_staff_reads
           (staff_id, channel, conversation_id, last_read_at, updated_at)
         SELECT ?, 'email', id, last_incoming_at, ?
         FROM support_email_threads
         WHERE last_incoming_at IS NOT NULL
         ON CONFLICT(staff_id, channel, conversation_id) DO UPDATE SET
           last_read_at = excluded.last_read_at,
           updated_at = excluded.updated_at`,
      )
      .bind(c.get('staff').id, now)
      .run();
    return c.json({ success: true, data: { marked: true } });
  },
);

supportInbox.patch('/api/support/email/threads/:id/status', requireRole('owner', 'admin', 'staff'), async (c) => {
  const id = c.req.param('id');
  const body: { status?: string } = await c.req.json<{ status?: string }>().catch(() => ({}));
  if (!body.status || !['unread', 'in_progress', 'resolved'].includes(body.status)) {
    return c.json({ success: false, error: 'Invalid status' }, 400);
  }
  const staff = c.get('staff');
  const now = new Date().toISOString();
  // 担当は「まだ誰も付いていないとき」だけ、操作した人を入れる。
  //
  // 以前は毎回 staff.id で上書きしていた。担当を選べるようにすると、
  // 対応を変えるたびに担当が勝手に別の人へ移ってしまう。
  const result = await c.env.DB.prepare(
    `UPDATE support_email_threads
     SET status = ?,
         assigned_staff_id = COALESCE(assigned_staff_id, ?),
         resolved_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).bind(
    body.status,
    staff.id,
    body.status === 'resolved' ? now : null,
    now,
    id,
  ).run();
  if (!result.meta.changes) return c.json({ success: false, error: 'Thread not found' }, 404);
  return c.json({ success: true });
});

/**
 * 担当を付け替える。LINE のトーク（`/api/chats/:id/operator`）と揃える。
 *
 * `null` で未割り当てに戻せる。列（assigned_staff_id）は前からあるが、
 * 画面から選ぶ口が無く、状態を変えた人が自動で入るだけだった。
 */
supportInbox.patch(
  '/api/support/email/threads/:id/assignee',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const id = c.req.param('id');
    const body: { staffId?: string | null } = await c.req
      .json<{ staffId?: string | null }>()
      .catch(() => ({}));
    const staffId = body.staffId ? String(body.staffId) : null;

    // 知らないIDを入れると、誰も見ていない担当になる。実在を確かめる。
    if (staffId) {
      const exists = await c.env.DB.prepare(`SELECT 1 FROM users WHERE id = ?`)
        .bind(staffId)
        .first();
      if (!exists) return c.json({ success: false, error: '担当者が見つかりません' }, 400);
    }

    const result = await c.env.DB.prepare(
      `UPDATE support_email_threads SET assigned_staff_id = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(staffId, new Date().toISOString(), id)
      .run();
    if (!result.meta.changes) return c.json({ success: false, error: 'Thread not found' }, 404);
    return c.json({ success: true });
  },
);

/**
 * メモ。LINE のトークにはあってメールに無かった（114 で列を足した）。
 *
 * 同じ受信箱の中で、相手がメールというだけで残せないのは扱いが揃っていない。
 */
supportInbox.patch(
  '/api/support/email/threads/:id/notes',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const id = c.req.param('id');
    const body: { notes?: string } = await c.req.json<{ notes?: string }>().catch(() => ({}));
    const notes = (body.notes ?? '').slice(0, 10_000);
    const result = await c.env.DB.prepare(
      `UPDATE support_email_threads SET notes = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(notes || null, new Date().toISOString(), id)
      .run();
    if (!result.meta.changes) return c.json({ success: false, error: 'Thread not found' }, 404);
    return c.json({ success: true });
  },
);

supportInbox.post('/api/support/email/threads/:id/reply', requireRole('owner', 'admin', 'staff'), async (c) => {
  const id = c.req.param('id');
  const body: { body?: string } = await c.req.json<{ body?: string }>().catch(() => ({}));
  const content = body.body?.trim() || '';
  if (!content || content.length > 50_000) {
    return c.json({ success: false, error: '本文は1〜50,000文字で入力してください' }, 400);
  }
  try {
    const result = await sendSupportEmailReply(c.env, id, content, c.get('staff').id);
    return c.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof Error && error.message === 'THREAD_NOT_FOUND') {
      return c.json({ success: false, error: 'Thread not found' }, 404);
    }
    if (error instanceof Error && error.message === 'INVALID_CUSTOMER_RECIPIENT') {
      return c.json({ success: false, error: '顧客のメールアドレスを確認できないため送信を停止しました' }, 409);
    }
    console.error(JSON.stringify({ event: 'support_email_reply_failed', threadId: id, error: String(error) }));
    return c.json({ success: false, error: 'メール送信に失敗しました' }, 502);
  }
});
