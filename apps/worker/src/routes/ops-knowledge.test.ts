import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  createHqSupportRequest, addSupportReply, addSupportTenantMessage, updateSupportTicket,
  knowledgeForTicket, searchKnowledge,
} from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import { processKnowledgeJob } from '../services/platform-knowledge.js';
import { opsKnowledge } from './ops-knowledge.js';

let store: SqliteD1;
let requestId: string;
let run: ReturnType<typeof vi.fn>;
const action = '管理画面で配信対象の設定を変更しました。';
const result = '再送したところ正常に配信できました。';
function environment() { return { DB: store.db, AI: { run } } as unknown as Env['Bindings']; }
function request(path: string, body?: unknown, actor = 'master', readOnly = false, method = 'POST') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', { id: actor, name: '架空担当者', role: 'owner', readOnly, tenantId: 'tenant' }); await next(); });
  app.route('/', opsKnowledge);
  return app.request(path, body === undefined ? undefined : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, environment());
}
beforeEach(async () => {
  store = createTestD1({ foreignKeys: true });
  store.raw.prepare("INSERT INTO tenants(id,name) VALUES ('tenant','架空契約先')").run();
  for (const id of ['master', 'tenant-owner']) store.raw.prepare("INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES (?,?,'owner',?,'tenant')").run(id, '架空担当者', `fixture-${id}`);
  store.raw.prepare("INSERT INTO platform_admins(staff_id,is_active) VALUES ('master',1)").run();
  const ticket = await createHqSupportRequest(store.db, { tenantId: 'tenant', staffId: 'tenant-owner', staffName: '架空担当者', staffEmail: null, kind: 'usage', subject: '配信対象の設定', body: '設定を確認したいです。', lineAccountId: null, attachmentKeys: [] });
  requestId = ticket.id;
  const first = await addSupportReply(store.db, { requestId, authorStaffId: 'master', authorName: '架空担当者', body: action, aiAssisted: false, deliveredVia: [], nextStage: 'waiting' });
  const last = await addSupportTenantMessage(store.db, { requestId, staffId: 'tenant-owner', staffName: '架空担当者', body: result, attachmentKeys: [] });
  // Separate real conversation events explicitly; wall-clock speed and random
  // UUID ordering must not decide whether this fixture has a confirmed result.
  store.raw.prepare('UPDATE hq_support_messages SET created_at = ? WHERE id = ?').run('2026-09-19T10:00:00.000+09:00', first.id);
  store.raw.prepare('UPDATE hq_support_messages SET created_at = ? WHERE id = ?').run('2026-09-19T10:01:00.000+09:00', last.id);
  await updateSupportTicket(store.db, requestId, { stage: 'resolved' });
  run = vi.fn().mockResolvedValue({ response: JSON.stringify({ decision: 'confirmed', title: '配信対象の確認', question: '配信対象を直すには', keywords: ['配信'], evidence: [
    { messageId: first.id, quote: action, role: 'action' }, { messageId: last.id, quote: result, role: 'result' },
  ] }) });
});
afterEach(() => store.raw.close());

describe('運営専用ナレッジ（実SQLite・AIはモック）', () => {
  it('同時刻の会話はUUIDの並びで解決済みと判断せず要確認にする', async () => {
    store.raw.prepare('UPDATE hq_support_messages SET created_at = ? WHERE request_id = ?').run('2026-09-19T10:00:00.000+09:00', requestId);
    await processKnowledgeJob(environment());
    expect((await knowledgeForTicket(store.db, requestId)).article).toMatchObject({ review_state: 'needs_review', answer: '' });
    expect(await searchKnowledge(store.db, 'usage', '配信', [])).toEqual([]);
  });
  it('自動下書き→確認→承認で初めて検索され、編集で承認が失効する', async () => {
    await processKnowledgeJob(environment());
    const article = (await knowledgeForTicket(store.db, requestId)).article!;
    expect(article.review_state).toBe('pending');
    expect(await searchKnowledge(store.db, 'usage', '配信', [])).toEqual([]);
    const url = `/api/ops/knowledge/${article.id}`;
    expect((await request(`${url}/review`, { version: 1, action: 'approve' })).status).toBe(400);
    expect((await request(`${url}/review`, { version: 1, action: 'approve', confirmed: true })).status).toBe(200);
    expect(await searchKnowledge(store.db, 'usage', '配信', [])).toHaveLength(1);
    expect((await request(url, { version: 2, title: '配信対象', question: '配信設定', answer: '対応結果を確認する', kind: 'usage', keywords: [] }, 'master', false, 'PUT')).status).toBe(200);
    expect(await searchKnowledge(store.db, 'usage', '配信', [])).toEqual([]);
    expect((await request(`${url}/review`, { version: 2, action: 'approve', confirmed: true })).status).toBe(409);
  });
  it('統括オーナーは読めず、閲覧専用の運営者は書けない', async () => {
    await processKnowledgeJob(environment());
    const article = (await knowledgeForTicket(store.db, requestId)).article!;
    expect((await request('/api/ops/knowledge', undefined, 'tenant-owner')).status).toBe(403);
    expect((await request(`/api/ops/knowledge/${article.id}`, undefined, 'tenant-owner')).status).toBe(403);
    expect((await request(`/api/ops/knowledge/${article.id}/review`, { version: 1, action: 'approve', confirmed: true }, 'master', true)).status).toBe(403);
  });
  it('成功根拠を捏造したAI出力は回答を空にして要確認にする', async () => {
    run.mockResolvedValue({ response: JSON.stringify({ decision: 'confirmed', title: '捏造', question: '捏造', evidence: [
      { messageId: 'unknown', quote: action, role: 'action' }, { messageId: 'unknown', quote: result, role: 'result' },
    ] }) });
    await processKnowledgeJob(environment());
    expect((await knowledgeForTicket(store.db, requestId)).article).toMatchObject({ review_state: 'needs_review', answer: '', evidence: '[]' });
    expect(await searchKnowledge(store.db, 'usage', '配信', [])).toEqual([]);
  });
  it('生成中の再オープンは古い生成結果を破棄する', async () => {
    const response = await run();
    run.mockImplementation(async () => { await updateSupportTicket(store.db, requestId, { stage: 'in_progress' }); return response; });
    await processKnowledgeJob(environment());
    expect((await knowledgeForTicket(store.db, requestId)).article).toBeNull();
  });
  it('AI障害でも解決状態を戻さず、原文をログや失敗理由に残さない', async () => {
    const logger = vi.spyOn(console, 'error');
    run.mockRejectedValue(new Error('provider echoed private conversation'));
    await processKnowledgeJob(environment());
    expect((await knowledgeForTicket(store.db, requestId)).job?.status).toBe('queued');
    expect(store.raw.prepare('SELECT stage FROM hq_support_requests WHERE id = ?').get(requestId)).toEqual({ stage: 'resolved' });
    expect(store.raw.prepare('SELECT error_code FROM platform_knowledge_jobs').get()).toEqual({ error_code: 'generation_failed' });
    expect(logger).not.toHaveBeenCalled();
    logger.mockRestore();
  });
  it('同じ解決の再処理は重複生成せず、利用回数を一度だけ記録する', async () => {
    await processKnowledgeJob(environment());
    await processKnowledgeJob(environment());
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.raw.prepare('SELECT count(*) AS n FROM platform_ai_calls').get()).toEqual({ n: 1 });
    expect(store.raw.prepare('SELECT count(*) AS n FROM platform_knowledge_articles').get()).toEqual({ n: 1 });
  });
});
