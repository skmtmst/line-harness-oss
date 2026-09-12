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

function serialize(row: HqSupportRequest, base: string) {
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

hqSupport.get('/api/hq/support/requests', async (c) => {
  try {
    const rows = await listHqSupportRequests(c.env.DB, tenantOf(c));
    const base = workerUrl(c);
    return c.json({ success: true, data: rows.map((row) => serialize(row, base)) });
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
      lineAccountName = account.name;
    }

    const attachmentsRaw = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachmentsRaw.length > ATTACHMENT_MAX) {
      return c.json({ success: false, error: `画像は${ATTACHMENT_MAX}枚までです` }, 400);
    }
    const uploads: Array<{ key: string; bytes: Uint8Array; mimeType: string }> = [];
    for (const item of attachmentsRaw) {
      const record = item as Record<string, unknown>;
      const mimeType = typeof record.mimeType === 'string' ? record.mimeType : '';
      const data = typeof record.data === 'string' ? record.data : '';
      if (!ATTACHMENT_TYPES.has(mimeType)) return c.json({ success: false, error: '画像は PNG・JPEG のみ添付できます' }, 400);
      const bytes = decodeBase64(data);
      if (!bytes) return c.json({ success: false, error: '画像の中身を読み取れませんでした' }, 400);
      if (bytes.byteLength > ATTACHMENT_BYTES_MAX) return c.json({ success: false, error: '画像が大きすぎます（1枚 5MB まで）' }, 413);
      if (!hasImageSignature(bytes, mimeType)) return c.json({ success: false, error: '画像の実際の形式が、選択された形式と一致しません' }, 400);
      uploads.push({ key: `support/${crypto.randomUUID()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`, bytes, mimeType });
    }
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
