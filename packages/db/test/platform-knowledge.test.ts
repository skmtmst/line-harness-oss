import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { asD1 } from './d1-test-helper.js';
import { createHqSupportRequest } from '../src/hq-support-requests.js';
import { addSupportTenantMessage, updateSupportTicket } from '../src/ops-support.js';
import {
  claimKnowledgeJob, finishKnowledgeJob, failKnowledgeJob, getKnowledgeArticle, knowledgeForTicket,
  reviewKnowledgeArticle, editKnowledgeArticle, searchKnowledge, recordKnowledgeUsage, knowledgeFeedback,
  knowledgeMetrics, recordPlatformAiCall, retryKnowledgeJob,
} from '../src/platform-knowledge.js';

let raw: Database.Database;
let db: D1Database;
let requestId: string;
beforeEach(async () => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.pragma('foreign_keys = ON');
  db = asD1(raw);
  raw.prepare(`INSERT INTO tenants (id,name) VALUES ('tenant','架空の契約先')`).run();
  raw.prepare(`INSERT INTO staff_members (id,name,role,api_key,tenant_id) VALUES ('operator','担当者','owner','test-only','tenant')`).run();
  const ticket = await createHqSupportRequest(db, { tenantId: 'tenant', staffId: 'operator', staffName: '利用者', staffEmail: null,
    kind: 'usage', subject: 'フォームのタグ', body: 'フォームの設定', lineAccountId: null, attachmentKeys: [] });
  requestId = ticket.id;
});
afterEach(() => raw.close());

const input = { title: 'フォームのタグ', question: 'どう設定するか', answer: '回答後の設定を確認した', kind: 'usage' as const, keywords: ['フォーム', 'タグ'] };
async function draft() {
  await updateSupportTicket(db, requestId, { stage: 'resolved' });
  const job = (await claimKnowledgeJob(db))!;
  await finishKnowledgeJob(db, job, { article: input, articleKind: 'verified', evidence: [
    { messageId: 'message-a', createdAt: '2026-09-19', authorKind: 'ops', quote: '設定してテストした', role: 'action' },
    { messageId: 'message-b', createdAt: '2026-09-19', authorKind: 'tenant', quote: 'タグの付与を確認しました', role: 'result' },
  ], reason: '確認待ち', reviewState: 'pending' });
  return (await knowledgeForTicket(db, requestId)).article!;
}

describe('knowledge lifecycle on real SQLite', () => {
  it('simultaneous resolution requests share one revision and one job', async () => {
    await Promise.all([
      updateSupportTicket(db, requestId, { stage: 'resolved' }),
      updateSupportTicket(db, requestId, { stage: 'resolved' }),
    ]);
    expect(raw.prepare('SELECT knowledge_revision FROM hq_support_requests WHERE id = ?').get(requestId))
      .toEqual({ knowledge_revision: 1 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM platform_knowledge_jobs').get()).toEqual({ n: 1 });
  });
  it('resolution queues exactly once; priority changes and retries do not duplicate it', async () => {
    await updateSupportTicket(db, requestId, { stage: 'resolved' });
    await updateSupportTicket(db, requestId, { stage: 'resolved', priority: 'high' });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM platform_knowledge_jobs').get()).toEqual({ n: 1 });
    expect(await claimKnowledgeJob(db)).not.toBeNull();
    expect(await claimKnowledgeJob(db)).toBeNull();
  });
  it('unapproved articles never enter retrieval; approval enables them', async () => {
    const article = await draft();
    expect(await searchKnowledge(db, 'usage', 'フォーム', [])).toEqual([]);
    expect(await reviewKnowledgeArticle(db, article.id, 1, 'approve', 'operator')).toBe(true);
    expect(await searchKnowledge(db, 'usage', 'フォーム', [])).toHaveLength(1);
    expect(await searchKnowledge(db, 'usage', 'フォーム', [article.id])).toEqual([]);
  });
  it('editing invalidates approval, and an old approval version is rejected', async () => {
    const article = await draft();
    await reviewKnowledgeArticle(db, article.id, 1, 'approve', 'operator');
    expect(await editKnowledgeArticle(db, article.id, 2, { ...input, answer: '修正した回答' }, 'answer_example', [])).toBe(true);
    expect(await reviewKnowledgeArticle(db, article.id, 2, 'approve', 'operator')).toBe(false);
    expect(await searchKnowledge(db, 'usage', 'フォーム', [])).toEqual([]);
    expect((await getKnowledgeArticle(db, article.id))?.review_state).toBe('pending');
  });
  it('retrieves Japanese words within a sentence but not unrelated articles of the same kind', async () => {
    const article = await draft();
    await reviewKnowledgeArticle(db, article.id, 1, 'approve', 'operator');
    expect((await searchKnowledge(db, 'bug', 'フォームに回答しましたがタグが付きません。', [])).map(a => a.id)).toEqual([article.id]);
    expect(await searchKnowledge(db, 'usage', '請求書の再発行をお願いします。', [])).toEqual([]);
    expect(await searchKnowledge(db, 'usage', '', [])).toEqual([]);
  });
  it('an unfit vote for one ticket does not demote or disable knowledge for another customer', async () => {
    const first = await draft();
    await reviewKnowledgeArticle(db, first.id, 1, 'approve', 'operator');
    const other = await createHqSupportRequest(db, { tenantId: 'tenant', staffId: 'operator', staffName: '利用者', staffEmail: null,
      kind: 'usage', subject: '別の問い合わせ', body: '設定の確認', lineAccountId: null, attachmentKeys: [] });
    raw.prepare("UPDATE hq_support_requests SET stage = 'resolved', knowledge_revision = 1 WHERE id = ?").run(other.id);
    raw.prepare(`INSERT INTO platform_knowledge_articles (id,source_request_id,source_revision,title,question,answer,kind,review_state,status,created_at,updated_at)
      VALUES ('zz-other',?,1,'フォームのタグ','どう設定するか','別の根拠','usage','approved','active','2026-09-21','2026-09-21')`).run(other.id);
    const before = await searchKnowledge(db, 'usage', 'フォーム', []);
    await recordKnowledgeUsage(db, before, requestId, 'operator');
    await knowledgeFeedback(db, before[0].id, requestId, 'unhelpful');
    expect((await searchKnowledge(db, 'usage', 'フォーム', [])).map(a => a.id)).toEqual(before.map(a => a.id));
    expect((await getKnowledgeArticle(db, before[0].id))?.status).toBe('active');
    expect((await searchKnowledge(db, 'usage', 'フォーム', [before[0].id])).map(a => a.id)).toEqual([before[1].id]);
  });
  it('reopening blocks retrieval AND approval before any background work runs', async () => {
    const article = await draft();
    await reviewKnowledgeArticle(db, article.id, 1, 'approve', 'operator');
    await addSupportTenantMessage(db, { requestId, staffId: 'operator', staffName: '利用者', body: '再発しました', attachmentKeys: [] });
    expect(await searchKnowledge(db, 'usage', 'フォーム', [])).toEqual([]);
    expect((await getKnowledgeArticle(db, article.id))?.source_current).toBe(0);
    await editKnowledgeArticle(db, article.id, 2, input, 'answer_example', []);
    expect(await reviewKnowledgeArticle(db, article.id, 3, 'approve', 'operator')).toBe(false);
  });
  it('late generation cannot publish against changed conversation', async () => {
    await updateSupportTicket(db, requestId, { stage: 'resolved' });
    const job = (await claimKnowledgeJob(db))!;
    await updateSupportTicket(db, requestId, { stage: 'in_progress' });
    await finishKnowledgeJob(db, job, { article: input, articleKind: 'answer_example', evidence: [], reason: '', reviewState: 'needs_review' });
    expect((await knowledgeForTicket(db, requestId)).article).toBeNull();
  });
  it('closing a resolved ticket preserves its approved evidence', async () => {
    const article = await draft();
    await reviewKnowledgeArticle(db, article.id, 1, 'approve', 'operator');
    await updateSupportTicket(db, requestId, { stage: 'closed' });
    expect(await searchKnowledge(db, 'usage', 'フォーム', [])).toHaveLength(1);
  });
  it('counts references and feedback idempotently', async () => {
    const article = await draft();
    await reviewKnowledgeArticle(db, article.id, 1, 'approve', 'operator');
    const candidates = await searchKnowledge(db, 'usage', 'フォーム', []);
    await recordKnowledgeUsage(db, candidates, requestId, 'operator');
    await recordKnowledgeUsage(db, candidates, requestId, 'operator');
    await knowledgeFeedback(db, article.id, requestId, 'helpful');
    await knowledgeFeedback(db, article.id, requestId, 'helpful');
    expect(await getKnowledgeArticle(db, article.id)).toMatchObject({ used_count: 1, helpful_count: 1, unhelpful_count: 0 });
    await knowledgeFeedback(db, article.id, requestId, 'unhelpful');
    expect(await getKnowledgeArticle(db, article.id)).toMatchObject({ helpful_count: 0, unhelpful_count: 1 });
  });
  it('lease expires after a crash, bounded failures allow explicit retry', async () => {
    await updateSupportTicket(db, requestId, { stage: 'resolved' });
    const first = (await claimKnowledgeJob(db, '2026-09-19T00:00:00Z'))!;
    const second = (await claimKnowledgeJob(db, '2026-09-19T00:06:00Z'))!;
    expect(second.id).toBe(first.id);
    await failKnowledgeJob(db, first, 'late'); // expired lease may not overwrite current owner
    expect(await claimKnowledgeJob(db, '2026-09-19T00:07:00Z')).toBeNull();
    await failKnowledgeJob(db, second, 'generation_failed');
    const third = (await claimKnowledgeJob(db))!;
    await failKnowledgeJob(db, third, 'generation_failed');
    expect(await claimKnowledgeJob(db)).toBeNull();
    expect(await retryKnowledgeJob(db, requestId)).toBe(true);
    expect(await claimKnowledgeJob(db)).not.toBeNull();
  });
  it('AI call accounting persists both failure and success without double count', async () => {
    const call = { id: 'call-1', purpose: 'draft' as const, requestId, staffId: 'operator', model: 'mock-model', durationMs: 1 };
    await recordPlatformAiCall(db, { ...call, ok: false });
    await recordPlatformAiCall(db, { ...call, ok: true });
    expect(await knowledgeMetrics(db, '2000-01-01', '2100-01-01')).toMatchObject({ callsThisMonth: 1, draftsThisMonth: 1, articlesActive: 0 });
  });
});
