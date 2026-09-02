import PostalMime, { type Address } from 'postal-mime';
import {
  completeOutboundSendStatement,
  hashOutboundPayload,
  reserveOutboundSend,
} from './outbound-idempotency.js';
import { inboxEventStatement } from './inbox-events.js';

const MAX_INBOUND_BYTES = 10 * 1024 * 1024;
const MAX_BODY_CHARS = 200_000;

type SupportEmailEnv = {
  DB: D1Database;
  EMAIL?: SendEmail;
  CONTACT_EMAIL?: string;
  SUPPORT_INBOUND_EMAIL?: string;
  XSERVER_MAIL_HOST?: string;
  XSERVER_MAIL_USER?: string;
  XSERVER_MAIL_PASSWORD?: string;
  XSERVER_RELAY_URL?: string;
  XSERVER_RELAY_SECRET?: string;
};

export type SupportInboundEmail = {
  customerEmail: string;
  customerName?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
};

type Mailbox = { name: string; address: string };

function asMailbox(address: Address | undefined): Mailbox | null {
  if (!address || !('address' in address) || !address.address) return null;
  return { name: address.name ?? '', address: address.address };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeEmailSubject(subject: string): string {
  let normalized = subject.trim();
  for (let i = 0; i < 8; i++) {
    const next = normalized.replace(/^\s*(?:re|fw|fwd|sv|返信|転送)\s*[:：]\s*/i, '').trim();
    if (next === normalized) break;
    normalized = next;
  }
  return normalized.toLocaleLowerCase('ja-JP') || '(件名なし)';
}

function lastReference(references: string | undefined): string | null {
  if (!references) return null;
  const ids = references.match(/<[^>]+>/g);
  return ids?.at(-1) ?? null;
}

async function findThreadId(
  db: D1Database,
  customerEmail: string,
  inReplyTo: string | undefined,
  references: string | undefined,
): Promise<string | null> {
  const replyId = inReplyTo || lastReference(references);
  if (replyId) {
    const byReply = await db.prepare(
      'SELECT thread_id FROM support_email_messages WHERE message_id = ? LIMIT 1',
    ).bind(replyId).first<{ thread_id: string }>();
    if (byReply?.thread_id) return byReply.thread_id;
  }

  // One customer email address represents one support account. Keep every
  // inquiry and reply in the same timeline even when the subject changes or
  // an earlier conversation was marked resolved.
  const byCustomer = await db.prepare(
    `SELECT id FROM support_email_threads
     WHERE customer_email = ?
     ORDER BY last_message_at DESC LIMIT 1`,
  ).bind(customerEmail).first<{ id: string }>();
  return byCustomer?.id ?? null;
}

export async function storeSupportEmail(
  env: SupportEmailEnv,
  input: SupportInboundEmail,
): Promise<{ threadId: string; duplicate: boolean }> {
  const contactEmail = (env.CONTACT_EMAIL || 'contact-shed@nen-petfood.com').toLowerCase();
  const customerEmail = input.customerEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw new Error('INVALID_CUSTOMER_EMAIL');
  }
  const customerName = input.customerName?.trim() || null;
  const subject = (input.subject || '(件名なし)').trim();
  const normalizedSubject = normalizeEmailSubject(subject);
  const messageId = input.messageId?.trim() || null;
  const inReplyTo = input.inReplyTo?.trim() || undefined;
  const references = input.references?.trim() || undefined;
  const body = (input.bodyText?.trim()
    || (input.bodyHtml ? stripHtml(input.bodyHtml) : '')
    || '(本文なし)').slice(0, MAX_BODY_CHARS);

  if (messageId) {
    const duplicate = await env.DB.prepare(
      'SELECT thread_id FROM support_email_messages WHERE message_id = ? LIMIT 1',
    ).bind(messageId).first<{ thread_id: string }>();
    if (duplicate?.thread_id) {
      const correctedAt = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE support_email_messages
           SET sender_email = ?, sender_name = ?, subject = ?, body_text = ?
           WHERE message_id = ?`,
        ).bind(customerEmail, customerName, subject, body, messageId),
        env.DB.prepare(
          `UPDATE support_email_threads
           SET customer_email = ?, customer_name = COALESCE(?, customer_name),
               subject = ?, normalized_subject = ?, updated_at = ?
           WHERE id = ?`,
        ).bind(
          customerEmail,
          customerName,
          subject,
          normalizedSubject,
          correctedAt,
          duplicate.thread_id,
        ),
      ]);
      return { threadId: duplicate.thread_id, duplicate: true };
    }
  }

  const now = new Date().toISOString();
  const existingThreadId = await findThreadId(
    env.DB,
    customerEmail,
    inReplyTo,
    references,
  );
  const threadId = existingThreadId ?? crypto.randomUUID();
  const messageRowId = crypto.randomUUID();

  const statements = existingThreadId
    ? [
        env.DB.prepare(
          `UPDATE support_email_threads
           SET customer_name = COALESCE(?, customer_name), subject = ?, normalized_subject = ?,
               status = 'unread',
               last_message_at = ?, last_incoming_at = ?, last_customer_message_at = ?,
               resolved_at = NULL, revision = revision + 1, updated_at = ?
           WHERE id = ?`,
        ).bind(customerName, subject, normalizedSubject, now, now, now, now, threadId),
      ]
    : [
        env.DB.prepare(
          `INSERT INTO support_email_threads
           (id, customer_email, customer_name, subject, normalized_subject, status,
            last_message_at, last_incoming_at, last_customer_message_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'unread', ?, ?, ?, ?, ?)`,
        ).bind(
          threadId,
          customerEmail,
          customerName,
          subject,
          normalizedSubject,
          now,
          now,
          now,
          now,
          now,
        ),
      ];

  statements.push(
    env.DB.prepare(
      `INSERT INTO support_email_messages
       (id, thread_id, direction, sender_email, sender_name, recipient_email, subject,
        body_text, message_id, in_reply_to, references_header, created_at)
       VALUES (?, ?, 'incoming', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      messageRowId,
      threadId,
      customerEmail,
      customerName,
      contactEmail,
      subject,
      body,
      messageId,
      inReplyTo ?? null,
      references ?? null,
      now,
    ),
  );
  statements.push(inboxEventStatement(env.DB, {
    channel: 'email',
    conversationId: threadId,
    eventType: 'status',
    before: existingThreadId ? { status: 'previous' } : null,
    after: { status: 'unread', source: 'customer_message' },
    actorStaffId: null,
    correlationId: messageRowId,
    createdAt: now,
  }));
  await env.DB.batch(statements);

  console.log(JSON.stringify({ event: 'support_email_received', threadId, from: customerEmail }));
  return { threadId, duplicate: false };
}

export async function receiveSupportEmail(
  message: ForwardableEmailMessage,
  env: SupportEmailEnv,
): Promise<{ threadId: string; duplicate: boolean }> {
  const contactEmail = (env.CONTACT_EMAIL || 'contact-shed@nen-petfood.com').toLowerCase();
  const inboundEmail = (env.SUPPORT_INBOUND_EMAIL || contactEmail).toLowerCase();
  if (![contactEmail, inboundEmail].includes(message.to.toLowerCase())) {
    message.setReject('このアドレスでは受信できません');
    return { threadId: '', duplicate: false };
  }
  if (message.rawSize > MAX_INBOUND_BYTES) {
    message.setReject('メールのサイズが大きすぎます');
    return { threadId: '', duplicate: false };
  }

  // raw は一度しか読めないため、PostalMime に直接一度だけ渡す。
  const parsed = await PostalMime.parse(message.raw, {
    attachmentEncoding: 'arraybuffer',
    maxNestingDepth: 20,
    maxHeadersSize: 256 * 1024,
  });
  const envelopeFrom = message.from.trim().toLowerCase();
  const parsedFrom = asMailbox(parsed.from);
  // XServer から転送する場合、envelope From は SRS 形式になる可能性がある。
  // 顧客への返信先には、メール本文の From ヘッダーを優先して使う。
  const customerEmail = parsedFrom?.address.trim().toLowerCase() || envelopeFrom;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    message.setReject('送信元メールアドレスを確認できません');
    return { threadId: '', duplicate: false };
  }
  return storeSupportEmail(env, {
    customerEmail,
    customerName: parsedFrom?.name,
    subject: parsed.subject || message.headers.get('subject'),
    bodyText: parsed.text,
    bodyHtml: parsed.html,
    messageId: parsed.messageId || message.headers.get('message-id'),
    inReplyTo: parsed.inReplyTo || message.headers.get('in-reply-to'),
    references: parsed.references || message.headers.get('references'),
  });
}

export async function sendSupportEmailReply(
  env: SupportEmailEnv,
  threadId: string,
  body: string,
  staffId: string,
  idempotencyKey: string,
): Promise<{ messageId: string; replayed?: boolean }> {
  if (!env.XSERVER_RELAY_SECRET &&
      (!env.XSERVER_MAIL_HOST || !env.XSERVER_MAIL_USER || !env.XSERVER_MAIL_PASSWORD)) {
    throw new Error('EMAIL_NOT_CONFIGURED');
  }
  const thread = await env.DB.prepare(
    `SELECT id, customer_email, subject FROM support_email_threads WHERE id = ?`,
  ).bind(threadId).first<{ id: string; customer_email: string; subject: string }>();
  if (!thread) throw new Error('THREAD_NOT_FOUND');
  const internalAddresses = new Set([
    (env.CONTACT_EMAIL || 'contact-shed@nen-petfood.com').toLowerCase(),
    'noreply@nen-petfood.com',
  ]);
  if (internalAddresses.has(thread.customer_email.trim().toLowerCase())) {
    throw new Error('INVALID_CUSTOMER_RECIPIENT');
  }

  const replySubject = /^re\s*:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
  const latest = await env.DB.prepare(
    `SELECT message_id, references_header FROM support_email_messages
     WHERE thread_id = ? AND message_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(threadId).first<{ message_id: string | null; references_header: string | null }>();

  const headers: Record<string, string> = {};
  if (latest?.message_id) {
    headers['In-Reply-To'] = latest.message_id;
    headers.References = [latest.references_header, latest.message_id].filter(Boolean).join(' ');
  }

  // 必要なDB読み取りを終えてから予約する。予約後は外部送信直前なので、
  // 読み取りエラーだけで「結果不明」のキーが残る範囲を狭くできる。
  const payloadHash = await hashOutboundPayload(
    JSON.stringify({ threadId, to: thread.customer_email, subject: replySubject, body }),
  );
  const reservation = await reserveOutboundSend(env.DB, {
    key: idempotencyKey,
    channel: 'email',
    resourceId: threadId,
    payloadHash,
    retryInProgress: false,
    now: new Date().toISOString(),
  });
  if (reservation.kind === 'conflict') throw new Error('IDEMPOTENCY_KEY_CONFLICT');
  if (reservation.kind === 'in_progress' || reservation.kind === 'retry') {
    throw new Error('IDEMPOTENCY_IN_PROGRESS');
  }
  if (reservation.kind === 'replay') {
    return { messageId: reservation.responseId, replayed: true };
  }

  const contactEmail = env.CONTACT_EMAIL || 'contact-shed@nen-petfood.com';
  let sentMessageId: string;
  if (env.XSERVER_RELAY_URL && env.XSERVER_RELAY_SECRET) {
    const { sendViaXServerRelay } = await import('./support-relay.js');
    sentMessageId = await sendViaXServerRelay(env.XSERVER_RELAY_URL, env.XSERVER_RELAY_SECRET, {
      to: thread.customer_email,
      subject: replySubject,
      body,
      inReplyTo: headers['In-Reply-To'],
      references: headers.References,
    });
  } else {
    const { sendXServerMail } = await import('./xserver-mail.js');
    sentMessageId = await sendXServerMail(env, {
      to: thread.customer_email,
      from: contactEmail,
      subject: replySubject,
      body,
      inReplyTo: headers['In-Reply-To'],
      references: headers.References,
    });
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO support_email_messages
       (id, thread_id, direction, sender_email, sender_name, recipient_email, subject,
        body_text, message_id, in_reply_to, references_header, sent_by_staff_id, created_at)
       VALUES (?, ?, 'outgoing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      threadId,
      contactEmail,
      '然-NEN- お客様窓口',
      thread.customer_email,
      replySubject,
      body,
      sentMessageId,
      latest?.message_id ?? null,
      headers.References ?? null,
      staffId,
      now,
    ),
    env.DB.prepare(
      `UPDATE support_email_threads
       SET status = 'in_progress', assigned_staff_id = ?, last_message_at = ?,
           last_outgoing_at = ?, last_operator_message_at = ?,
           revision = revision + 1, updated_at = ? WHERE id = ?`,
    ).bind(staffId, now, now, now, now, threadId),
    inboxEventStatement(env.DB, {
      channel: 'email',
      conversationId: threadId,
      eventType: 'send',
      before: null,
      after: { messageId: sentMessageId, status: 'in_progress' },
      actorStaffId: staffId,
      correlationId: idempotencyKey,
      createdAt: now,
    }),
    completeOutboundSendStatement(env.DB, {
      key: idempotencyKey,
      responseId: sentMessageId,
      now,
    }),
  ]);

  console.log(JSON.stringify({ event: 'support_email_replied', threadId, staffId }));
  return { messageId: sentMessageId };
}
