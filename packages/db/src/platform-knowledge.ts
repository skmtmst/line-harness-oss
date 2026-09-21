import { jstNow } from './utils.js';
import type { HqSupportKind } from './hq-support-requests.js';

export type KnowledgeReviewState = 'pending' | 'approved' | 'needs_review' | 'dismissed';
export interface KnowledgeEvidence {
  messageId: string; createdAt: string; authorKind: 'tenant' | 'ops';
  quote: string; role: 'action' | 'result' | 'condition';
}
export interface KnowledgeArticleInput {
  title: string; question: string; answer: string; kind: HqSupportKind; keywords: string[];
}
export interface KnowledgeArticle extends Omit<KnowledgeArticleInput, 'keywords'> {
  id: string; keywords: string; visibility: 'ops_only'; source_request_id: string; source_revision: number;
  review_state: KnowledgeReviewState; status: 'active' | 'disabled'; evidence: string; review_reason: string;
  version: number; approved_by_staff_id: string | null; approved_at: string | null;
  used_count: number; helpful_count: number; unhelpful_count: number; created_at: string; updated_at: string;
  source_current: number; ticket_no: number | null;
}
export interface KnowledgeJob {
  id: string; request_id: string; source_revision: number; attempts: number;
  status: 'queued' | 'running' | 'done' | 'failed' | 'stale'; lease_token: string | null;
}

const CURRENT = `r.knowledge_revision = a.source_revision AND r.stage IN ('resolved','closed')`;
const SELECT = `SELECT a.*, CASE WHEN ${CURRENT} THEN 1 ELSE 0 END AS source_current, r.ticket_no
  FROM platform_knowledge_articles a JOIN hq_support_requests r ON r.id = a.source_request_id`;
const USABLE = `${CURRENT} AND a.review_state = 'approved' AND a.status = 'active'`;

/** Retrieval is about this conversation, not a global popularity/quality vote. */
export async function searchKnowledge(db: D1Database, kind: string, text: string, exclude: string[]): Promise<KnowledgeArticle[]> {
  const segments = new Intl.Segmenter('ja', { granularity: 'word' }).segment(text.normalize('NFKC').toLowerCase());
  const stopWords = new Set(['です', 'ます', 'した', 'して', 'する', 'いる', 'ある', 'ない', 'こと', 'ため', 'ください', 'ました', 'ません', '匿名', 'メール', '担当者', 'ご担当']);
  const words = [...new Set([...segments].filter(s => s.isWordLike && s.segment.length >= 2 && !stopWords.has(s.segment)).map(s => s.segment))].slice(0, 20);
  if (!words.length) return [];
  const matches = words.length ? words.map(() => `CASE WHEN instr(lower(a.title || ' ' || a.question || ' ' || a.keywords), ?) > 0 THEN 1 ELSE 0 END`).join(' + ') : '0';
  const excluded = exclude.slice(0, 50);
  const result = await db.prepare(`${SELECT} WHERE ${USABLE}
    AND (${matches}) > 0 ${excluded.length ? `AND a.id NOT IN (${excluded.map(() => '?').join(',')})` : ''}
    ORDER BY (${matches}) DESC, CASE WHEN a.kind = ? THEN 0 ELSE 1 END, a.id LIMIT 5`)
    .bind(...words, ...excluded, ...words, kind).all<KnowledgeArticle>();
  return result.results;
}

function recountUsage(db: D1Database, id: string) {
  return db.prepare(`UPDATE platform_knowledge_articles SET used_count = (SELECT COUNT(*) FROM platform_knowledge_usage WHERE article_id = ?),
    helpful_count = (SELECT COUNT(*) FROM platform_knowledge_usage WHERE article_id = ? AND article_version = platform_knowledge_articles.version AND feedback = 'helpful'),
    unhelpful_count = (SELECT COUNT(*) FROM platform_knowledge_usage WHERE article_id = ? AND article_version = platform_knowledge_articles.version AND feedback = 'unhelpful') WHERE id = ?`)
    .bind(id, id, id, id);
}

export async function recordKnowledgeUsage(db: D1Database, articles: KnowledgeArticle[], requestId: string, staffId: string): Promise<void> {
  if (!articles.length) return;
  await db.batch(articles.flatMap(a => [
    db.prepare(`INSERT INTO platform_knowledge_usage (id, article_id, article_version, request_id, staff_id, created_at)
      SELECT ?, a.id, a.version, ?, ?, ? FROM platform_knowledge_articles a
      JOIN hq_support_requests r ON r.id = a.source_request_id WHERE a.id = ? AND a.version = ? AND ${USABLE}
      ON CONFLICT(article_id, request_id) DO UPDATE SET article_version = excluded.article_version,
      staff_id = excluded.staff_id, feedback = CASE WHEN platform_knowledge_usage.article_version = excluded.article_version
      THEN platform_knowledge_usage.feedback ELSE NULL END`)
      .bind(crypto.randomUUID(), requestId, staffId, jstNow(), a.id, a.version),
    recountUsage(db, a.id),
  ]));
}

export async function knowledgeFeedback(db: D1Database, articleId: string, requestId: string, feedback: 'helpful' | 'unhelpful'): Promise<boolean> {
  const results = await db.batch([
    db.prepare(`UPDATE platform_knowledge_usage SET feedback = ? WHERE article_id = ? AND request_id = ?
      AND article_version = (SELECT version FROM platform_knowledge_articles WHERE id = ?)`)
      .bind(feedback, articleId, requestId, articleId),
    recountUsage(db, articleId),
  ]);
  return results[0].meta.changes === 1;
}

export async function recordPlatformAiCall(db: D1Database, input: { id: string; purpose: 'draft' | 'article'; requestId: string; staffId?: string; model: string; ok: boolean; durationMs: number }) {
  await db.prepare(`INSERT INTO platform_ai_calls (id,purpose,request_id,staff_id,model,ok,duration_ms,created_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ok = excluded.ok, duration_ms = excluded.duration_ms`)
    .bind(input.id, input.purpose, input.requestId, input.staffId ?? null, input.model, input.ok ? 1 : 0, input.durationMs, jstNow()).run();
}

export async function knowledgeMetrics(db: D1Database, from: string, to: string) {
  const calls = await db.prepare(`SELECT COUNT(*) AS calls, SUM(CASE WHEN purpose = 'draft' THEN 1 ELSE 0 END) AS drafts
    FROM platform_ai_calls WHERE julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?)`)
    .bind(from, to).first<{ calls: number; drafts: number | null }>();
  const active = await db.prepare(`SELECT COUNT(*) AS n FROM platform_knowledge_articles a
    JOIN hq_support_requests r ON r.id = a.source_request_id WHERE ${USABLE}`).first<{ n: number }>();
  return { callsThisMonth: calls?.calls ?? 0, draftsThisMonth: calls?.drafts ?? 0, articlesActive: active?.n ?? 0 };
}

/** Atomic with successful resolution; no AI call in the request. */
export function queueKnowledgeStatement(db: D1Database, requestId: string): D1PreparedStatement {
  const now = jstNow();
  return db.prepare(`INSERT OR IGNORE INTO platform_knowledge_jobs
    (id, request_id, source_revision, created_at, updated_at)
    SELECT ?, id, knowledge_revision, ?, ? FROM hq_support_requests WHERE id = ? AND stage = 'resolved'`)
    .bind(crypto.randomUUID(), now, now, requestId);
}

export async function claimKnowledgeJob(db: D1Database, now = jstNow()): Promise<KnowledgeJob | null> {
  const lease = new Date(Date.parse(now) + 5 * 60_000).toISOString();
  return db.prepare(`UPDATE platform_knowledge_jobs SET status = 'running', attempts = attempts + 1,
      lease_token = ?, lease_until = ?, updated_at = ?
    WHERE id = (SELECT j.id FROM platform_knowledge_jobs j JOIN hq_support_requests r ON r.id = j.request_id
      WHERE j.source_revision = r.knowledge_revision AND r.stage IN ('resolved','closed') AND j.attempts < 3
        AND (j.status = 'queued' OR (j.status = 'running' AND julianday(j.lease_until) < julianday(?)))
      ORDER BY j.created_at, j.id LIMIT 1)
    RETURNING *`).bind(crypto.randomUUID(), lease, now, now).first<KnowledgeJob>();
}

export async function finishKnowledgeJob(db: D1Database, job: KnowledgeJob, input: {
  article: KnowledgeArticleInput; evidence: KnowledgeEvidence[]; reason: string; reviewState: 'pending' | 'needs_review';
}): Promise<void> {
  const now = jstNow();
  const articleId = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO platform_knowledge_articles
      (id, source_request_id, source_revision, title, question, answer, kind, keywords, review_state,
       evidence, review_reason, created_at, updated_at)
      SELECT ?, j.request_id, j.source_revision, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM platform_knowledge_jobs j JOIN hq_support_requests r ON r.id = j.request_id
       WHERE j.id = ? AND j.lease_token = ? AND j.status = 'running'
         AND j.source_revision = r.knowledge_revision AND r.stage IN ('resolved','closed')`)
      .bind(articleId, input.article.title, input.article.question, input.article.answer, input.article.kind,
        JSON.stringify(input.article.keywords), input.reviewState, JSON.stringify(input.evidence), input.reason, now, now, job.id, job.lease_token),
    db.prepare(`INSERT INTO platform_audit_logs (id,staff_id,staff_name,action,detail,visible_to_tenant,created_at)
      SELECT ?, 'system:knowledge', '自動処理', 'ai.article_suggest', ?, 0, ?
      WHERE EXISTS (SELECT 1 FROM platform_knowledge_articles WHERE id = ?)`)
      .bind(crypto.randomUUID(), JSON.stringify({ articleId, requestId: job.request_id, reviewState: input.reviewState }), now, articleId),
    db.prepare(`UPDATE platform_knowledge_jobs SET status = CASE WHEN EXISTS (
      SELECT 1 FROM hq_support_requests r WHERE r.id = request_id AND r.knowledge_revision = source_revision
      AND r.stage IN ('resolved','closed')) THEN 'done' ELSE 'stale' END, lease_token = NULL, updated_at = ?
      WHERE id = ? AND lease_token = ?`).bind(now, job.id, job.lease_token),
  ]);
}

export async function failKnowledgeJob(db: D1Database, job: KnowledgeJob, code: string): Promise<void> {
  await db.prepare(`UPDATE platform_knowledge_jobs SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
    error_code = ?, lease_token = NULL, updated_at = ? WHERE id = ? AND lease_token = ?`)
    .bind(code, jstNow(), job.id, job.lease_token).run();
}

export async function getKnowledgeArticle(db: D1Database, id: string): Promise<KnowledgeArticle | null> {
  return db.prepare(`${SELECT} WHERE a.id = ?`).bind(id).first<KnowledgeArticle>();
}

export async function listKnowledgeArticles(db: D1Database, input: { q?: string; kind?: string; state?: string; offset?: number }) {
  const conditions: string[] = [];
  const binds: (string | number)[] = [];
  if (input.q) {
    conditions.push(`instr(lower(a.title || ' ' || a.question || ' ' || a.keywords), lower(?)) > 0`);
    binds.push(input.q.slice(0, 200));
  }
  if (input.kind) { conditions.push('a.kind = ?'); binds.push(input.kind); }
  if (input.state === 'needs_review') conditions.push(`(a.review_state = 'needs_review' OR NOT (${CURRENT}))`);
  else if (input.state) { conditions.push(`a.review_state = ? AND (${CURRENT})`); binds.push(input.state); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM platform_knowledge_articles a
    JOIN hq_support_requests r ON r.id = a.source_request_id ${where}`).bind(...binds).first<{ n: number }>();
  const rows = await db.prepare(`${SELECT} ${where} ORDER BY a.updated_at DESC, a.id LIMIT 50 OFFSET ?`)
    .bind(...binds, Math.max(0, input.offset ?? 0)).all<KnowledgeArticle>();
  return { articles: rows.results, total: count?.n ?? 0 };
}

export async function editKnowledgeArticle(db: D1Database, id: string, version: number, input: KnowledgeArticleInput): Promise<boolean> {
  const r = await db.prepare(`UPDATE platform_knowledge_articles SET title = ?, question = ?, answer = ?, kind = ?,
      keywords = ?, review_state = CASE WHEN review_state = 'needs_review' THEN 'needs_review' ELSE 'pending' END,
      status = 'disabled', approved_by_staff_id = NULL, approved_at = NULL, version = version + 1, updated_at = ?
    WHERE id = ? AND version = ?`).bind(input.title, input.question, input.answer, input.kind, JSON.stringify(input.keywords), jstNow(), id, version).run();
  return r.meta.changes === 1;
}

export async function reviewKnowledgeArticle(db: D1Database, id: string, version: number, action: 'approve' | 'dismiss' | 'disable', staffId: string): Promise<boolean> {
  const now = jstNow();
  const condition = action === 'approve' ? `AND review_state = 'pending' AND json_array_length(evidence) >= 2
    AND EXISTS (SELECT 1 FROM hq_support_requests r WHERE r.id = source_request_id
      AND r.knowledge_revision = source_revision AND r.stage IN ('resolved','closed'))` : '';
  const result = await db.prepare(`UPDATE platform_knowledge_articles SET
    review_state = ?, status = ?, approved_by_staff_id = ?, approved_at = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND version = ? ${condition}`)
    .bind(action === 'approve' ? 'approved' : action === 'dismiss' ? 'dismissed' : 'pending',
      action === 'approve' ? 'active' : 'disabled', action === 'approve' ? staffId : null,
      action === 'approve' ? now : null, now, id, version).run();
  return result.meta.changes === 1;
}

export async function knowledgeForTicket(db: D1Database, requestId: string) {
  const article = await db.prepare(`${SELECT} WHERE a.source_request_id = ? ORDER BY a.source_revision DESC LIMIT 1`)
    .bind(requestId).first<KnowledgeArticle>();
  const job = await db.prepare(`SELECT j.id, j.status, j.attempts,
    CASE WHEN j.source_revision = r.knowledge_revision AND r.stage IN ('resolved','closed') THEN 1 ELSE 0 END AS source_current
    FROM platform_knowledge_jobs j JOIN hq_support_requests r ON r.id = j.request_id
    WHERE j.request_id = ? ORDER BY j.source_revision DESC LIMIT 1`).bind(requestId)
    .first<{ id: string; status: string; attempts: number; source_current: number }>();
  return { article, job };
}

export async function retryKnowledgeJob(db: D1Database, requestId: string): Promise<boolean> {
  const result = await db.prepare(`UPDATE platform_knowledge_jobs SET status = 'queued', attempts = 0, lease_token = NULL,
    error_code = NULL, updated_at = ? WHERE request_id = ? AND (status = 'failed' OR
      (status = 'running' AND julianday(lease_until) < julianday(?) AND attempts >= 3))
    AND EXISTS (SELECT 1 FROM hq_support_requests r WHERE r.id = request_id AND r.knowledge_revision = source_revision
      AND r.stage IN ('resolved','closed'))`).bind(jstNow(), requestId, jstNow()).run();
  return result.meta.changes === 1;
}
