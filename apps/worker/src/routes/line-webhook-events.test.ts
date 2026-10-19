import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  scope: vi.fn(),
  retry: vi.fn(),
  view: vi.fn(),
  canRetry: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  listLineWebhookEvents: mocks.list,
  getLineWebhookEvent: mocks.get,
}));

vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: mocks.scope,
}));

vi.mock('../services/line-webhook-recovery.js', () => ({ retryLineWebhookEvent: mocks.retry, lineWebhookRecoveryView: mocks.view, lineWebhookCanRetry: mocks.canRetry }));

import { lineWebhookEvents } from './line-webhook-events.js';

const operator = (role: AuthenticatedStaff['role']): AuthenticatedStaff => ({
  id: `${role}-1`,
  name: role,
  role,
  readOnly: false,
  tenantId: 'tenant-1',
});

function app(role: AuthenticatedStaff['role']) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', operator(role));
    return next();
  });
  instance.route('/', lineWebhookEvents);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.view.mockResolvedValue(null);
  mocks.canRetry.mockResolvedValue(false);
  mocks.retry.mockResolvedValue({status:'needs_review',reasonCode:'input_unavailable',reason:'必要な入力が残っていません'});
  mocks.scope.mockResolvedValue({
    accounts: [], ids: ['account-1'], allowedAccountIds: ['account-1'], canSeeUnassigned: true,
  });
  mocks.list.mockResolvedValue([]);
  mocks.get.mockResolvedValue({
    webhook_event_id: 'evt-1',
    line_account_id: 'account-1',
    event_type: 'message',
    status: 'failed',
    attempts: 1,
    last_error: 'unknown',
    received_at: '2026-08-24T12:00:00.000',
    updated_at: '2026-08-24T12:00:01.000',
  });
});

describe('LINE Webhook台帳API', () => {
  test.each(['owner', 'admin'] as const)('%sは失敗一覧を読める', async (role) => {
    mocks.list.mockResolvedValue([{
      webhookEventId: 'evt-1',
      lineAccountId: 'account-1',
      eventType: 'message',
      status: 'failed',
      attempts: 1,
      lastError: 'unknown',
      receivedAt: '2026-08-24T12:00:00.000',
      updatedAt: '2026-08-24T12:00:01.000',
    }]);
    const response = await app(role).request(
      '/api/line-webhook-events?status=failed',
      {},
      { DB: {} as D1Database } as Env['Bindings'],
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('evt-1');
    expect(text).not.toContain('lineUserId');
    expect(text).not.toContain('displayName');
    expect(text).not.toContain('messageContent');
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), {
      status: 'failed',
      lineAccountIds: ['account-1'],
      includeUnassigned: true,
    });
  });

  test('既定統括の一覧は未割り当てイベントを含める条件で取得する', async () => {
    await app('owner').request('/api/line-webhook-events', {}, { DB: {} as D1Database } as Env['Bindings']);

    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), {
      status: undefined,
      lineAccountIds: ['account-1'],
      includeUnassigned: true,
    });
  });

  test('既定統括でない統括の一覧は未割り当てイベントを含めない', async () => {
    mocks.scope.mockResolvedValue({
      accounts: [], ids: ['account-2'], allowedAccountIds: ['account-2'], canSeeUnassigned: false,
    });

    await app('owner').request('/api/line-webhook-events', {}, { DB: {} as D1Database } as Env['Bindings']);

    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), {
      status: undefined,
      lineAccountIds: ['account-2'],
      includeUnassigned: false,
    });
  });

  test('staffは一覧も再試行APIも使えない', async () => {
    const env = { DB: {} as D1Database } as Env['Bindings'];
    expect((await app('staff').request('/api/line-webhook-events?status=failed', {}, env)).status).toBe(403);
    expect((await app('staff').request('/api/line-webhook-events/evt-1/retry', { method: 'POST' }, env)).status).toBe(403);
  });

  test('入力不足の再試行は本文を返さず、理由つきの要確認を返す', async () => {
    const response = await app('owner').request(
      '/api/line-webhook-events/evt-1/retry',
      { method: 'POST' },
      { DB: {} as D1Database } as Env['Bindings'],
    );
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(text).toContain('WEBHOOK_REQUIRES_REVIEW');
    expect(text).not.toContain('lineUserId');
    expect(text).not.toContain('messageContent');
  });

  test('既定統括の未割り当てイベントは404ではなく要確認を返す', async () => {
    mocks.get.mockResolvedValue({
      webhook_event_id: 'evt-unassigned', line_account_id: null, event_type: 'unknown',
      status: 'failed', attempts: 1, last_error: 'unknown',
      received_at: '2026-08-24T12:00:00.000', updated_at: '2026-08-24T12:00:01.000',
    });

    const response = await app('owner').request(
      '/api/line-webhook-events/evt-unassigned/retry',
      { method: 'POST' },
      { DB: {} as D1Database } as Env['Bindings'],
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toContain('WEBHOOK_REQUIRES_REVIEW');
  });

  test('既定統括でない統括には未割り当てイベントを404で隠す', async () => {
    mocks.scope.mockResolvedValue({
      accounts: [], ids: ['account-2'], allowedAccountIds: ['account-2'], canSeeUnassigned: false,
    });
    mocks.get.mockResolvedValue({
      webhook_event_id: 'evt-unassigned', line_account_id: null, event_type: 'unknown',
      status: 'failed', attempts: 1, last_error: 'unknown',
      received_at: '2026-08-24T12:00:00.000', updated_at: '2026-08-24T12:00:01.000',
    });

    const response = await app('owner').request(
      '/api/line-webhook-events/evt-unassigned/retry',
      { method: 'POST' },
      { DB: {} as D1Database } as Env['Bindings'],
    );
    expect(response.status).toBe(404);
  });

  test('残っている入力で回復した管理者retryは200を返す', async () => {
    mocks.retry.mockResolvedValueOnce({status:'succeeded'});
    const response=await app('admin').request('/api/line-webhook-events/evt-1/retry',{method:'POST'},{DB:{} as D1Database} as Env['Bindings']);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({success:true,status:'succeeded'});
  });

  test('別アカウントの受信は404にし、回収処理を呼ばない', async () => {
    mocks.get.mockResolvedValueOnce({webhook_event_id:'other',line_account_id:'account-other',event_type:'message',status:'failed'});
    const response=await app('admin').request('/api/line-webhook-events/other/retry',{method:'POST'},{DB:{} as D1Database} as Env['Bindings']);
    expect(response.status).toBe(404);
    expect(mocks.retry).not.toHaveBeenCalled();
  });
});


test('selected account filters before limiting and rejects an invisible account',async()=>{
  const env={DB:{} as D1Database} as Env['Bindings'];
  const allowed=await app('owner').request('/api/line-webhook-events?status=failed&account_id=account-1',{},env);
  expect(allowed.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith(expect.anything(),{status:'failed',lineAccountIds:['account-1'],includeUnassigned:false});
  mocks.list.mockClear();
  expect((await app('owner').request('/api/line-webhook-events?account_id=invisible',{},env)).status).toBe(404);
  expect(mocks.list).not.toHaveBeenCalled();
});

test('retry eligibility is explicit and needs-review always suppresses it',async()=>{
  mocks.list.mockResolvedValue([{webhookEventId:'safe',lineAccountId:'account-1',eventType:'message',status:'failed',attempts:1,lastError:'db_error',receivedAt:'2026-10-12T00:09:00',updatedAt:'2026-10-12T00:10:00'}]);
  mocks.canRetry.mockResolvedValue(true);
  const env={DB:{} as D1Database} as Env['Bindings'];
  const response=await app('owner').request('/api/line-webhook-events?status=failed',{},env);
  expect((await response.json() as {data:Array<{canRetry:boolean}>}).data[0]?.canRetry).toBe(true);
  mocks.view.mockResolvedValue({status:'needs_review',reasonCode:'delivery_unknown',reason:'送達不明'});
  const review=await app('owner').request('/api/line-webhook-events?status=failed',{},env);
  expect((await review.json() as {data:Array<{canRetry:boolean}>}).data[0]?.canRetry).toBe(false);
});
