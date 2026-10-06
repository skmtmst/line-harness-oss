import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { appendFormSubmitClaimStep, createFormSubmitClaim, getFormSubmitClaim, type FormSubmitClaimScope } from '@line-crm/db';
vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn() }));
const { forms } = await import('./forms.js');
let db: SqliteD1;
const scope: FormSubmitClaimScope = { tenantId: '', lineAccountId: 'a1', formId: 'form1', friendId: 'f1', key: 'test-key' };
beforeEach(() => {
  db = createTestD1();
  db.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('a1', 'test-channel', '試験', 'fixture-token', 'fixture-secret')`).run();
  db.raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('f1', 'U-test', 'a1')`).run();
  db.raw.prepare(`INSERT INTO forms (id, name, save_to_metadata) VALUES ('form1', '試験フォーム', 0)`).run();
  db.raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form1', 'a1')`).run();
  db.raw.prepare(`INSERT INTO form_submissions (id, form_id, friend_id, data) VALUES ('s1', 'form1', 'f1', '{}')`).run();
});
afterEach(() => { vi.useRealTimers(); db.raw.close(); });
async function claim() {
  return createFormSubmitClaim(db.db, { ...scope, requestHash: 'fixture-hash', submissionId: 's1',
    owner: 'test-owner', expiresAt: '2999-01-01T00:00:00Z' });
}
function app() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'owner-test', name: '試験', role: 'owner', readOnly: false });
    await next();
  });
  app.route('/', forms);
  return app;
}
const get = (path = '/api/forms/form1/submissions/s1?account_id=a1') => app().request(path, {}, { DB: db.db });
describe('フォームの済んだ工程と完了日時', () => {
  test('未完と済みを一緒に返し、工程ごとの日時を保存する', async () => {
    await claim();
    await appendFormSubmitClaimStep(db.db, scope, 'test-owner', 'answer', 1);
    db.raw.prepare(`UPDATE form_submit_claims SET status = 'failed'`).run();
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { postActions: { pending: string[]; completed: { step: string; completedAt: string }[] } } };
    expect(body.data.postActions.pending).toContain('reply');
    expect(body.data.postActions.pending).not.toContain('answer');
    expect(body.data.postActions.completed).toEqual([{ step: 'answer', completedAt: expect.any(String) }]);
    expect(Number.isFinite(Date.parse(body.data.postActions.completed[0].completedAt))).toBe(true);
  });
  test('全部完了した回答にも済みを返し、未完は空にする', async () => {
    await claim();
    await appendFormSubmitClaimStep(db.db, scope, 'test-owner', 'answer', 1);
    await appendFormSubmitClaimStep(db.db, scope, 'test-owner', 'reply', 1);
    db.raw.prepare(`UPDATE form_submit_claims SET status = 'completed'`).run();
    expect(await (await get()).json()).toMatchObject({ data: { postActions: {
      state: 'completed', pending: [], completed: [{ step: 'answer' }, { step: 'reply' }],
    } } });
  });
  test('過去の済みの日時を推測せずnull、記録なしは空にする', async () => {
    expect(await (await get()).json()).toMatchObject({ data: { postActions: { state: 'untracked', completed: [] } } });
    await claim();
    db.raw.prepare(`UPDATE form_submit_claims SET steps = '["answer"]', status = 'completed'`).run();
    expect(await (await get()).json()).toMatchObject({ data: { postActions: {
      completed: [{ step: 'answer', completedAt: null }],
    } } });
    await appendFormSubmitClaimStep(db.db, scope, 'test-owner', 'answer', 1);
    expect(JSON.parse((await getFormSubmitClaim(db.db, scope))?.step_completed_at_json ?? '{}')).toEqual({});
  });
  test('再実行で最初の完了日時を変えず、古い所有者・版は記録できない', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T00:00:00Z'));
    await claim();
    await appendFormSubmitClaimStep(db.db, scope, 'test-owner', 'answer', 1);
    const before = (await getFormSubmitClaim(db.db, scope))?.step_completed_at_json;
    vi.setSystemTime(new Date('2026-10-07T01:00:00Z'));
    await appendFormSubmitClaimStep(db.db, scope, 'test-owner', 'answer', 1);
    expect((await getFormSubmitClaim(db.db, scope))?.step_completed_at_json).toBe(before);
    expect(await appendFormSubmitClaimStep(db.db, scope, 'other-owner', 'reply', 1)).toBe(false);
    expect(await appendFormSubmitClaimStep(db.db, scope, 'test-owner', 'reply', 2)).toBe(false);
  });
  test('回答一覧でも済みを返す', async () => {
    await claim();
    await appendFormSubmitClaimStep(db.db, scope, 'test-owner', 'answer', 1);
    const res = await get('/api/forms/form1/submissions?account_id=a1&page=1&limit=20');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { items: [{ postActions: { completed: [{ step: 'answer' }] } }] } });
  });
  test('別フォーム・別アカウント・存在しない回答・試し回答を読ませない', async () => {
    for (const path of ['/api/forms/form1/submissions/s1?account_id=a2',
      '/api/forms/other/submissions/s1?account_id=a1', '/api/forms/form1/submissions/missing?account_id=a1']) {
      expect((await get(path)).status).toBe(404);
    }
    db.raw.prepare(`INSERT INTO forms (id, name) VALUES ('form2', '別の試験')`).run();
    db.raw.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form2', 'a1')`).run();
    expect((await get('/api/forms/form2/submissions/s1?account_id=a1')).status).toBe(404);
    db.raw.prepare('UPDATE form_submissions SET is_test = 1').run();
    expect((await get()).status).toBe(404);
  });
});


test('完了済みの後処理の再実行応答にも済みと元の日時を残す', async () => {
  await claim();
  await appendFormSubmitClaimStep(db.db, scope, 'test-owner', 'answer', 1);
  db.raw.prepare(`UPDATE form_submit_claims SET status = 'completed'`).run();
  const res = await app().request('/api/forms/form1/submissions/s1/retry-effects?account_id=a1', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }, { DB: db.db });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ data: { complete: true, submission: {
    postActions: { state: 'completed', completed: [{ step: 'answer', completedAt: expect.any(String) }] },
  } } });
});
