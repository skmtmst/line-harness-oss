import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getConversionPoints: vi.fn(),
  getConversionPointById: vi.fn(),
  createConversionPoint: vi.fn(),
  updateConversionPoint: vi.fn(),
  stopConversionPoint: vi.fn(),
  trackConversion: vi.fn(),
  getConversionEvents: vi.fn(),
  getConversionReport: vi.fn(),
  getConversionApprovalQueue: vi.fn(),
  setConversionApproval: vi.fn(),
  getConversionApprovalNotifyInfo: vi.fn(),
  syncAffiliateConversionMileage: vi.fn(),
};
vi.mock('@line-crm/db', () => mocks);
vi.mock('../services/affiliate-notifier.js', () => ({ notifyAffiliateApproval: vi.fn() }));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(async () => ({
    allowedAccountIds: [],
    canSeeUnassigned: true,
  })),
}));

const { conversions } = await import('./conversions.js');
const app = new Hono<Env>();
app.use('*', async (c, next) => {
  c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false });
  return next();
});
app.route('/', conversions);
const env = {
  DB: {
    prepare: vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      all: vi.fn(async () => ({ results: [{ id: 'cp-1' }] })),
    })),
  } as unknown as D1Database,
};

function req(path: string, method: string, body?: unknown) {
  return app.fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

const POINT = {
  id: 'cp-1',
  name: '購入完了',
  event_type: 'purchase',
  value: 5000,
  measure_method: 'manual' as const,
  target_url: null,
  count_repeat: 1,
  attribution_days: null,
  line_account_id: null,
  status: 'active' as const,
  stopped_at: null,
  updated_at: '2026-08-15',
  created_at: '2026-08-15',
};

beforeEach(() => vi.clearAllMocks());

describe('成果地点の作成', () => {
  it('計測方法を指定しなければ manual になる', async () => {
    mocks.createConversionPoint.mockResolvedValue(POINT);
    const res = await req('/api/conversions/points', 'POST', {
      name: '購入完了',
      eventType: 'purchase',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { measureMethod: string; countRepeat: boolean } };
    expect(body.data.measureMethod).toBe('manual');
    expect(body.data.countRepeat).toBe(true);
  });

  it('url_reach なのに対象URLが無ければ弾く', async () => {
    // 保存できてしまうと「設定したのに1件も数えられない」という、
    // 気づきにくい壊れ方をする。
    const res = await req('/api/conversions/points', 'POST', {
      name: 'LP到達',
      eventType: 'reach',
      measureMethod: 'url_reach',
    });
    expect(res.status).toBe(400);
    expect(mocks.createConversionPoint).not.toHaveBeenCalled();
  });

  it('対象URLはスキームを求める', async () => {
    const res = await req('/api/conversions/points', 'POST', {
      name: 'LP到達',
      eventType: 'reach',
      measureMethod: 'url_reach',
      targetUrl: 'example.com/thanks',
    });
    expect(res.status).toBe(400);
  });

  it('知らない計測方法は弾く', async () => {
    const res = await req('/api/conversions/points', 'POST', {
      name: 'x',
      eventType: 'y',
      measureMethod: 'telepathy',
    });
    expect(res.status).toBe(400);
  });

  it('計測期間の上限を超えたら弾く', async () => {
    const res = await req('/api/conversions/points', 'POST', {
      name: 'x',
      eventType: 'y',
      attributionDays: 400,
    });
    expect(res.status).toBe(400);
  });

  it('url_reach と対象URLが揃っていれば作れる', async () => {
    mocks.createConversionPoint.mockResolvedValue({
      ...POINT,
      measure_method: 'url_reach',
      target_url: 'https://example.com/thanks',
      count_repeat: 0,
      attribution_days: 30,
    });
    const res = await req('/api/conversions/points', 'POST', {
      name: 'LP到達',
      eventType: 'reach',
      measureMethod: 'url_reach',
      targetUrl: 'https://example.com/thanks',
      countRepeat: false,
      attributionDays: 30,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { targetUrl: string; countRepeat: boolean; attributionDays: number };
    };
    expect(body.data).toMatchObject({
      targetUrl: 'https://example.com/thanks',
      countRepeat: false,
      attributionDays: 30,
    });
  });
});

describe('成果地点の更新', () => {
  it('無い地点は404', async () => {
    mocks.getConversionPointById.mockResolvedValue(null);
    const res = await req('/api/conversions/points/nope', 'PUT', { name: 'x' });
    expect(res.status).toBe(404);
    expect(mocks.updateConversionPoint).not.toHaveBeenCalled();
  });

  it('送られた項目だけを触る', async () => {
    mocks.getConversionPointById.mockResolvedValue(POINT);
    mocks.updateConversionPoint.mockResolvedValue({ ...POINT, count_repeat: 0 });
    await req('/api/conversions/points/cp-1', 'PUT', { countRepeat: false });
    expect(mocks.updateConversionPoint).toHaveBeenCalledWith(env.DB, 'cp-1', {
      countRepeat: false,
    });
  });

  it('既存が url_reach のとき、対象URLを空にはできない', async () => {
    // 「URLだけ消す」を許すと、url_reach のまま数えられない地点になる。
    mocks.getConversionPointById.mockResolvedValue({
      ...POINT,
      measure_method: 'url_reach',
      target_url: 'https://example.com/thanks',
    });
    const res = await req('/api/conversions/points/cp-1', 'PUT', { targetUrl: null });
    expect(res.status).toBe(400);
    expect(mocks.updateConversionPoint).not.toHaveBeenCalled();
  });

  it('manual へ戻すなら対象URLを消してよい', async () => {
    mocks.getConversionPointById.mockResolvedValue({
      ...POINT,
      measure_method: 'url_reach',
      target_url: 'https://example.com/thanks',
    });
    mocks.updateConversionPoint.mockResolvedValue(POINT);
    const res = await req('/api/conversions/points/cp-1', 'PUT', {
      measureMethod: 'manual',
      targetUrl: null,
    });
    expect(res.status).toBe(200);
  });

  it('名前を空にはできない', async () => {
    mocks.getConversionPointById.mockResolvedValue(POINT);
    const res = await req('/api/conversions/points/cp-1', 'PUT', { name: '  ' });
    expect(res.status).toBe(400);
  });
});

describe('一覧', () => {
  it('計測の設定まで返る', async () => {
    mocks.getConversionPoints.mockResolvedValue([
      { ...POINT, measure_method: 'url_reach', target_url: 'https://example.com/a', count_repeat: 0 },
    ]);
    const res = await req('/api/conversions/points', 'GET');
    const body = (await res.json()) as {
      data: Array<{ measureMethod: string; targetUrl: string; countRepeat: boolean }>;
    };
    expect(body.data[0]).toMatchObject({
      measureMethod: 'url_reach',
      targetUrl: 'https://example.com/a',
      countRepeat: false,
    });
  });
});

describe('成果地点の停止', () => {
  it('DELETEは物理削除ではなくDBの停止処理を呼ぶ', async () => {
    mocks.getConversionPointById.mockResolvedValue(POINT);
    const res = await req('/api/conversions/points/cp-1', 'DELETE');
    expect(res.status).toBe(200);
    expect(mocks.stopConversionPoint).toHaveBeenCalledWith(env.DB, 'cp-1');
  });
});
