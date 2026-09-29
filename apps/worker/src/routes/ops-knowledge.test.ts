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
function request(path: string, body?: unknown, actor = 'master', readOnly = false, method = 'POST', env = environment()) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', { id: actor, name: '架空担当者', role: 'owner', readOnly, tenantId: 'tenant' }); await next(); });
  app.route('/', opsKnowledge);
  return app.request(path, body === undefined ? undefined : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
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
  it('元の問い合わせ件名を返す際も名前とメールを匿名化する', async () => {
    await processKnowledgeJob(environment());
    store.raw.prepare('UPDATE hq_support_requests SET subject = ? WHERE id = ?')
      .run('架空契約先 架空担当者 demo@example.com 配信対象の設定', requestId);
    const article = (await knowledgeForTicket(store.db, requestId)).article!;
    const res = await request(`/api/ops/knowledge/${article.id}`);
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { sourceSubject: string } }).data.sourceSubject)
      .toBe('[匿名] [匿名] [メール] 配信対象の設定');
  });
  it('同時刻の会話はUUIDの並びで解決済みと判断せず要確認にする', async () => {
    store.raw.prepare('UPDATE hq_support_messages SET created_at = ? WHERE request_id = ?').run('2026-09-19T10:00:00.000+09:00', requestId);
    await processKnowledgeJob(environment());
    expect((await knowledgeForTicket(store.db, requestId)).article).toMatchObject({
      article_kind: 'answer_example', review_state: 'pending', answer: action,
      review_reason: 'お客様の成功確認はありません。回答内容を確認して承認してください。',
    });
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
    expect((await knowledgeForTicket(store.db, requestId)).article).toMatchObject({
      article_kind: 'answer_example', review_state: 'pending', question: '設定を確認したいです。', answer: action,
    });
    expect(await searchKnowledge(store.db, 'usage', '配信', [])).toEqual([]);
  });
  it('回答例は元のやり取りを人が確認し、質問と答えがあれば承認できる', async () => {
    run.mockResolvedValue({ response: JSON.stringify({ decision: 'needs_review', title: '配信対象の回答例', keywords: ['配信'] }) });
    await processKnowledgeJob(environment());
    const article = (await knowledgeForTicket(store.db, requestId)).article!;
    expect(article).toMatchObject({ article_kind: 'answer_example', review_state: 'pending', status: 'disabled' });
    const url = `/api/ops/knowledge/${article.id}`;
    expect((await request(`${url}/review`, { version: 1, action: 'approve' })).status).toBe(400);
    expect((await request(`${url}/review`, { version: 1, action: 'approve', confirmed: true })).status).toBe(200);
    expect((await knowledgeForTicket(store.db, requestId)).article).toMatchObject({ review_state: 'approved', status: 'active' });
    expect(await searchKnowledge(store.db, 'usage', '配信', [])).toHaveLength(1);
    const audit = store.raw.prepare("SELECT detail FROM platform_audit_logs WHERE action = 'knowledge.status' ORDER BY created_at DESC LIMIT 1").get() as { detail: string };
    expect(JSON.parse(audit.detail)).toMatchObject({ articleKind: 'answer_example', action: 'approve' });
  });
  it('質問か答えが空の回答例は承認できず、編集後は回答例として承認待ちになる', async () => {
    await processKnowledgeJob(environment());
    const article = (await knowledgeForTicket(store.db, requestId)).article!;
    const url = `/api/ops/knowledge/${article.id}`;
    const edited = await request(url, { version: 1, title: '配信対象', question: '質問', answer: '', kind: 'usage', keywords: [] }, 'master', false, 'PUT');
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ data: { articleKind: 'answer_example', reviewState: 'pending' } });
    expect((await request(`${url}/review`, { version: 2, action: 'approve', confirmed: true })).status).toBe(400);
  });
  it('運営返信が無い要確認の記事は、答えを手で書けば回答例として承認できる', async () => {
    const noReply = await createHqSupportRequest(store.db, { tenantId: 'tenant', staffId: 'tenant-owner', staffName: '架空担当者', staffEmail: null,
      kind: 'usage', subject: '管理者の追加', body: '管理者を追加したいです。', lineAccountId: null, attachmentKeys: [] });
    await updateSupportTicket(store.db, noReply.id, { stage: 'resolved' });
    await processKnowledgeJob(environment(), noReply.id);
    const article = (await knowledgeForTicket(store.db, noReply.id)).article!;
    expect(article).toMatchObject({ article_kind: 'answer_example', review_state: 'needs_review', question: '管理者を追加したいです。', answer: '' });
    const url = `/api/ops/knowledge/${article.id}`;
    const saved = await request(url, { version: 1, title: article.title, question: article.question,
      answer: 'メンバー管理から招待してください。', kind: 'usage', keywords: [] }, 'master', false, 'PUT');
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ data: { articleKind: 'answer_example', reviewState: 'needs_review' } });
    expect((await request(`${url}/review`, { version: 2, action: 'approve', confirmed: true })).status).toBe(200);
  });
  it('記事の種類で一覧を絞り込める', async () => {
    await processKnowledgeJob(environment());
    const verified = await request('/api/ops/knowledge?articleKind=verified', undefined, 'master', false, 'GET');
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ total: 1, data: [{ articleKind: 'verified' }] });
    const examples = await request('/api/ops/knowledge?articleKind=answer_example', undefined, 'master', false, 'GET');
    expect(await examples.json()).toMatchObject({ total: 0, data: [] });
    expect((await request('/api/ops/knowledge?articleKind=unknown', undefined, 'master', false, 'GET')).status).toBe(400);
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
    expect(logger).toHaveBeenCalledWith('[knowledge] generation failed', { name: 'Error' });
    expect(JSON.stringify(logger.mock.calls)).not.toContain('provider echoed private conversation');
    logger.mockRestore();
  });
  it('同じ解決の再処理は重複生成せず、利用回数を一度だけ記録する', async () => {
    await processKnowledgeJob(environment());
    await processKnowledgeJob(environment());
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.raw.prepare('SELECT count(*) AS n FROM platform_ai_calls').get()).toEqual({ n: 1 });
    expect(store.raw.prepare('SELECT count(*) AS n FROM platform_knowledge_articles').get()).toEqual({ n: 1 });
  });

  it('CronなしのHTTP実行でも対象だけを下書きにし、別の予約には触らない', async () => {
    const other = await createHqSupportRequest(store.db, { tenantId: 'tenant', staffId: 'tenant-owner', staffName: '架空担当者', staffEmail: null, kind: 'usage', subject: '別件', body: '別の問い合わせです', lineAccountId: null, attachmentKeys: [] });
    await updateSupportTicket(store.db, other.id, { stage: 'resolved' });
    // The unrelated job is deliberately older than the requested job.
    store.raw.prepare("UPDATE platform_knowledge_jobs SET created_at = '2020-01-01' WHERE request_id = ?").run(other.id);
    const res = await request(`/api/ops/knowledge/tickets/${requestId}/process`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { canProcess: true, job: { status: 'done' }, article: { reviewState: 'pending' } } });
    expect((await knowledgeForTicket(store.db, other.id)).job?.status).toBe('queued');
    expect(await searchKnowledge(store.db, 'usage', '配信', [])).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('実行口は運営書込権限必須で、存在しない問い合わせも処理しない', async () => {
    const url = `/api/ops/knowledge/tickets/${requestId}/process`;
    expect((await request(url, {}, 'tenant-owner')).status).toBe(403);
    expect((await request(url, {}, 'master', true)).status).toBe(403);
    expect((await request('/api/ops/knowledge/tickets/missing/process', {})).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it('同時に実行要求が来てもリース中はAIを重複実行しない', async () => {
    const response = await run(); run.mockClear();
    let finish!: (value: unknown) => void;
    run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const url = `/api/ops/knowledge/tickets/${requestId}/process`;
    const first = request(url, {});
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(await (await request(url, {})).json()).toMatchObject({ data: { job: { status: 'running' } } });
    finish(response);
    expect((await first).status).toBe(200);
    await request(url, {});
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('切断後の期限切れリースを再開し、3回目の中断は再試行ボタンを出せる状態にする', async () => {
    store.raw.prepare("UPDATE platform_knowledge_jobs SET status='running', attempts=1, lease_token='interrupted', lease_until='2020-01-01'").run();
    const url = `/api/ops/knowledge/tickets/${requestId}/process`;
    expect((await request(url, {})).status).toBe(200);
    expect((await knowledgeForTicket(store.db, requestId)).job).toMatchObject({ status: 'done', attempts: 2 });
    store.raw.prepare("UPDATE platform_knowledge_jobs SET status='running', attempts=3, lease_token='interrupted', lease_until='2020-01-01'").run();
    expect((await knowledgeForTicket(store.db, requestId)).job?.status).toBe('failed');
    expect((await request(`/api/ops/knowledge/tickets/${requestId}/retry`, {})).status).toBe(202);
  });

  it('AI失敗は最大3回で止まり、解決状態と人の承認条件を変えない', async () => {
    run.mockRejectedValue(new Error('private provider detail'));
    const url = `/api/ops/knowledge/tickets/${requestId}/process`;
    for (let i = 0; i < 4; i++) expect((await request(url, {})).status).toBe(200);
    expect(run).toHaveBeenCalledTimes(3);
    expect((await knowledgeForTicket(store.db, requestId)).job?.status).toBe('failed');
    expect((await knowledgeForTicket(store.db, requestId)).article).toBeNull();
  });

  it('AI未設定は503で返し、生成予約の試行回数を消費しない', async () => {
    const env = environment(); delete env.AI;
    expect((await request(`/api/ops/knowledge/tickets/${requestId}/process`, {}, 'master', false, 'POST', env)).status).toBe(503);
    expect((await knowledgeForTicket(store.db, requestId)).job).toMatchObject({ status: 'queued', attempts: 0 });
    expect(run).not.toHaveBeenCalled();
  });

  it('HTTP実行の時間切れも予約を残し、遅れて返るAI結果を記事にしない', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: unknown) => void;
      run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
      const pending = request(`/api/ops/knowledge/tickets/${requestId}/process`, {});
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(45_000);
      expect((await pending).status).toBe(200);
      expect((await knowledgeForTicket(store.db, requestId)).job?.status).toBe('queued');
      finish({ response: '{}' });
      await Promise.resolve();
      expect((await knowledgeForTicket(store.db, requestId)).article).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
