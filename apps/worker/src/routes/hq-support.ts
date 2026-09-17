import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  HQ_SUPPORT_KINDS,
  createHqSupportRequest,
  getStaffById,
  listHqSupportRequests,
  markHqSupportRequestNotified,
  type HqSupportKind,
  type HqSupportRequest,
  addSupportTenantMessage,
  formatTicketNo,
  getHqSupportRequest,
  getSupportTicket,
  listSupportMessages,
  SUPPORT_STAGE_LABELS,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { requireRole } from '../middleware/role-guard.js';
import { sendPlainMail } from '../services/plain-mail.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

/**
 * 統括から運営へのお問い合わせ（★V6 36-3）。
 *
 * - 送るとこの統括の記録に残り、運営の連絡先へメールで知らせ、送信者に控えを送る
 * - メールが送れなくても記録は残す（`notified` が false で返る）
 * - 役割は問わない（統括・管理者・担当者が送れる。閲覧のみは更新ができない決まりなので送れない）。
 *   見えるのは自分の統括の分だけ
 */
export const hqSupport = new Hono<Env>();

const SUBJECT_MAX = 100;
const BODY_MAX = 4000;
const ATTACHMENT_MAX = 3;
const ATTACHMENT_BYTES_MAX = 5 * 1024 * 1024;
const ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg']);

export const HQ_SUPPORT_KIND_LABELS: Record<HqSupportKind, string> = {
  usage: '使い方について',
  bug: '不具合の報告',
  billing: '料金・契約について',
  feature: '要望・提案',
  other: 'その他',
};

function tenantOf(c: Context<Env>): string {
  return c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
}

function workerUrl(c: Context<Env>): string {
  return c.env.WORKER_URL || new URL(c.req.url).origin;
}

type ReplyView = { id: string; authorName: string; body: string; createdAt: string };

function serialize(row: HqSupportRequest, base: string, replies: ReplyView[] = []) {
  let keys: string[] = [];
  try {
    const parsed = JSON.parse(row.attachment_keys) as unknown;
    keys = Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    keys = [];
  }
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: HQ_SUPPORT_KIND_LABELS[row.kind] ?? row.kind,
    subject: row.subject,
    body: row.body,
    lineAccountId: row.line_account_id,
    attachments: keys.map((key) => ({ key, url: `${base}/images/${key}` })),
    status: row.status,
    staffName: row.staff_name,
    notified: row.notified_at !== null,
    createdAt: row.created_at,
    // 運営側のチケット番号と返信（★V6 37-6 の返信は統括の履歴にも載る）
    ticketLabel: formatTicketNo(row.ticket_no ?? null),
    stage: row.stage,
    replies,
  };
}

function hasImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') {
    return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return false;
}

function decodeBase64(data: string): Uint8Array | null {
  try {
    const raw = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

type Upload = { key: string; bytes: Uint8Array; mimeType: string };

/** 添付（base64 の画像）を検査して R2 のキーを決める。36-3 の送信と 36-3-A の続きで共通。 */
function parseAttachments(raw: unknown): { uploads: Upload[] } | { error: string; status: 400 | 413 } {
  const attachmentsRaw = Array.isArray(raw) ? raw : [];
  if (attachmentsRaw.length > ATTACHMENT_MAX) return { error: `画像は${ATTACHMENT_MAX}枚までです`, status: 400 };
  const uploads: Upload[] = [];
  for (const item of attachmentsRaw) {
    const record = item as Record<string, unknown>;
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : '';
    const data = typeof record.data === 'string' ? record.data : '';
    if (!ATTACHMENT_TYPES.has(mimeType)) return { error: '画像は PNG・JPEG のみ添付できます', status: 400 };
    const bytes = decodeBase64(data);
    if (!bytes) return { error: '画像の中身を読み取れませんでした', status: 400 };
    if (bytes.byteLength > ATTACHMENT_BYTES_MAX) return { error: '画像が大きすぎます（1枚 5MB まで）', status: 413 };
    if (!hasImageSignature(bytes, mimeType)) return { error: '画像の実際の形式が、選択された形式と一致しません', status: 400 };
    uploads.push({ key: `support/${crypto.randomUUID()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`, bytes, mimeType });
  }
  return { uploads };
}

hqSupport.get('/api/hq/support/requests', async (c) => {
  try {
    const rows = await listHqSupportRequests(c.env.DB, tenantOf(c));
    const base = workerUrl(c);
    const data = await Promise.all(rows.map(async (row) => {
      const messages = await listSupportMessages(c.env.DB, row.id);
      const replies = messages
        .filter((m) => m.author_kind === 'ops')
        .map((m) => ({ id: m.id, authorName: m.author_name, body: m.body, createdAt: m.created_at }));
      return serialize(row, base, replies);
    }));
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/hq/support/requests error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

hqSupport.get('/api/hq/support/kinds', (c) => {
  return c.json({
    success: true,
    data: HQ_SUPPORT_KINDS.map((key) => ({ key, label: HQ_SUPPORT_KIND_LABELS[key] })),
  });
});

hqSupport.post('/api/hq/support/requests', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const tenantId = tenantOf(c);
    const staff = c.get('staff');
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ success: false, error: '送信内容を読み取れませんでした' }, 400);

    const kind = typeof body.kind === 'string' ? body.kind : '';
    if (!(HQ_SUPPORT_KINDS as readonly string[]).includes(kind)) {
      return c.json({ success: false, error: '種類を選んでください' }, 400);
    }
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    if (!subject) return c.json({ success: false, error: '件名を入力してください' }, 400);
    if (subject.length > SUBJECT_MAX) return c.json({ success: false, error: `件名は${SUBJECT_MAX}文字以内で入力してください` }, 400);
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text) return c.json({ success: false, error: '本文を入力してください' }, 400);
    if (text.length > BODY_MAX) return c.json({ success: false, error: `本文は${BODY_MAX}文字以内で入力してください` }, 400);

    let lineAccountId: string | null = null;
    let lineAccountName: string | null = null;
    if (typeof body.lineAccountId === 'string' && body.lineAccountId) {
      const { accounts } = await getVisibleLineAccountScope(c.env.DB, staff);
      const account = accounts.find((a) => a.id === body.lineAccountId);
      if (!account) return c.json({ success: false, error: '関係する店舗が見つかりません' }, 404);
      lineAccountId = account.id;
      const accountLabel = await c.env.DB
        .prepare('SELECT name FROM line_accounts WHERE id = ? AND COALESCE(tenant_id, ?) = ?')
        .bind(account.id, DEFAULT_TENANT_ID, tenantId)
        .first<{ name: string }>();
      lineAccountName = accountLabel?.name ?? null;
    }

    const parsed = parseAttachments(body.attachments);
    if ('error' in parsed) return c.json({ success: false, error: parsed.error }, parsed.status);
    const uploads = parsed.uploads;
    for (const upload of uploads) {
      await c.env.IMAGES.put(upload.key, upload.bytes, { httpMetadata: { contentType: upload.mimeType } });
    }

    const member = staff?.id ? await getStaffById(c.env.DB, staff.id).catch(() => null) : null;
    const tenant = await c.env.DB.prepare('SELECT name FROM tenants WHERE id = ?').bind(tenantId).first<{ name: string }>().catch(() => null);
    const staffName = member?.name ?? staff?.name ?? '';
    const staffEmail = member?.email ?? null;

    const request = await createHqSupportRequest(c.env.DB, {
      tenantId,
      staffId: staff?.id ?? null,
      staffName,
      staffEmail,
      kind: kind as HqSupportKind,
      subject,
      body: text,
      lineAccountId,
      attachmentKeys: uploads.map((u) => u.key),
    });

    // 運営への通知と、送信者への控え。送れなくても記録は残す。
    const base = workerUrl(c);
    const kindLabel = HQ_SUPPORT_KIND_LABELS[kind as HqSupportKind];
    const lines = [
      `種類: ${kindLabel}`,
      `件名: ${subject}`,
      `統括: ${tenant?.name ?? tenantId}`,
      `送信者: ${staffName}${staffEmail ? ` <${staffEmail}>` : ''}`,
      lineAccountName ? `関係する店舗: ${lineAccountName}` : null,
      '',
      text,
      uploads.length > 0 ? '' : null,
      uploads.length > 0 ? `添付: ${uploads.map((u) => `${base}/images/${u.key}`).join('\n')}` : null,
    ].filter((line): line is string => line !== null);
    let notified = false;
    const operatorTo = c.env.SUPPORT_NOTIFY_EMAIL || c.env.CONTACT_EMAIL;
    try {
      if (operatorTo) {
        await sendPlainMail(c.env, {
          to: operatorTo,
          subject: `【musubo お問い合わせ】${kindLabel}: ${subject}`,
          body: lines.join('\n'),
        });
        notified = true;
      }
      if (staffEmail) {
        await sendPlainMail(c.env, {
          to: staffEmail,
          subject: `【musubo】お問い合わせを受け付けました: ${subject}`,
          body: `${staffName} 様\n\nお問い合わせを受け付けました。返信は登録メールアドレスに届きます（平日 2営業日以内）。\n\n${lines.join('\n')}`,
        });
      }
    } catch (error) {
      console.warn('hq support mail failed:', error instanceof Error ? error.message : error);
    }
    if (notified) await markHqSupportRequestNotified(c.env.DB, request.id);

    return c.json({
      success: true,
      data: { ...serialize({ ...request, notified_at: notified ? request.created_at : null }, base), notified },
    }, 201);
  } catch (err) {
    console.error('POST /api/hq/support/requests error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 36-3-A：1 件のやり取り。統括の境界（tenant_id）で必ず絞る。 */
hqSupport.get('/api/hq/support/requests/:id', async (c) => {
  try {
    const tenantId = tenantOf(c);
    const row = await getHqSupportRequest(c.env.DB, c.req.param('id'), tenantId);
    if (!row) return c.json({ success: false, error: 'お問い合わせが見つかりません' }, 404);
    const base = workerUrl(c);
    const messages = await listSupportMessages(c.env.DB, row.id);
    return c.json({
      success: true,
      data: {
        ...serialize(row, base, messages.filter((m) => m.author_kind === 'ops').map((m) => ({ id: m.id, authorName: m.author_name, body: m.body, createdAt: m.created_at }))),
        stageLabel: SUPPORT_STAGE_LABELS[row.stage],
        messages: messages.map((m) => ({
          id: m.id,
          authorKind: m.author_kind,
          authorName: m.author_kind === 'ops' ? `musubo 運営 ／ ${m.author_name}` : m.author_name,
          body: m.body,
          attachments: safeKeysOf(m.attachment_keys).map((key) => ({ key, url: `${base}/images/${key}` })),
          createdAt: m.created_at,
        })),
        canFollowUp: true,
      },
    });
  } catch (err) {
    console.error('GET /api/hq/support/requests/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

function safeKeysOf(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** 36-3-A：続きを送る。運営のチケットは対応中へ戻り、運営へ通知メール、送信者に控えを送る。 */
hqSupport.post('/api/hq/support/requests/:id/messages', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const tenantId = tenantOf(c);
    const staff = c.get('staff');
    const row = await getHqSupportRequest(c.env.DB, c.req.param('id'), tenantId);
    if (!row) return c.json({ success: false, error: 'お問い合わせが見つかりません' }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ success: false, error: '送信内容を読み取れませんでした' }, 400);
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text) return c.json({ success: false, error: '本文を入力してください' }, 400);
    if (text.length > BODY_MAX) return c.json({ success: false, error: `本文は${BODY_MAX}文字以内で入力してください` }, 400);
    const parsed = parseAttachments(body.attachments);
    if ('error' in parsed) return c.json({ success: false, error: parsed.error }, parsed.status);
    for (const upload of parsed.uploads) {
      await c.env.IMAGES.put(upload.key, upload.bytes, { httpMetadata: { contentType: upload.mimeType } });
    }
    const member = staff?.id ? await getStaffById(c.env.DB, staff.id).catch(() => null) : null;
    const staffName = member?.name ?? staff?.name ?? '';
    const staffEmail = member?.email ?? row.staff_email ?? null;
    const message = await addSupportTenantMessage(c.env.DB, {
      requestId: row.id,
      staffId: staff?.id ?? null,
      staffName,
      body: text,
      attachmentKeys: parsed.uploads.map((u) => u.key),
    });

    const base = workerUrl(c);
    const ticket = await getSupportTicket(c.env.DB, row.id);
    const ticketLabel = formatTicketNo(row.ticket_no ?? null);
    const lines = [
      `チケット: ${ticketLabel}`,
      `件名: ${row.subject}`,
      `統括: ${ticket?.tenant_name ?? tenantId}`,
      `送信者: ${staffName}${staffEmail ? ` <${staffEmail}>` : ''}`,
      '',
      text,
      parsed.uploads.length > 0 ? '' : null,
      parsed.uploads.length > 0 ? `添付: ${parsed.uploads.map((u) => `${base}/images/${u.key}`).join('\n')}` : null,
    ].filter((line): line is string => line !== null);
    const operatorTo = c.env.SUPPORT_NOTIFY_EMAIL || c.env.CONTACT_EMAIL;
    try {
      if (operatorTo) {
        await sendPlainMail(c.env, {
          to: operatorTo,
          subject: `【musubo お問い合わせ】続き ${ticketLabel}: ${row.subject}`,
          body: lines.join('\n'),
        });
      }
      if (staffEmail) {
        await sendPlainMail(c.env, {
          to: staffEmail,
          subject: `【musubo】お問い合わせの続きを受け付けました ${ticketLabel}: ${row.subject}`,
          body: `${staffName} 様\n\nお問い合わせの続きを受け付けました。返信は登録メールアドレスと管理画面のお問い合わせに届きます。\n\n${lines.join('\n')}`,
        });
      }
    } catch (error) {
      console.warn('hq support follow-up mail failed:', error instanceof Error ? error.message : error);
    }
    return c.json({
      success: true,
      data: {
        id: message.id,
        authorKind: 'tenant',
        authorName: message.author_name,
        body: message.body,
        attachments: parsed.uploads.map((u) => ({ key: u.key, url: `${base}/images/${u.key}` })),
        createdAt: message.created_at,
        stage: ticket?.stage ?? 'in_progress',
        status: ticket?.status ?? 'open',
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/hq/support/requests/:id/messages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
