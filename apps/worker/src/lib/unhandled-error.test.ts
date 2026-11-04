import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { apiContractMiddleware } from '../middleware/api-contract.js';
import type { Env } from '../worker-env.js';
const report = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../services/codex-slack-relay.js', () => ({ reportHarnessErrorToSlack: report }));
import { UnexpectedRouteError, unhandledWorkerError } from './unhandled-error.js';
afterEach(() => vi.restoreAllMocks());

it('削除中画像のDB競合を理由付き409にし、障害通知を送らない', async () => {
  report.mockClear();
  const app = new Hono<Env>();
  app.get('/api/test', () => { throw new Error('CHECK constraint failed: media_deletion_in_progress'); });
  app.onError(unhandledWorkerError);
  const response = await app.request('/api/test', {}, {} as Env['Bindings']);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'media_deletion_in_progress' });
  expect(report).not.toHaveBeenCalled();
});

it('S01の応答・ログ・通知の事故番号を、共通の依頼番号と同じにする', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = new Hono<Env>();
  app.use('*', apiContractMiddleware);
  app.get('/api/friends/:id', () => { throw new Error('private-customer secret-token'); });
  app.onError(unhandledWorkerError);
  const response = await app.request('/api/friends/private-customer?token=secret-token', {
    headers: { 'X-Request-ID': 'untrusted-customer' },
  }, {} as Env['Bindings']);
  const body = await response.json<{ incidentId: string; error: { requestId: string } }>();
  expect(response.status).toBe(500);
  expect(body.incidentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(body.error.requestId).toBe(body.incidentId);
  expect(response.headers.get('X-Request-ID')).toBe(body.incidentId);
  expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
    timestamp: expect.any(String), code: 'unhandled_worker_error', level: 'error', source: 'http',
    requestId: body.incidentId, invocationId: body.incidentId,
  });
  expect(report).toHaveBeenLastCalledWith(expect.anything(), {
    source: 'worker', message: 'unhandled_worker_error', path: 'GET /api/friends/:id', incidentId: body.incidentId,
  });
  expect(JSON.stringify([body, log.mock.calls, report.mock.calls])).not.toMatch(/private-customer|secret-token|untrusted-customer/);
});

it('例外は既存どおり500にまとめ、依頼番号を通知・応答・ログへ渡す', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = new Hono<Env>();
  app.use('*', apiContractMiddleware);
  app.get('/api/unavailable', () => { throw new HTTPException(503, { res: new Response(JSON.stringify({ error: 'SERVICE_UNAVAILABLE' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } }) }); });
  app.onError(unhandledWorkerError);
  const response = await app.request('/api/unavailable', {}, {} as Env['Bindings']);
  const body = await response.json<{ error: { code: string; requestId: string } }>();
  expect(response.status).toBe(500);
  expect(response.headers.get('Retry-After')).toBeNull();
  expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
  expect(response.headers.get('X-Request-ID')).toBe(body.error.requestId);
  expect(JSON.parse(String(log.mock.calls[0][0])).requestId).toBe(body.error.requestId);
  expect(report).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ incidentId: body.error.requestId }));
});

it('個別の案内・復旧データ・ヘッダーを保ち、依頼番号を一度だけ通知する', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = new Hono<Env>();
  app.use('*', apiContractMiddleware);
  app.get('/api/recipes/:id/clone', (c) => {
    c.header('Retry-After', '30');
    throw new UnexpectedRouteError(c, {
      success: false, error: '作れませんでした。何も作られていません',
      code: 'CLONE_TRANSACTION_FAILED', runId: 'private-run',
      data: { completedChunks: 2, total: 5 },
    });
  });
  app.onError(unhandledWorkerError);
  const pending: Promise<unknown>[] = [];
  const response = await app.request('/api/recipes/private-customer/clone?token=private-token', {}, {} as Env['Bindings'], {
    waitUntil(promise) { pending.push(promise); }, passThroughOnException() {}, props: {},
  });
  await Promise.all(pending);
  const body = await response.json<{ incidentId: string; error: { code: string; message: string; requestId: string } }>();
  expect(response.status).toBe(500);
  expect(response.headers.get('Retry-After')).toBe('30');
  expect(body).toMatchObject({
    success: false, runId: 'private-run', data: { completedChunks: 2, total: 5 },
    error: { code: 'CLONE_TRANSACTION_FAILED', message: '作れませんでした。何も作られていません', requestId: body.incidentId },
  });
  expect(body.incidentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.headers.get('X-Request-ID')).toBe(body.incidentId);
  expect(log).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
    source: 'worker', message: 'unhandled_worker_error', path: 'GET /api/recipes/:id/clone', incidentId: body.incidentId,
  });
  expect(pending).toHaveLength(1);
  expect(JSON.stringify([log.mock.calls, report.mock.calls])).not.toMatch(/private-|token=/);
});

it('Slack通知の失敗も固定の事件名で記録し、利用者への案内を失わない', async () => {
  report.mockRejectedValueOnce(new Error('private-customer token=private-token'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = new Hono<Env>();
  app.get('/api/failure', (c) => { throw new UnexpectedRouteError(c, { success: false, error: '保存できませんでした' }); });
  app.onError(unhandledWorkerError);
  const response = await app.request('/api/failure');
  await Promise.resolve();
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ success: false, error: '保存できませんでした', incidentId: expect.any(String) });
  expect(log.mock.calls.map(([raw]) => JSON.parse(String(raw)).code)).toEqual(['unhandled_worker_error', 'worker.report_error_to_slack_failed']);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|token=/);
});
