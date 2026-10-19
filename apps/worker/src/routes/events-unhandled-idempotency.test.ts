import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { apiContractMiddleware } from '../middleware/api-contract.js';
import { unhandledWorkerError } from '../lib/unhandled-error.js';
import events from './events.js';

const mocks = vi.hoisted(() => ({
  report: vi.fn(async () => false),
  reserve: vi.fn(),
  finalize: vi.fn(async () => {}),
}));
vi.mock('../services/codex-slack-relay.js', () => ({ reportHarnessErrorToSlack: mocks.report }));
vi.mock('../services/liff-auth.js', () => ({ verifyCallerLineUserId: vi.fn(async () => 'line-user') }));
vi.mock('../services/event-booking-idempotency.js', () => ({
  reserveEventIdempotency: mocks.reserve,
  finalizeEventIdempotencyResponse: mocks.finalize,
}));
afterEach(() => vi.restoreAllMocks());

const paths = ['/api/liff/events/event-id/bookings', '/api/events/liff/bookings/booking-id/change'];

function setup() {
  const work = vi.fn(() => { throw new Error('private-database-error'); });
  const db = {
    prepare(sql: string) {
      const first = async () => {
        if (sql.includes('FROM line_accounts')) return { id: 'account-id' };
        if (sql.includes('FROM friends')) return { id: 'friend-id', user_id: null, picture_url: null };
        return work();
      };
      return { bind: () => ({ first }) };
    },
  };
  const app = new Hono<Env>();
  app.use('*', apiContractMiddleware);
  app.route('/', events);
  app.onError(unhandledWorkerError);
  const request = (path: string) => app.request(`${path}?liffId=liff-id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'same-key' }, body: '{}',
  }, { DB: db } as unknown as Env['Bindings']);
  return { work, request };
}

it.each(paths)('%sの失敗は冪等キーの記録を終えてから共通事故処理へ渡す', async path => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.reserve.mockResolvedValue({ kind: 'inserted' });
  const { request, work } = setup();
  const response = await request(path);
  const body = await response.json<{ incidentId: string }>();
  expect(response.status).toBe(500);
  expect(body.incidentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(work).toHaveBeenCalledTimes(1);
  expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
    key: 'same-key', lineAccountId: 'account-id', friendId: 'friend-id', status: 500, body: { error: 'internal_error' },
  });
  expect(mocks.report).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ incidentId: body.incidentId }));
  expect(mocks.finalize.mock.invocationCallOrder[0]).toBeLessThan(mocks.report.mock.invocationCallOrder[0]);
  expect(JSON.stringify(body)).not.toContain('private-database-error');
});

it.each(paths)('%sの保存済み失敗は再実行せず事故番号と通報を返す', async path => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.reserve.mockResolvedValue({ kind: 'cached', status: 500, body: { error: 'internal_error' } });
  const { request, work } = setup();
  const response = await request(path);
  const body = await response.json<{ incidentId: string }>();
  expect(response.status).toBe(500);
  expect(body.incidentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(work).not.toHaveBeenCalled();
  expect(mocks.finalize).not.toHaveBeenCalled();
  expect(mocks.report).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ incidentId: body.incidentId }));
});

it.each(paths)('%sの保存済み成功はそのまま返し、作り直しも事故通報もしない', async path => {
  const saved = { booking_id: 'already-created', status: 'confirmed' };
  mocks.reserve.mockResolvedValue({ kind: 'cached', status: 201, body: saved });
  const { request, work } = setup();
  const response = await request(path);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual(saved);
  expect(work).not.toHaveBeenCalled();
  expect(mocks.finalize).not.toHaveBeenCalled();
  expect(mocks.report).not.toHaveBeenCalled();
});
