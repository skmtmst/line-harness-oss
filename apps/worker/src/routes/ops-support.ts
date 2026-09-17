import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  addSupportReply,
  countSupportTicketsByStage,
  countRepliesForRequests,
  createSupportTicketByOps,
  deleteSupportReplyDraft,
  formatTicketNo,
  getSupportReplyDraft,
  getSupportTicket,
  HQ_SUPPORT_KINDS,
  listSupportMessages,
  listSupportTickets,
  recordPlatformAudit,
  saveSupportReplyDraft,
  SUPPORT_CHANNEL_LABELS,
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STAGE_LABELS,
  SUPPORT_STAGES,
  supportTenantContext,
  supportTicketKpis,
  updateSupportTicket,
  type HqSupportKind,
  type SupportMessage,
  type SupportPriority,
  type SupportStage,
  type SupportTicketRow,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requirePlatformAdmin, requirePlatformAdminWrite } from '../middleware/platform-admin.js';
import { clientIp } from '../services/admin-session.js';
import { dbFor } from '../services/db-router.js';
import { sendPlainMail } from '../services/plain-mail.js';
import { HQ_SUPPORT_KIND_LABELS } from './hq-support.js';

/**
 * 運営コンソールのお問い合わせ（チケット）★V6 37-6 / 37-6-A / 37-6-B。
 *
 * 表は統括側 36-3 と同じ hq_support_requests。運営マスターだけが呼べる。
 * 返信は統括の登録メールへ送り、統括の画面（36-3 の履歴）にも載る。
 * AI の下書きは Workers AI（Cloudflare 内）で作り、外部の LLM へは送らない。
 */
export const opsSupport = new Hono<Env>();

opsSupport.use('/api/ops/support/*', requirePlatformAdmin());

const REPLY_MAX = 4000;
const SUBJECT_MAX = 120;
const BODY_MAX = 4000;
/** 既定の下書きモデル。環境変数 OPS_SUPPORT_AI_MODEL で差し替えられる（値は Workers AI のモデル名）。 */
const DEFAULT_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
/** Workers AI の応答を待つ上限。超えたら 504 を返し、画面は「待たずに手で書く」へ戻す。 */
const AI_TIMEOUT_MS = 45_000;

function workerUrl(c: Context<Env>): string {
  return c.env.WORKER_URL || new URL(c.req.url).origin;
}

function safeKeys(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function jstMonthStarts(): { monthStart: string; prevMonthStart: string } {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const fmt = (yy: number, mm: number) => `${yy}-${String(mm + 1).padStart(2, '0')}-01T00:00:00.000+09:00`;
  return { monthStart: fmt(y, m), prevMonthStart: m === 0 ? fmt(y - 1, 11) : fmt(y, m - 1) };
}

function serializeTicket(row: SupportTicketRow, base: string, replyCount: number) {
  return {
    id: row.id,
    ticketNo: row.ticket_no,
    ticketLabel: formatTicketNo(row.ticket_no),
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantPlanKey: row.tenant_plan_key,
    tenantPlanStatus: row.tenant_plan_status,
    tenantStatus: row.tenant_status,
    staffId: row.staff_id,
    staffName: row.staff_name,
    staffRole: row.staff_role,
    staffEmailRegistered: row.staff_email !== null,
    kind: row.kind,
    kindLabel: HQ_SUPPORT_KIND_LABELS[row.kind] ?? row.kind,
    subject: row.subject,
    subjectAuto: row.subject_auto === 1,
    body: row.body,
    attachments: safeKeys(row.attachment_keys).map((key) => ({ key, url: `${base}/images/${key}`, name: key.split('/').pop() ?? key })),
    stage: row.stage,
    stageLabel: SUPPORT_STAGE_LABELS[row.stage],
    priority: row.priority,
    priorityLabel: SUPPORT_PRIORITY_LABELS[row.priority],
    channel: row.channel,
    channelLabel: SUPPORT_CHANNEL_LABELS[row.channel],
    assigneeStaffId: row.assignee_staff_id,
    replyCount,
    firstRepliedAt: row.first_replied_at,
    lastMessageAt: row.last_message_at ?? row.created_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeMessage(m: SupportMessage, base: string) {
  return {
    id: m.id,
    authorKind: m.author_kind,
    authorName: m.author_name,
    body: m.body,
    attachments: safeKeys(m.attachment_keys).map((key) => ({ key, url: `${base}/images/${key}`, name: key.split('/').pop() ?? key })),
    aiAssisted: m.ai_assisted === 1,
    deliveredVia: safeKeys(m.delivered_via),
    createdAt: m.created_at,
  };
}

async function audit(c: Context<Env>, input: { action: 'ticket.view' | 'ticket.reply' | 'ticket.stage.change' | 'ticket.create'; ticket: SupportTicketRow; detail?: Record<string, unknown>; visibleToTenant: boolean }) {
  const staff = c.get('staff');
  await recordPlatformAudit(dbFor(c.env), {
    staffId: staff.id,
    staffName: staff.name,
    tenantId: input.ticket.tenant_id,
    tenantName: input.ticket.tenant_name,
    action: input.action,
    detail: { ticketNo: input.ticket.ticket_no, ...(input.detail ?? {}) },
    ip: clientIp(c),
    visibleToTenant: input.visibleToTenant,
  });
}

// ---------------------------------------------------------------------------
// 一覧・数値カード
// ---------------------------------------------------------------------------

opsSupport.get('/api/ops/support/summary', async (c) => {
  const db = dbFor(c.env);
  const [byStage, kpis] = await Promise.all([countSupportTicketsByStage(db), supportTicketKpis(db, jstMonthStarts())]);
  return c.json({ success: true, data: { byStage, kpis } });
});

opsSupport.get('/api/ops/support/tickets', async (c) => {
  const db = dbFor(c.env);
  const stageRaw = c.req.query('stage');
  const stage = stageRaw && (SUPPORT_STAGES as readonly string[]).includes(stageRaw) ? (stageRaw as SupportStage) : 'all';
  const priorityRaw = c.req.query('priority');
  const priority = priorityRaw && (SUPPORT_PRIORITIES as readonly string[]).includes(priorityRaw) ? (priorityRaw as SupportPriority) : undefined;
  const sortRaw = c.req.query('sort');
  const sort = sortRaw === 'oldest' || sortRaw === 'priority' ? sortRaw : 'newest';
  const limit = Number(c.req.query('limit') ?? 50);
  const offset = Number(c.req.query('offset') ?? 0);
  const { rows, total } = await listSupportTickets(db, {
    stage, priority, q: c.req.query('q') ?? '', sort,
    limit: Number.isFinite(limit) ? limit : 50, offset: Number.isFinite(offset) ? offset : 0,
  });
  const replies = await countRepliesForRequests(db, rows.map((r) => r.id));
  const base = workerUrl(c);
  return c.json({ success: true, data: rows.map((r) => serializeTicket(r, base, replies.get(r.id) ?? 0)), total });
});

// ---------------------------------------------------------------------------
// 詳細
// ---------------------------------------------------------------------------

opsSupport.get('/api/ops/support/tickets/:id', async (c) => {
  const db = dbFor(c.env);
  const ticket = await getSupportTicket(db, c.req.param('id'));
  if (!ticket) return c.json({ success: false, error: 'チケットが見つかりません' }, 404);
  const [messages, draft, tenant] = await Promise.all([
    listSupportMessages(db, ticket.id),
    getSupportReplyDraft(db, ticket.id),
    supportTenantContext(db, ticket.tenant_id, ticket.id),
  ]);
  const base = workerUrl(c);
  // 閲覧の記録（統括には見せない）。失敗しても画面は出す。
  await audit(c, { action: 'ticket.view', ticket, visibleToTenant: false }).catch((error) => {
    console.error('[ops-support] audit failed', { branch: 'ticket.view', message: error instanceof Error ? error.message : String(error) });
  });
  return c.json({
    success: true,
    data: {
      ticket: serializeTicket(ticket, base, messages.filter((m) => m.author_kind === 'ops').length),
      tenant,
      messages: messages.map((m) => serializeMessage(m, base)),
      draft: draft ? { body: draft.body, aiGenerated: draft.ai_generated === 1, generatedAt: draft.generated_at, updatedAt: draft.updated_at } : null,
      ai: { available: Boolean(c.env.AI) },
    },
  });
});

opsSupport.patch('/api/ops/support/tickets/:id', requirePlatformAdminWrite(), async (c) => {
  const db = dbFor(c.env);
  const body = await c.req.json<{ stage?: unknown; priority?: unknown }>().catch(() => null);
  if (!body) return c.json({ success: false, error: '内容を読み取れませんでした' }, 400);
  const patch: { stage?: SupportStage; priority?: SupportPriority } = {};
  if (body.stage !== undefined) {
    if (typeof body.stage !== 'string' || !(SUPPORT_STAGES as readonly string[]).includes(body.stage)) {
      return c.json({ success: false, error: '状態の値が正しくありません' }, 400);
    }
    patch.stage = body.stage as SupportStage;
  }
  if (body.priority !== undefined) {
    if (typeof body.priority !== 'string' || !(SUPPORT_PRIORITIES as readonly string[]).includes(body.priority)) {
      return c.json({ success: false, error: '優先度の値が正しくありません' }, 400);
    }
    patch.priority = body.priority as SupportPriority;
  }
  if (!patch.stage && !patch.priority) return c.json({ success: false, error: '変更する項目がありません' }, 400);
  const before = await getSupportTicket(db, c.req.param('id'));
  if (!before) return c.json({ success: false, error: 'チケットが見つかりません' }, 404);
  const after = await updateSupportTicket(db, before.id, patch);
  if (!after) return c.json({ success: false, error: 'チケットが見つかりません' }, 404);
  if (patch.stage && patch.stage !== before.stage) {
    await audit(c, { action: 'ticket.stage.change', ticket: after, detail: { from: before.stage, to: patch.stage }, visibleToTenant: false });
  }
  const base = workerUrl(c);
  const replies = await countRepliesForRequests(db, [after.id]);
  return c.json({ success: true, data: serializeTicket(after, base, replies.get(after.id) ?? 0) });
});

// ---------------------------------------------------------------------------
// 返信・下書き・AI下書き
// ---------------------------------------------------------------------------

function replyMailBody(input: { staffName: string; ticketLabel: string; subject: string; reply: string; opsName: string; adminUrl: string }): string {
  return [
    `${input.staffName || 'ご担当者'} 様`,
    '',
    `お問い合わせ ${input.ticketLabel}「${input.subject}」に、musubo 運営から返信しました。`,
    '',
    '----------------------------------------',
    input.reply,
    '----------------------------------------',
    '',
    `担当: musubo 運営 ／ ${input.opsName}`,
    'この返信は管理画面の「お問い合わせ」の履歴にも載っています。',
    `${input.adminUrl}/hq/support`,
    '',
    '追加のご質問は、管理画面のお問い合わせから同じ件名でお送りください。',
  ].join('\n');
}

opsSupport.post('/api/ops/support/tickets/:id/reply', requirePlatformAdminWrite(), async (c) => {
  const db = dbFor(c.env);
  const staff = c.get('staff');
  const body = await c.req.json<{ body?: unknown; nextStage?: unknown; aiAssisted?: unknown }>().catch(() => null);
  if (!body) return c.json({ success: false, error: '内容を読み取れませんでした' }, 400);
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return c.json({ success: false, error: '返信を入力してください' }, 400);
  if (text.length > REPLY_MAX) return c.json({ success: false, error: `返信は${REPLY_MAX}文字以内で入力してください` }, 400);
  let nextStage: SupportStage | undefined;
  if (body.nextStage !== undefined) {
    if (typeof body.nextStage !== 'string' || !(SUPPORT_STAGES as readonly string[]).includes(body.nextStage)) {
      return c.json({ success: false, error: '状態の値が正しくありません' }, 400);
    }
    nextStage = body.nextStage as SupportStage;
  }
  const ticket = await getSupportTicket(db, c.req.param('id'));
  if (!ticket) return c.json({ success: false, error: 'チケットが見つかりません' }, 404);
  if (ticket.stage === 'closed') return c.json({ success: false, error: 'クローズしたチケットには返信できません。先に状態を戻してください' }, 409);

  // 届け方：登録メール（あれば）＋管理画面の履歴。契約者専用LINEは 37-7 の口ができてから足す。
  const deliveredVia: string[] = ['screen'];
  const adminUrl = (c.env.ADMIN_PUBLIC_URL ?? '').replace(/\/+$/, '');
  if (ticket.staff_email) {
    try {
      await sendPlainMail(c.env, {
        to: ticket.staff_email,
        subject: `【musubo】お問い合わせへの返信 ${formatTicketNo(ticket.ticket_no)}: ${ticket.subject}`,
        body: replyMailBody({ staffName: ticket.staff_name, ticketLabel: formatTicketNo(ticket.ticket_no), subject: ticket.subject, reply: text, opsName: staff.name, adminUrl }),
      });
      deliveredVia.push('email');
    } catch (error) {
      // メールが落ちても返信は記録する。画面には「メールは送れなかった」と返す。
      console.error('[ops-support] reply mail failed', { message: error instanceof Error ? error.message : String(error) });
    }
  }
  const message = await addSupportReply(db, {
    requestId: ticket.id,
    authorStaffId: staff.id,
    authorName: staff.name,
    body: text,
    aiAssisted: body.aiAssisted === true,
    deliveredVia,
    nextStage,
  });
  const after = (await getSupportTicket(db, ticket.id))!;
  await audit(c, { action: 'ticket.reply', ticket: after, detail: { deliveredVia, aiAssisted: body.aiAssisted === true }, visibleToTenant: true });
  const base = workerUrl(c);
  const replies = await countRepliesForRequests(db, [after.id]);
  return c.json({
    success: true,
    data: {
      ticket: serializeTicket(after, base, replies.get(after.id) ?? 0),
      message: serializeMessage(message, base),
      mailSent: deliveredVia.includes('email'),
      mailSkippedReason: ticket.staff_email ? (deliveredVia.includes('email') ? null : 'send_failed') : 'no_email',
    },
  }, 201);
});

opsSupport.put('/api/ops/support/tickets/:id/draft', requirePlatformAdminWrite(), async (c) => {
  const db = dbFor(c.env);
  const staff = c.get('staff');
  const body = await c.req.json<{ body?: unknown }>().catch(() => null);
  const text = typeof body?.body === 'string' ? body.body : '';
  if (text.length > REPLY_MAX) return c.json({ success: false, error: `下書きは${REPLY_MAX}文字以内です` }, 400);
  const ticket = await getSupportTicket(db, c.req.param('id'));
  if (!ticket) return c.json({ success: false, error: 'チケットが見つかりません' }, 404);
  if (!text.trim()) {
    await deleteSupportReplyDraft(db, ticket.id);
    return c.json({ success: true, data: null });
  }
  const draft = await saveSupportReplyDraft(db, { requestId: ticket.id, body: text, aiGenerated: false, authorStaffId: staff.id });
  return c.json({ success: true, data: { body: draft.body, aiGenerated: false, generatedAt: null, updatedAt: draft.updated_at } });
});

opsSupport.delete('/api/ops/support/tickets/:id/draft', requirePlatformAdminWrite(), async (c) => {
  const db = dbFor(c.env);
  const ticket = await getSupportTicket(db, c.req.param('id'));
  if (!ticket) return c.json({ success: false, error: 'チケットが見つかりません' }, 404);
  await deleteSupportReplyDraft(db, ticket.id);
  return c.json({ success: true, data: null });
});

function aiText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const value = result as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  if (typeof value.response === 'string') return value.response.trim();
  const content = value.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

/** AI に渡す材料（★V6 37-6-A）。個人のメールアドレスや LINE ID は渡さない。 */
export function buildDraftPrompt(input: {
  ticket: { ticketLabel: string; subject: string; body: string; kindLabel: string; staffName: string; staffRole: string | null; tenantName: string; planLabel: string };
  messages: Array<{ authorKind: 'tenant' | 'ops'; authorName: string; body: string }>;
  opsName: string;
}): { system: string; user: string } {
  const thread = [
    `【${input.ticket.tenantName} ／ ${input.ticket.staffName}】\n${input.ticket.body}`,
    ...input.messages.map((m) => `【${m.authorKind === 'ops' ? 'musubo 運営' : input.ticket.tenantName} ／ ${m.authorName}】\n${m.body}`),
  ].join('\n\n');
  return {
    system: [
      'あなたは LINE 公式アカウント運用ツール「musubo」の運営サポート担当です。',
      '契約先（統括）の権限者からのお問い合わせに、丁寧で具体的な日本語の返信を下書きします。',
      '守ること：',
      '- 断定できないことは「確認します」と書き、事実を作らない',
      '- 手順は番号付きで短く',
      '- 相手に確認したいことがあれば最後にまとめて聞く',
      '- 冒頭は「〇〇さま」から、署名は「musubo 運営の（担当者名）」で終える',
      '- 600文字以内。絵文字・記号の装飾は使わない',
    ].join('\n'),
    user: [
      `チケット: ${input.ticket.ticketLabel}`,
      `種類: ${input.ticket.kindLabel}`,
      `件名: ${input.ticket.subject}`,
      `契約先: ${input.ticket.tenantName}（${input.ticket.planLabel}）`,
      `起票者: ${input.ticket.staffName}${input.ticket.staffRole ? `（${input.ticket.staffRole}）` : ''}`,
      `担当者名: ${input.opsName}`,
      '',
      'やり取り:',
      thread,
    ].join('\n'),
  };
}

const PLAN_LABEL: Record<string, string> = { light: 'ライト', standard: 'スタンダード', pro: 'プロ' };
const ROLE_LABEL: Record<string, string> = { owner: 'オーナー', admin: '管理者', staff: '担当者' };

opsSupport.post('/api/ops/support/tickets/:id/draft/ai', requirePlatformAdminWrite(), async (c) => {
  const db = dbFor(c.env);
  const staff = c.get('staff');
  if (!c.env.AI) return c.json({ success: false, error: 'AI の下書きは、この環境では使えません（AI の設定が未設定）' }, 503);
  const ticket = await getSupportTicket(db, c.req.param('id'));
  if (!ticket) return c.json({ success: false, error: 'チケットが見つかりません' }, 404);
  const messages = await listSupportMessages(db, ticket.id);
  const prompt = buildDraftPrompt({
    ticket: {
      ticketLabel: formatTicketNo(ticket.ticket_no),
      subject: ticket.subject,
      body: ticket.body,
      kindLabel: HQ_SUPPORT_KIND_LABELS[ticket.kind] ?? ticket.kind,
      staffName: ticket.staff_name,
      staffRole: ticket.staff_role ? ROLE_LABEL[ticket.staff_role] ?? ticket.staff_role : null,
      tenantName: ticket.tenant_name,
      planLabel: ticket.tenant_plan_key ? PLAN_LABEL[ticket.tenant_plan_key] ?? ticket.tenant_plan_key : 'プラン未設定',
    },
    messages: messages.map((m) => ({ authorKind: m.author_kind, authorName: m.author_name, body: m.body })),
    opsName: staff.name,
  });
  const model = c.env.OPS_SUPPORT_AI_MODEL || DEFAULT_AI_MODEL;
  let text = '';
  try {
    const run = (c.env.AI.run as (model: string, input: unknown) => Promise<unknown>)(model, {
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      temperature: 0.3,
      max_tokens: 900,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`AI timeout after ${AI_TIMEOUT_MS}ms`)), AI_TIMEOUT_MS);
    });
    try {
      text = aiText(await Promise.race([run, timeout]));
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    const detail = error instanceof Error ? { name: error.name, message: error.message } : { name: 'UnknownError', message: String(error) };
    console.error('[ops-support] AI draft failed', { model, ...detail });
    if (detail.message.startsWith('AI timeout')) {
      return c.json({ success: false, error: 'AI の応答が 45 秒以内に返りませんでした。手で書くか、少し待ってからもう一度お試しください' }, 504);
    }
    return c.json({ success: false, error: `AI の下書きを作れませんでした（${detail.message.slice(0, 120)}）` }, 502);
  }
  if (!text) return c.json({ success: false, error: 'AI の下書きが空でした。もう一度お試しください' }, 502);
  const draft = await saveSupportReplyDraft(db, { requestId: ticket.id, body: text.slice(0, REPLY_MAX), aiGenerated: true, authorStaffId: staff.id });
  return c.json({ success: true, data: { body: draft.body, aiGenerated: true, generatedAt: draft.generated_at, updatedAt: draft.updated_at } }, 201);
});

// ---------------------------------------------------------------------------
// 運営が起票する（＋ チケットを作る）
// ---------------------------------------------------------------------------

opsSupport.post('/api/ops/support/tickets', requirePlatformAdminWrite(), async (c) => {
  const db = dbFor(c.env);
  const staff = c.get('staff');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ success: false, error: '内容を読み取れませんでした' }, 400);
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId : '';
  const tenant = tenantId
    ? await db.prepare('SELECT id, name FROM tenants WHERE id = ?').bind(tenantId).first<{ id: string; name: string }>()
    : null;
  if (!tenant) return c.json({ success: false, error: '契約先を選んでください' }, 400);
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject) return c.json({ success: false, error: '件名を入力してください' }, 400);
  if (subject.length > SUBJECT_MAX) return c.json({ success: false, error: `件名は${SUBJECT_MAX}文字以内で入力してください` }, 400);
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return c.json({ success: false, error: '本文を入力してください' }, 400);
  if (text.length > BODY_MAX) return c.json({ success: false, error: `本文は${BODY_MAX}文字以内で入力してください` }, 400);
  const kind = typeof body.kind === 'string' && (HQ_SUPPORT_KINDS as readonly string[]).includes(body.kind) ? (body.kind as HqSupportKind) : 'other';
  const priority = typeof body.priority === 'string' && (SUPPORT_PRIORITIES as readonly string[]).includes(body.priority) ? (body.priority as SupportPriority) : 'medium';
  const channel = body.channel === 'line' ? 'line' : 'ops';
  let staffRow: { id: string; name: string; email: string | null } | null = null;
  if (typeof body.staffId === 'string' && body.staffId) {
    staffRow = await db
      .prepare('SELECT id, name, email FROM staff_members WHERE id = ? AND tenant_id = ? AND is_active = 1')
      .bind(body.staffId, tenant.id)
      .first<{ id: string; name: string; email: string | null }>();
    if (!staffRow) return c.json({ success: false, error: '起票者が契約先の権限者に見つかりません' }, 404);
  }
  const ticket = await createSupportTicketByOps(db, {
    tenantId: tenant.id, subject, body: text, kind, priority, channel,
    createdByStaffId: staff.id, createdByName: staff.name,
    staffId: staffRow?.id ?? null, staffName: staffRow?.name ?? '', staffEmail: staffRow?.email ?? null,
  });
  await audit(c, { action: 'ticket.create', ticket, detail: { channel, priority }, visibleToTenant: false });
  return c.json({ success: true, data: serializeTicket(ticket, workerUrl(c), 0) }, 201);
});
