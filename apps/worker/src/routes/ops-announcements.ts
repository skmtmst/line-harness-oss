import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_CHANNEL_LABELS,
  ANNOUNCEMENT_CHANNELS,
  ANNOUNCEMENT_PLANS,
  ANNOUNCEMENT_STATUS_LABELS,
  countNoticeLinkedStaff,
  countScreenReads,
  createPlatformAnnouncement,
  deletePlatformAnnouncement,
  getLineAccounts,
  getPlatformAnnouncement,
  getPlatformSetting,
  listPlatformAnnouncements,
  markAnnouncementSending,
  NOTICE_LINE_ACCOUNT_KEY,
  parseJsonArray,
  recordPlatformAudit,
  setPlatformSetting,
  updatePlatformAnnouncement,
  type AnnouncementAudience,
  type AnnouncementChannel,
  type AnnouncementInput,
  type PlatformAnnouncement,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { requirePlatformAdmin, requirePlatformAdminWrite } from '../middleware/platform-admin.js';
import { clientIp } from '../services/admin-session.js';
import { dbFor } from '../services/db-router.js';
import { deliverAnnouncement, loadNoticeLineAccount, previewAudience } from '../services/platform-announcements.js';

/** 運営からのお知らせ配信 ★V6 37-7 `q2CokV`。運営マスターだけが呼べる。 */
export const opsAnnouncements = new Hono<Env>();

opsAnnouncements.use('/api/ops/announcements', requirePlatformAdmin());
opsAnnouncements.use('/api/ops/announcements/*', requirePlatformAdmin());
opsAnnouncements.use('/api/ops/notice-line-account', requirePlatformAdmin());

const SUBJECT_MAX = 120;
const BODY_MAX = 4000;
const PLAN_LABEL: Record<string, string> = { light: 'ライト', standard: 'スタンダード', pro: 'プロ', trial: 'トライアル' };

function audienceLabel(a: PlatformAnnouncement, tenantNames: Map<string, string>): string {
  if (a.audience_kind === 'all') return 'すべて';
  if (a.audience_kind === 'plan') return parseJsonArray(a.audience_plans).map((p) => PLAN_LABEL[p] ?? p).join('・') || '—';
  const ids = parseJsonArray(a.audience_tenant_ids);
  const names = ids.map((id) => tenantNames.get(id) ?? id);
  return names.length <= 2 ? names.join('・') : `${names.slice(0, 2).join('・')} ほか${names.length - 2}件`;
}

async function tenantNameMap(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { results } = await db.prepare(`SELECT id, name FROM tenants WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string; name: string }>();
  for (const r of results ?? []) out.set(r.id, r.name);
  return out;
}

async function serialize(db: D1Database, a: PlatformAnnouncement) {
  const names = await tenantNameMap(db, parseJsonArray(a.audience_tenant_ids));
  const reads = await countScreenReads(db, a.id);
  return {
    id: a.id,
    subject: a.subject,
    body: a.body,
    audienceKind: a.audience_kind,
    audiencePlans: parseJsonArray(a.audience_plans),
    audienceTenantIds: parseJsonArray(a.audience_tenant_ids),
    audienceLabel: audienceLabel(a, names),
    channels: parseJsonArray(a.channels),
    channelLabels: parseJsonArray(a.channels).map((c) => ANNOUNCEMENT_CHANNEL_LABELS[c as AnnouncementChannel] ?? c),
    status: a.status,
    statusLabel: ANNOUNCEMENT_STATUS_LABELS[a.status],
    publishAt: a.publish_at,
    sentAt: a.sent_at,
    recipientsTotal: a.recipients_total,
    lineSent: a.line_sent,
    lineFailed: a.line_failed,
    mailSent: a.mail_sent,
    mailFailed: a.mail_failed,
    screenRead: reads.read,
    screenTotal: reads.total,
    lastError: a.last_error,
    createdByName: a.created_by_name,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

function parseInput(body: Record<string, unknown>): { input: AnnouncementInput } | { error: string } {
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject) return { error: '件名を入力してください' };
  if (subject.length > SUBJECT_MAX) return { error: `件名は${SUBJECT_MAX}文字以内で入力してください` };
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return { error: '本文を入力してください' };
  if (text.length > BODY_MAX) return { error: `本文は${BODY_MAX}文字以内で入力してください` };
  const audienceKind = typeof body.audienceKind === 'string' && (ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(body.audienceKind) ? (body.audienceKind as AnnouncementAudience) : 'all';
  const audiencePlans = Array.isArray(body.audiencePlans) ? body.audiencePlans.filter((p): p is string => typeof p === 'string' && (ANNOUNCEMENT_PLANS as readonly string[]).includes(p)) : [];
  const audienceTenantIds = Array.isArray(body.audienceTenantIds) ? body.audienceTenantIds.filter((t): t is string => typeof t === 'string' && t.length > 0).slice(0, 500) : [];
  if (audienceKind === 'plan' && audiencePlans.length === 0) return { error: 'プランを 1 つ以上選んでください' };
  if (audienceKind === 'tenants' && audienceTenantIds.length === 0) return { error: '契約先を 1 つ以上選んでください' };
  const channels = Array.isArray(body.channels) ? body.channels.filter((c): c is AnnouncementChannel => typeof c === 'string' && (ANNOUNCEMENT_CHANNELS as readonly string[]).includes(c)) : [];
  if (channels.length === 0) return { error: '送り方を 1 つ以上選んでください' };
  let publishAt: string | null = null;
  if (typeof body.publishAt === 'string' && body.publishAt.trim()) {
    const parsed = Date.parse(body.publishAt);
    if (Number.isNaN(parsed)) return { error: '公開日時の形式が正しくありません' };
    publishAt = new Date(parsed + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
  }
  return { input: { subject, body: text, audienceKind, audiencePlans, audienceTenantIds, channels, publishAt } };
}

async function audit(c: Context<Env>, action: 'announcement.create' | 'announcement.send' | 'announcement.delete' | 'notice_line_account.change', detail: Record<string, unknown>) {
  const staff = c.get('staff');
  await recordPlatformAudit(dbFor(c.env), { staffId: staff.id, staffName: staff.name, action, detail, ip: clientIp(c), visibleToTenant: false });
}

// ---------------------------------------------------------------------------
// 契約者専用LINE の設定
// ---------------------------------------------------------------------------

opsAnnouncements.get('/api/ops/notice-line-account', async (c) => {
  const db = dbFor(c.env);
  const current = await getPlatformSetting(db, NOTICE_LINE_ACCOUNT_KEY);
  const accounts = (await getLineAccounts(db)).filter((a) => (a.tenant_id ?? DEFAULT_TENANT_ID) === DEFAULT_TENANT_ID && !a.archived_at);
  const notice = await loadNoticeLineAccount(c.env);
  const linked = await countNoticeLinkedStaff(db, DEFAULT_TENANT_ID);
  return c.json({
    success: true,
    data: {
      currentId: current,
      current: notice ? { id: notice.id, name: notice.name, basicId: notice.basicId, addFriendUrl: notice.addFriendUrl } : null,
      candidates: accounts.map((a) => ({ id: a.id, name: a.name, basicId: a.line_basic_id })),
      linked,
    },
  });
});

opsAnnouncements.put('/api/ops/notice-line-account', requirePlatformAdminWrite(), async (c) => {
  const db = dbFor(c.env);
  const body = await c.req.json<{ lineAccountId?: unknown }>().catch(() => null);
  const id = typeof body?.lineAccountId === 'string' && body.lineAccountId ? body.lineAccountId : null;
  if (id) {
    const account = (await getLineAccounts(db)).find((a) => a.id === id);
    if (!account || (account.tenant_id ?? DEFAULT_TENANT_ID) !== DEFAULT_TENANT_ID || account.archived_at) {
      return c.json({ success: false, error: '運営会社に登録されたアカウントから選んでください' }, 400);
    }
  }
  const before = await getPlatformSetting(db, NOTICE_LINE_ACCOUNT_KEY);
  await setPlatformSetting(db, NOTICE_LINE_ACCOUNT_KEY, id, c.get('staff').id);
  await audit(c, 'notice_line_account.change', { from: before, to: id });
  return c.json({ success: true, data: { currentId: id } });
});

// ---------------------------------------------------------------------------
// お知らせ
// ---------------------------------------------------------------------------

opsAnnouncements.get('/api/ops/announcements', async (c) => {
  const db = dbFor(c.env);
  const rows = await listPlatformAnnouncements(db);
  const data = await Promise.all(rows.map((a) => serialize(db, a)));
  const linked = await countNoticeLinkedStaff(db, DEFAULT_TENANT_ID);
  return c.json({ success: true, data, linked, noticeLineConfigured: (await getPlatformSetting(db, NOTICE_LINE_ACCOUNT_KEY)) !== null });
});

opsAnnouncements.post('/api/ops/announcements/preview', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const audienceKind = typeof body.audienceKind === 'string' && (ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(body.audienceKind) ? (body.audienceKind as AnnouncementAudience) : 'all';
  const plans = Array.isArray(body.audiencePlans) ? body.audiencePlans.filter((p): p is string => typeof p === 'string') : [];
  const tenantIds = Array.isArray(body.audienceTenantIds) ? body.audienceTenantIds.filter((t): t is string => typeof t === 'string') : [];
  const preview = await previewAudience(c.env, { audienceKind, plans, tenantIds });
  return c.json({ success: true, data: preview });
});

opsAnnouncements.post('/api/ops/announcements', requirePlatformAdminWrite(), async (c) => {
  const db = dbFor(c.env);
  const staff = c.get('staff');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ success: false, error: '内容を読み取れませんでした' }, 400);
  const parsed = parseInput(body);
  if ('error' in parsed) return c.json({ success: false, error: parsed.error }, 400);
  const mode = body.mode === 'schedule' ? 'schedule' : body.mode === 'send' ? 'send' : 'draft';
  if (mode === 'schedule' && !parsed.input.publishAt) return c.json({ success: false, error: '配信を予約するには公開日時を入れてください' }, 400);
  if (parsed.input.channels.includes('line') && mode !== 'draft' && !(await loadNoticeLineAccount(c.env))) {
    return c.json({ success: false, error: '契約者専用LINEのアカウントが未設定です。メンバー管理の「運営の情報」で指定してください' }, 409);
  }
  const created = await createPlatformAnnouncement(db, { ...parsed.input, status: mode === 'schedule' ? 'scheduled' : 'draft', createdByStaffId: staff.id, createdByName: staff.name });
  await audit(c, 'announcement.create', { id: created.id, mode, channels: parsed.input.channels, audienceKind: parsed.input.audienceKind });
  if (mode === 'send') {
    if (!(await markAnnouncementSending(db, created.id))) return c.json({ success: false, error: '送信の準備に失敗しました' }, 409);
    const result = await deliverAnnouncement(c.env, (await getPlatformAnnouncement(db, created.id))!);
    await audit(c, 'announcement.send', { id: created.id, ...result });
  }
  return c.json({ success: true, data: await serialize(db, (await getPlatformAnnouncement(db, created.id))!) }, 201);
});

opsAnnouncements.put('/api/ops/announcements/:id', requirePlatformAdminWrite(), async (c) => {
  const db = dbFor(c.env);
  const existing = await getPlatformAnnouncement(db, c.req.param('id'));
  if (!existing) return c.json({ success: false, error: 'お知らせが見つかりません' }, 404);
  if (existing.status !== 'draft' && existing.status !== 'scheduled') return c.json({ success: false, error: '配信済みのお知らせは変えられません' }, 409);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ success: false, error: '内容を読み取れませんでした' }, 400);
  const parsed = parseInput(body);
  if ('error' in parsed) return c.json({ success: false, error: parsed.error }, 400);
  const mode = body.mode === 'schedule' ? 'schedule' : body.mode === 'send' ? 'send' : 'draft';
  if (mode === 'schedule' && !parsed.input.publishAt) return c.json({ success: false, error: '配信を予約するには公開日時を入れてください' }, 400);
  if (parsed.input.channels.includes('line') && mode !== 'draft' && !(await loadNoticeLineAccount(c.env))) {
    return c.json({ success: false, error: '契約者専用LINEのアカウントが未設定です。メンバー管理の「運営の情報」で指定してください' }, 409);
  }
  const updated = await updatePlatformAnnouncement(db, existing.id, { ...parsed.input, status: mode === 'schedule' ? 'scheduled' : 'draft' });
  if (!updated) return c.json({ success: false, error: 'お知らせが見つかりません' }, 404);
  if (mode === 'send') {
    if (!(await markAnnouncementSending(db, updated.id))) return c.json({ success: false, error: '送信の準備に失敗しました' }, 409);
    const result = await deliverAnnouncement(c.env, (await getPlatformAnnouncement(db, updated.id))!);
    await audit(c, 'announcement.send', { id: updated.id, ...result });
  }
  return c.json({ success: true, data: await serialize(db, (await getPlatformAnnouncement(db, updated.id))!) });
});

opsAnnouncements.delete('/api/ops/announcements/:id', requirePlatformAdminWrite(), async (c) => {
  const db = dbFor(c.env);
  const existing = await getPlatformAnnouncement(db, c.req.param('id'));
  if (!existing) return c.json({ success: false, error: 'お知らせが見つかりません' }, 404);
  const ok = await deletePlatformAnnouncement(db, existing.id);
  if (!ok) return c.json({ success: false, error: '配信済みのお知らせは消せません' }, 409);
  await audit(c, 'announcement.delete', { id: existing.id, subject: existing.subject });
  return c.json({ success: true, data: null });
});
