import { Hono } from 'hono';
import {
  HQ_SUPPORT_KINDS, editKnowledgeArticle, getKnowledgeArticle, getSupportTicket,
  knowledgeFeedback, knowledgeForTicket, listKnowledgeArticles, listSupportMessages, recordPlatformAudit,
  retryKnowledgeJob, reviewKnowledgeArticle, type KnowledgeArticle, type KnowledgeArticleInput,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requirePlatformAdmin, requirePlatformAdminWrite } from '../middleware/platform-admin.js';
import { dbFor } from '../services/db-router.js';
import { knowledgeNames, knowledgeSources, processKnowledgeJob, redactKnowledgeText, validateKnowledgeEvidence } from '../services/platform-knowledge.js';

export const opsKnowledge = new Hono<Env>();
opsKnowledge.use('/api/ops/knowledge', requirePlatformAdmin());
opsKnowledge.use('/api/ops/knowledge/*', requirePlatformAdmin());

export function serializeKnowledge(row: KnowledgeArticle) {
  return {
    id: row.id, version: row.version, title: row.title, question: row.question, answer: row.answer,
    kind: row.kind, keywords: JSON.parse(row.keywords), sourceRequestId: row.source_request_id,
    ticketNo: row.ticket_no, sourceCurrent: row.source_current === 1,
    reviewState: row.review_state, status: row.status, reviewReason: row.review_reason,
    evidence: JSON.parse(row.evidence), usedCount: row.used_count, helpfulCount: row.helpful_count,
    unhelpfulCount: row.unhelpful_count, updatedAt: row.updated_at,
  };
}

const invalid = { success: false, error: '入力内容を確認してください' };
const conflict = { success: false, error: '内容が更新されました。読み直して確認してください' };

opsKnowledge.get('/api/ops/knowledge', async c => {
  const { q, kind, state } = c.req.query();
  const offset = Number(c.req.query('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000 || (q?.length ?? 0) > 200 ||
    (kind && !HQ_SUPPORT_KINDS.some(value => value === kind)) ||
    (state && !['pending', 'approved', 'needs_review', 'dismissed'].includes(state))) return c.json(invalid, 400);
  const result = await listKnowledgeArticles(dbFor(c.env), { q, kind, state, offset });
  return c.json({ success: true, data: result.articles.map(serializeKnowledge), total: result.total });
});

opsKnowledge.get('/api/ops/knowledge/:id', async c => {
  const article = await getKnowledgeArticle(dbFor(c.env), c.req.param('id'));
  if (!article) return c.json({ success: false, error: '記事が見つかりません' }, 404);
  const ticket = await getSupportTicket(dbFor(c.env), article.source_request_id);
  const sourceSubject = ticket
    ? redactKnowledgeText(ticket.subject, knowledgeNames(ticket, await listSupportMessages(dbFor(c.env), ticket.id)))
    : null;
  return c.json({ success: true, data: { ...serializeKnowledge(article), sourceSubject } });
});

opsKnowledge.put('/api/ops/knowledge/:id', requirePlatformAdminWrite(), async c => {
  const db = dbFor(c.env);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || !Number.isSafeInteger(body.version) || Number(body.version) < 1 ||
    typeof body.title !== 'string' || !body.title.trim() || body.title.length > 120 ||
    typeof body.question !== 'string' || body.question.length > 1000 ||
    typeof body.answer !== 'string' || body.answer.length > 12000 ||
    !HQ_SUPPORT_KINDS.some(value => value === body.kind) || !Array.isArray(body.keywords) ||
    body.keywords.length > 12 || body.keywords.some(word => typeof word !== 'string' || word.length > 40)) return c.json(invalid, 400);
  const before = await getKnowledgeArticle(db, c.req.param('id'));
  if (!before) return c.json({ success: false, error: '記事が見つかりません' }, 404);
  const ticket = await getSupportTicket(db, before.source_request_id);
  if (!ticket) return c.json(conflict, 409);
  const names = knowledgeNames(ticket, await listSupportMessages(db, ticket.id));
  const input: KnowledgeArticleInput = {
    title: redactKnowledgeText(body.title, names), question: redactKnowledgeText(body.question, names),
    answer: redactKnowledgeText(body.answer, names), kind: body.kind as KnowledgeArticleInput['kind'],
    keywords: (body.keywords as string[]).map(word => redactKnowledgeText(word, names)).filter(Boolean),
  };
  if (!input.title) return c.json(invalid, 400);
  if (!(await editKnowledgeArticle(db, before.id, Number(body.version), input))) return c.json(conflict, 409);
  const staff = c.get('staff');
  await recordPlatformAudit(db, { staffId: staff.id, staffName: staff.name, action: 'knowledge.update',
    detail: { articleId: before.id, version: before.version + 1 }, visibleToTenant: false });
  return c.json({ success: true, data: serializeKnowledge((await getKnowledgeArticle(db, before.id))!) });
});

opsKnowledge.post('/api/ops/knowledge/:id/review', requirePlatformAdminWrite(), async c => {
  const db = dbFor(c.env);
  const body = await c.req.json<{ action?: unknown; version?: unknown; confirmed?: unknown }>().catch(() => null);
  if (!body || !Number.isSafeInteger(body.version) || !['approve', 'dismiss', 'disable'].includes(String(body.action))) return c.json(invalid, 400);
  const article = await getKnowledgeArticle(db, c.req.param('id'));
  if (!article) return c.json({ success: false, error: '記事が見つかりません' }, 404);
  const action = body.action as 'approve' | 'dismiss' | 'disable';
  if (action === 'approve') {
    if (body.confirmed !== true || !article.question.trim() || !article.answer.trim()) return c.json(invalid, 400);
    const ticket = await getSupportTicket(db, article.source_request_id);
    const messages = ticket ? await listSupportMessages(db, ticket.id) : [];
    if (!ticket || !validateKnowledgeEvidence(JSON.parse(article.evidence), knowledgeSources(ticket, messages))) return c.json(conflict, 409);
  }
  const staff = c.get('staff');
  if (!(await reviewKnowledgeArticle(db, article.id, Number(body.version), action, staff.id))) return c.json(conflict, 409);
  await recordPlatformAudit(db, { staffId: staff.id, staffName: staff.name, action: 'knowledge.status',
    detail: { articleId: article.id, action, version: Number(body.version) + 1 }, visibleToTenant: false });
  return c.json({ success: true, data: serializeKnowledge((await getKnowledgeArticle(db, article.id))!) });
});

opsKnowledge.post('/api/ops/knowledge/:id/feedback', requirePlatformAdminWrite(), async c => {
  const body = await c.req.json<{ requestId?: unknown; feedback?: unknown }>().catch(() => null);
  if (!body || typeof body.requestId !== 'string' || (body.feedback !== 'helpful' && body.feedback !== 'unhelpful')) return c.json(invalid, 400);
  const db = dbFor(c.env);
  if (!(await knowledgeFeedback(db, c.req.param('id'), body.requestId, body.feedback))) return c.json(conflict, 409);
  const staff = c.get('staff');
  await recordPlatformAudit(db, { staffId: staff.id, staffName: staff.name, action: 'knowledge.feedback',
    detail: { articleId: c.req.param('id'), requestId: body.requestId, feedback: body.feedback }, visibleToTenant: false });
  return c.json({ success: true, data: null });
});

// Await on this dedicated request, not waitUntil (45s AI budget exceeds its 30s
// post-response lifetime). Resolution stays fast; no scheduled notification job runs.
opsKnowledge.post('/api/ops/knowledge/tickets/:id/process', requirePlatformAdminWrite(), async c => {
  const db = dbFor(c.env);
  const id = c.req.param('id');
  if (!(await getSupportTicket(db, id))) return c.json({ success: false, error: '問い合わせが見つかりません' }, 404);
  if (!c.env.AI) return c.json({ success: false, error: 'この環境では自動下書きを作成できません' }, 503);
  await processKnowledgeJob(c.env, id);
  const knowledge = await knowledgeForTicket(db, id);
  return c.json({ success: true, data: {
    article: knowledge.article ? serializeKnowledge(knowledge.article) : null,
    job: knowledge.job, canProcess: true,
  } });
});

opsKnowledge.post('/api/ops/knowledge/tickets/:id/retry', requirePlatformAdminWrite(), async c => {
  const db = dbFor(c.env);
  if (!(await retryKnowledgeJob(db, c.req.param('id')))) return c.json(conflict, 409);
  const staff = c.get('staff');
  await recordPlatformAudit(db, { staffId: staff.id, staffName: staff.name, action: 'knowledge.update',
    detail: { requestId: c.req.param('id'), operation: 'retry' }, visibleToTenant: false });
  return c.json({ success: true, data: null }, 202);
});
