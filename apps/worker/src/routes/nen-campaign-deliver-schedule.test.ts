import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

/*
 * #935 N-304: 過去の予約日時を「予約」として受け付けない。
 * 通すと次のtickで即送され、「予約した」のに「今届いた」になる。
 * 新規作成口(POST /columns)と一覧の予約口(POST /columns/:id/deliver)の両方で、
 * DBを触る前に400で断ることを確かめる。
 */

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  prepare: vi.fn(),
  queueColumnDelivery: vi.fn(),
}));

vi.mock('../services/account-access.js', () => ({ canAccessAllLineAccounts: mocks.canAccess }));
vi.mock('@line-crm/db', () => ({
  getLineAccountById: vi.fn(),
  jstNow: vi.fn(() => '2026-08-31 12:00:00'),
  recordConversionSourceEvent: vi.fn(),
}));
vi.mock('../services/nen-engagement.js', () => ({
  buildDefaultColumnIntro: vi.fn((title: string) => title),
  buildNenDeliveryMessages: vi.fn(),
  getNenCampaign: vi.fn(),
  queueColumnDelivery: mocks.queueColumnDelivery,
  saveNenCampaignAccountSetting: vi.fn(),
  getNenBirthdayCouponSetting: vi.fn(),
  saveNenBirthdayCouponSetting: vi.fn(),
  parseNenCampaignAfterActions: vi.fn(() => []),
}));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenPetTags: vi.fn() }));
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: vi.fn() }));
vi.mock('../services/local-line-proxy.js', () => ({ dispatchLineProxyLocally: vi.fn() }));

const { nenCampaigns } = await import('./nen-campaigns.js');

function app() {
  const instance = new Hono<{ Bindings: { DB: D1Database } }>();
  instance.use('*', async (c, next) => {
    c.env = { DB: { prepare: mocks.prepare } as unknown as D1Database };
    c.set('staff' as never, { id: 'staff-1', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

const post = (path: string, body: Record<string, unknown>) => app().request(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.queueColumnDelivery.mockResolvedValue(3);
  mocks.prepare.mockImplementation(() => {
    const statement = {
      bind: () => statement,
      first: vi.fn(async () => null),
      run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
      all: vi.fn(async () => ({ success: true, results: [] })),
    };
    return statement;
  });
});

describe('コラムの配信予約（POST /columns/:id/deliver）', () => {
  test('過去の予約日時は 400 で断り、配信待ち行列を触らない', async () => {
    const res = await post('/api/nen-campaigns/columns/col-1/deliver', {
      accountId: 'account-a',
      scheduledAt: '2020-01-01T00:00:00+09:00',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('past_datetime');
    expect(mocks.queueColumnDelivery).not.toHaveBeenCalled();
  });

  test('解釈できない予約日時は「今」に潰さず 400 で断る', async () => {
    const res = await post('/api/nen-campaigns/columns/col-1/deliver', {
      accountId: 'account-a',
      scheduledAt: 'not-a-date',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.error).toBe('scheduled_at_invalid');
    expect(mocks.queueColumnDelivery).not.toHaveBeenCalled();
  });

  test('未来の予約日時はその日時で配信待ちへ入れる', async () => {
    const res = await post('/api/nen-campaigns/columns/col-1/deliver', {
      accountId: 'account-a',
      scheduledAt: '2099-05-01T10:30:00+09:00',
    });
    expect(res.status).toBe(200);
    expect(mocks.queueColumnDelivery).toHaveBeenCalledWith(
      expect.anything(), 'col-1', 'account-a', '2099-05-01 01:30:00',
    );
  });

  test('予約日時を付けなければ「今すぐ」として今の時刻で入れる', async () => {
    const res = await post('/api/nen-campaigns/columns/col-1/deliver', { accountId: 'account-a' });
    expect(res.status).toBe(200);
    const when = mocks.queueColumnDelivery.mock.calls[0]?.[3] as string;
    expect(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(when)).toBe(true);
  });
});

describe('コラムの新規作成（POST /columns）', () => {
  const createBody = (over: Record<string, unknown> = {}) => ({
    title: '鹿肉の選び方',
    articleUrl: 'https://example.com/columns/venison',
    targetMode: 'all',
    ...over,
  });

  test('過去の配信日時は 400 で断り、DBを触らない', async () => {
    const res = await post('/api/nen-campaigns/columns?lineAccountId=account-a', createBody({
      scheduledAt: '2020-01-01T00:00:00+09:00',
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.error).toBe('past_datetime');
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.queueColumnDelivery).not.toHaveBeenCalled();
  });

  test('解釈できない配信日時は 400 で断り、DBを触らない', async () => {
    const res = await post('/api/nen-campaigns/columns?lineAccountId=account-a', createBody({
      scheduledAt: 'not-a-date',
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.error).toBe('scheduled_at_invalid');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  test('未来の配信日時は下書きを作り、その日時で配信待ちへ入れる', async () => {
    const res = await post('/api/nen-campaigns/columns?lineAccountId=account-a', createBody({
      scheduledAt: '2099-05-01T10:30:00+09:00',
    }));
    expect(res.status).toBe(201);
    expect(mocks.queueColumnDelivery).toHaveBeenCalledWith(
      expect.anything(), expect.any(String), 'account-a', '2099-05-01 01:30:00',
    );
  });
});
