import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { apiContractMiddleware } from '../middleware/api-contract.js';
import type { Env } from '../worker-env.js';
const report = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../services/codex-slack-relay.js', () => ({ reportHarnessErrorToSlack: report }));
import { unhandledWorkerError } from './unhandled-error.js';
afterEach(() => vi.restoreAllMocks());

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
