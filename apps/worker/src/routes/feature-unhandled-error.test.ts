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
import { tags } from './tags.js';
import { friends } from './friends.js';
import { analytics } from './analytics.js';
import { lineAccounts } from './line-accounts.js';
import { access } from './access.js';
import { commonActions } from './common-actions.js';
import { templates } from './templates.js';

import { companySettings } from './company-settings.js';
import { lineAccountFolders } from './line-account-folders.js';
import { visitStamps } from './visit-stamps.js';
import { hqBroadcasts } from './hq-broadcasts.js';
import { hqFormTests } from './hq-form-tests.js';
import { hqTemplates } from './hq-templates.js';
import { instagram } from './instagram.js';
import { restaurantCustomerBooking } from './restaurant-customer-booking.js';

const report = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../services/codex-slack-relay.js', () => ({ reportHarnessErrorToSlack: report }));
// 所属確認の後の業務SQLを壊し、門番だけの失敗を合格に数えない。
vi.mock('../services/account-access.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/account-access.js')>(),
  getVisibleLineAccountScope: vi.fn(async () => ({
    accounts: [], allowedAccountIds: ['private-account'], ids: ['private-account'],
    canSeeUnassigned: true, isAccountScoped: false,
  })),
}));

vi.mock('./restaurant-customer-identity.js', () => ({ identity: vi.fn(async () => ({ accountId: 'private-account', friendId: 'private-friend' })) }));

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
  ['タグ', tags, '/api/tag-groups?accountId=private-account', 'GET /api/tag-groups'],
  ['友だち', friends, '/api/friends?accountId=private-account', 'GET /api/friends'],
  ['分析', analytics, '/api/analytics/messages?account_id=private-account', 'GET /api/analytics/messages'],
  ['LINEアカウント', lineAccounts, '/api/line-accounts?token=private-token', 'GET /api/line-accounts'],
  ['権限', access, '/api/access/users?token=private-token', 'GET /api/access/users'],
  ['共通の動作', commonActions, '/api/common-actions?account_id=private-account', 'GET /api/common-actions'],
  ['テンプレート', templates, '/api/templates?accountId=private-account', 'GET /api/templates'],
] as const;

function appWithRoutes(routes: Hono<Env>) {
  const app = new Hono<Env>();
  app.use('*', apiContractMiddleware);
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-owner', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'private-tenant' });
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

const customCases = [
  ['会社の設定', companySettings, '/api/settings/company', 'GET /api/settings/company', 'UNAVAILABLE', '会社の設定を確認できません。再確認してください'],
  ['アカウントのフォルダ', lineAccountFolders, '/api/line-account-folders', 'GET /api/line-account-folders', 'INTERNAL_SERVER_ERROR', 'フォルダを保存・取得できませんでした'],
  ['来店スタンプ', visitStamps, '/api/visit-stamps/cards?account_id=private-account', 'GET /api/visit-stamps/cards', 'INTERNAL_SERVER_ERROR', 'スタンプの処理を確認できません'],
  ['統括配信', hqBroadcasts, '/api/hq/broadcasts', 'GET /api/hq/broadcasts/*', 'INTERNAL_SERVER_ERROR', '統括配信を確認できません'],
  ['フォームの試し', hqFormTests, '/api/liff/hq-form-tests/private-id?test_token=private-token', 'GET /api/liff/hq-form-tests/:id', 'UNAVAILABLE', '試しのURLと有効期限を確認してください'],
  ['統括テンプレート', hqTemplates, '/api/hq/templates', 'GET /api/hq/templates/*', 'UNAVAILABLE', '処理結果を確認できません。しばらくしてから再確認してください'],
  ['Instagram', instagram, '/api/instagram/connection?lineAccountId=private-account', 'GET /api/instagram/connection', 'instagram_failed', undefined],
  ['飲食店のお客さま予約', restaurantCustomerBooking, '/api/liff/restaurant/link/private-token', 'GET /api/liff/restaurant/link/:token', 'booking_failed', undefined],
] as const;

it.each(customCases)('%sは従来の案内を保ち、予期しないDB障害を一度だけ通報する', async (_name, routes, url, route, code, message) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const prepare = vi.fn(() => { throw new Error('SELECT private-customer token=private-token'); });
  const response = await appWithRoutes(routes).request(url, {}, { DB: { prepare }, RESTAURANT_TEST_ENABLED: 'true', DEPLOY_ENV: 'test' } as unknown as Env['Bindings']);
  const body = await response.json<{ incidentId: string; error: { code: string; message: string; requestId: string } }>();
  expect(prepare).toHaveBeenCalled();
  expect(response.status).toBe(500);
  expect(body.incidentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(body.error.code).toBe(code);
  if (message) expect(body.error.message).toBe(message);
  expect(body.error.requestId).toBe(body.incidentId);
  expect(response.headers.get('X-Request-ID')).toBe(body.incidentId);
  expect(log).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
    source: 'worker', message: 'unhandled_worker_error', path: route, incidentId: body.incidentId,
  });
  expect(JSON.stringify([body, log.mock.calls, report.mock.calls])).not.toMatch(/private-|SELECT|token=/);
});

it.each([
  ['POST', '/api/analytics/cross/query?account_id=private-account'],
  ['POST', '/api/analytics/saved?account_id=private-account'],
  ['GET', '/api/analytics/funnels/private-id/runs/latest?account_id=private-account'],
])('分析の%s %sも予期しない失敗を共通処理から通報する', async (method, url) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const prepare = vi.fn(() => { throw new Error('SELECT private-customer token=private-token'); });
  const response = await appWithRoutes(analytics).request(url, {
    method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '分析', sourceKind: 'cross', sourceResultId: 'private-result' }) } : {}),
  }, { DB: { prepare } } as unknown as Env['Bindings']);
  const body = await response.json<{ incidentId: string; error: { code: string } }>();
  expect(prepare).toHaveBeenCalled();
  expect(response.status).toBe(500);
  expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
  expect(body.incidentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(report).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledTimes(1);
  expect(JSON.stringify([body, log.mock.calls, report.mock.calls])).not.toMatch(/private-|SELECT|token=/);
});
