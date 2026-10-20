import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { apiContractMiddleware } from '../middleware/api-contract.js';
import { unhandledWorkerError } from '../lib/unhandled-error.js';
import booking from './booking.js';
import { bookingPayments } from './booking-payments.js';
import { broadcasts } from './broadcasts.js';
import { forms } from './forms.js';
import { webinarRoutes } from './webinars.js';
import { contents } from './contents.js';

const report = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../services/codex-slack-relay.js', () => ({ reportHarnessErrorToSlack: report }));

afterEach(() => vi.restoreAllMocks());

const cases = [
  ['予約', booking, '/api/booking/admin/menus?account_id=private-account', 'GET /api/booking/admin/*'],
  ['予約の支払い', bookingPayments, '/api/booking/admin/payment-config?account_id=private-account', 'GET /api/booking/admin/payment-config'],
  ['配信', broadcasts, '/api/broadcasts/private-recipient?token=private-token', 'GET /api/broadcasts/:id'],
  ['配信の集計', broadcasts, '/api/broadcasts/stats?lineAccountId=private-account', 'GET /api/broadcasts/stats'],
  ['フォーム', forms, '/api/forms/private-recipient?token=private-token', 'GET /api/forms/:id'],
  ['フォームの一覧', forms, '/api/forms?account_id=private-account', 'GET /api/forms'],
  ['ウェビナー', webinarRoutes, '/api/webinars/private-recipient?token=private-token', 'GET /api/webinars/:id'],
  ['コンテンツ', contents, '/api/media/private-recipient?accountId=private-account&token=private-token', 'GET /api/media/:id'],
] as const;

function appWithRoutes(routes: Hono<Env>) {
  const app = new Hono<Env>();
  app.use('*', apiContractMiddleware);
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-owner', name: 'Owner', role: 'owner', readOnly: false });
    await next();
  });
  app.route('/', routes);
  app.onError(unhandledWorkerError);
  return app;
}

describe('機能の予期しない失敗を共通の事故処理へ渡す', () => {
  it.each(cases)('%sのDB障害は事故番号・通知・秘密を含まないログがそろう', async (_name, routes, url, route) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const external = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('external_requests_forbidden'));
    const prepare = vi.fn(() => { throw new Error('SELECT private-customer private-token FROM private-table'); });
    const pending: Promise<unknown>[] = [];
    const response = await appWithRoutes(routes).request(url, {}, { DB: { prepare } } as unknown as Env['Bindings'], {
      waitUntil: (promise: Promise<unknown>) => { pending.push(promise); },
      passThroughOnException() {},
      props: {},
    });
    await Promise.all(pending);
    const body = await response.json<{ incidentId: string; error: { code: string; requestId: string } }>();
    expect(prepare).toHaveBeenCalled();
    expect(response.status).toBe(500);
    expect(body.incidentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.error.requestId).toBe(body.incidentId);
    expect(response.headers.get('X-Request-ID')).toBe(body.incidentId);
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      source: 'worker', message: 'unhandled_worker_error', path: route, incidentId: body.incidentId,
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      code: 'unhandled_worker_error', requestId: body.incidentId, invocationId: body.incidentId,
    });
    expect(JSON.stringify([body, log.mock.calls, report.mock.calls])).not.toMatch(/private-|SELECT|token=/);
    expect(pending).toHaveLength(1);
    expect(external).not.toHaveBeenCalled();
  });

  it('入力不備は事故として通報せず、入力の失敗を返す', async () => {
    const prepare = vi.fn(() => { throw new Error('DB must not be called'); });
    const response = await appWithRoutes(forms).request('/api/forms', {}, { DB: { prepare } } as unknown as Env['Bindings']);
    expect(response.status).toBe(400);
    const body = await response.json<{ incidentId?: string; error: { code: string } }>();
    expect(body.incidentId).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});
