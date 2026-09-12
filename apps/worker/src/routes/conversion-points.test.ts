import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getConversionPoints: vi.fn(),
  getConversionPointById: vi.fn(),
  // 配線試験用に本物と同じ1行規則。規則自体は packages/db の単体試験が固定する。
  canRecordConversion: vi.fn(
    (pointLineAccountId: string | null, friendLineAccountId: string | null) =>
      pointLineAccountId === null || pointLineAccountId === friendLineAccountId,
  ),
  createConversionPoint: vi.fn(),
  hasConversionPointActivity: vi.fn(),
  updateConversionPoint: vi.fn(),
  stopConversionPoint: vi.fn(),
  trackConversion: vi.fn(),
  getConversionEvents: vi.fn(),
  getConversionReport: vi.fn(),
  getConversionApprovalQueue: vi.fn(),
  setConversionApproval: vi.fn(),
  getConversionApprovalNotifyInfo: vi.fn(),
  syncAffiliateConversionMileage: vi.fn(),
  listConversionDefinitions: vi.fn(),
  getConversionDefinitionDetail: vi.fn(),
  addConversionDefinitionUsage: vi.fn(),
  getConversionDefinitionReport: vi.fn(),
  listConversionDefinitionsForExport: vi.fn(),
  ConversionDefinitionError: class ConversionDefinitionError extends Error {},
  CONVERSION_DEFINITION_USAGE_KINDS: [],
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
const accountAccess = await import('../services/account-access.js');
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
      first: vi.fn(async () => null),
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
  version: 1,
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

const STOPPED_POINT = { ...POINT, status: 'stopped' as const };

describe('成果地点の更新', () => {
  it('無い地点は404', async () => {
    mocks.getConversionPointById.mockResolvedValue(null);
    const res = await req('/api/conversions/points/nope', 'PUT', { name: 'x' });
    expect(res.status).toBe(404);
    expect(mocks.updateConversionPoint).not.toHaveBeenCalled();
  });

  it('版が無ければ400', async () => {
    mocks.getConversionPointById.mockResolvedValue(POINT);
    const res = await req('/api/conversions/points/cp-1', 'PUT', { name: '新名' });
    expect(res.status).toBe(400);
    expect(mocks.updateConversionPoint).not.toHaveBeenCalled();
  });

  it('版がずれれば409で今の版を返す', async () => {
    mocks.getConversionPointById.mockResolvedValue(POINT);
    const res = await req('/api/conversions/points/cp-1', 'PUT', { name: '新名', expectedVersion: 2 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, currentVersion: 1 });
    expect(mocks.updateConversionPoint).not.toHaveBeenCalled();
  });

  it('稼働中の数え方は変えられない(N-254)', async () => {
    // 版が合っていても、稼働中の地点の金額・種別・計測方法は旧口で触らせない。
    mocks.getConversionPointById.mockResolvedValue(POINT);
    const res = await req('/api/conversions/points/cp-1', 'PUT', { expectedVersion: 1, value: 9000 });
    expect(res.status).toBe(409);
    expect(mocks.updateConversionPoint).not.toHaveBeenCalled();
  });

  it('稼働中でも名前だけは変えられる', async () => {
    // 名前は表示用で数え方に影響しないため、版さえ合えば通す。
    mocks.getConversionPointById.mockResolvedValue(POINT);
    mocks.updateConversionPoint.mockResolvedValue({ ...POINT, name: '新名', version: 2 });
    const res = await req('/api/conversions/points/cp-1', 'PUT', { name: '新名', expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(mocks.updateConversionPoint).toHaveBeenCalledWith(env.DB, 'cp-1', { name: '新名' }, { expectedVersion: 1 });
  });

  it('利用実績のある停止地点の数え方も変えられない', async () => {
    mocks.getConversionPointById.mockResolvedValue(STOPPED_POINT);
    mocks.hasConversionPointActivity.mockResolvedValue(true);
    const res = await req('/api/conversions/points/cp-1', 'PUT', { expectedVersion: 1, countRepeat: false });
    expect(res.status).toBe(409);
    expect(mocks.updateConversionPoint).not.toHaveBeenCalled();
  });

  it('停止済み・利用なしなら送られた項目だけを触る', async () => {
    mocks.getConversionPointById.mockResolvedValue(STOPPED_POINT);
    mocks.hasConversionPointActivity.mockResolvedValue(false);
    mocks.updateConversionPoint.mockResolvedValue({ ...STOPPED_POINT, count_repeat: 0, version: 2 });
    await req('/api/conversions/points/cp-1', 'PUT', { countRepeat: false, expectedVersion: 1 });
    expect(mocks.updateConversionPoint).toHaveBeenCalledWith(env.DB, 'cp-1', {
      countRepeat: false,
    }, { expectedVersion: 1 });
  });

  it('クエリの版でも通る(本文が落ちる通信経路)', async () => {
    mocks.getConversionPointById.mockResolvedValue(STOPPED_POINT);
    mocks.hasConversionPointActivity.mockResolvedValue(false);
    mocks.updateConversionPoint.mockResolvedValue(STOPPED_POINT);
    const res = await req('/api/conversions/points/cp-1?expectedVersion=1', 'PUT', { name: '新名' });
    expect(res.status).toBe(200);
  });

  it('他アカウントの地点は404', async () => {
    mocks.getConversionPointById.mockResolvedValue(POINT);
    vi.mocked(accountAccess.canAccessAllLineAccounts).mockResolvedValueOnce(false);
    const res = await req('/api/conversions/points/cp-1', 'PUT', { name: '新名', expectedVersion: 1 });
    expect(res.status).toBe(404);
    expect(mocks.updateConversionPoint).not.toHaveBeenCalled();
  });

  it('既存が url_reach のとき、対象URLを空にはできない', async () => {
    // 「URLだけ消す」を許すと、url_reach のまま数えられない地点になる。
    mocks.getConversionPointById.mockResolvedValue({
      ...POINT,
      measure_method: 'url_reach',
      target_url: 'https://example.com/thanks',
    });
    const res = await req('/api/conversions/points/cp-1', 'PUT', { targetUrl: null, expectedVersion: 1 });
    expect(res.status).toBe(400);
    expect(mocks.updateConversionPoint).not.toHaveBeenCalled();
  });

  it('manual へ戻すなら対象URLを消してよい', async () => {
    mocks.getConversionPointById.mockResolvedValue({
      ...STOPPED_POINT,
      measure_method: 'url_reach',
      target_url: 'https://example.com/thanks',
    });
    mocks.hasConversionPointActivity.mockResolvedValue(false);
    mocks.updateConversionPoint.mockResolvedValue(POINT);
    const res = await req('/api/conversions/points/cp-1', 'PUT', {
      measureMethod: 'manual',
      targetUrl: null,
      expectedVersion: 1,
    });
    expect(res.status).toBe(200);
  });

  it('名前を空にはできない', async () => {
    mocks.getConversionPointById.mockResolvedValue(POINT);
    const res = await req('/api/conversions/points/cp-1', 'PUT', { name: '  ', expectedVersion: 1 });
    expect(res.status).toBe(400);
  });
});

describe('点検・軽 第7便の長さ上限(#585)', () => {
  it('作成は名前121文字・対象URL2001文字を400で拒否する(#513 L14)', async () => {
    const longName = await req('/api/conversions/points', 'POST', {
      name: 'あ'.repeat(121), eventType: 'purchase',
    });
    expect(longName.status).toBe(400);
    const longUrl = await req('/api/conversions/points', 'POST', {
      name: 'LP到達', eventType: 'reach', measureMethod: 'url_reach',
      targetUrl: `https://example.com/${'a'.repeat(2000)}`,
    });
    expect(longUrl.status).toBe(400);
    expect(mocks.createConversionPoint).not.toHaveBeenCalled();
  });

  it('更新は名前121文字・対象URL2001文字を400で拒否する(#513 L14)', async () => {
    mocks.getConversionPointById.mockResolvedValue(STOPPED_POINT);
    mocks.hasConversionPointActivity.mockResolvedValue(false);
    const longName = await req('/api/conversions/points/cp-1', 'PUT', { name: 'あ'.repeat(121), expectedVersion: 1 });
    expect(longName.status).toBe(400);
    const longUrl = await req('/api/conversions/points/cp-1', 'PUT', {
      measureMethod: 'url_reach', targetUrl: `https://example.com/${'a'.repeat(2000)}`, expectedVersion: 1,
    });
    expect(longUrl.status).toBe(400);
    expect(mocks.updateConversionPoint).not.toHaveBeenCalled();
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
    expect(mocks.getConversionPoints).toHaveBeenCalledWith(env.DB, {
      allowedLineAccountIds: [],
      includeUnassigned: true,
    });
  });
});

describe('成果地点の停止', () => {
  it('削除操作は履歴を消さず停止処理を呼ぶ', async () => {
    mocks.getConversionPointById.mockResolvedValue(POINT);
    mocks.stopConversionPoint.mockResolvedValue({ ...POINT, status: 'stopped', version: 2 });
    const res = await req('/api/conversions/points/cp-1', 'DELETE', { expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(mocks.stopConversionPoint).toHaveBeenCalledWith(env.DB, 'cp-1', 1);
  });

  it('版が無ければ400', async () => {
    mocks.getConversionPointById.mockResolvedValue(POINT);
    const res = await req('/api/conversions/points/cp-1', 'DELETE');
    expect(res.status).toBe(400);
    expect(mocks.stopConversionPoint).not.toHaveBeenCalled();
  });

  it('版がずれれば409で今の版を返す', async () => {
    mocks.getConversionPointById.mockResolvedValue(POINT);
    mocks.stopConversionPoint.mockRejectedValueOnce(new Error('conversion_point_version_conflict'));
    const res = await req('/api/conversions/points/cp-1', 'DELETE', { expectedVersion: 2 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, currentVersion: 1 });
  });

  it('停止済みなら409', async () => {
    mocks.getConversionPointById.mockResolvedValue(STOPPED_POINT);
    mocks.stopConversionPoint.mockRejectedValueOnce(new Error('conversion_point_already_stopped'));
    const res = await req('/api/conversions/points/cp-1', 'DELETE', { expectedVersion: 1 });
    expect(res.status).toBe(409);
  });
});

describe('成果の受付の境界(N-255)', () => {
  const EVENT = {
    id: 'ev-1',
    conversion_point_id: 'cp-1',
    friend_id: 'friend-a',
    user_id: null,
    affiliate_code: null,
    metadata: null,
    created_at: '2026-09-01',
  };

  function mockTrackAccounts(pointAccount: string | null = 'acc-1', friendAccount: string | null = 'acc-1') {
    const first = vi.fn()
      .mockResolvedValueOnce({ line_account_id: pointAccount, status: 'active' })
      .mockResolvedValueOnce({ line_account_id: friendAccount });
    (env.DB.prepare as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn(() => ({ first })),
    });
  }

  it('記録できれば201', async () => {
    mockTrackAccounts();
    mocks.trackConversion.mockResolvedValue(EVENT);
    const res = await req('/api/conversions/track', 'POST', {
      conversionPointId: 'cp-1', friendId: 'friend-a',
    });
    expect(res.status).toBe(201);
  });

  it('見られないアカウントが混ざれば403', async () => {
    mockTrackAccounts();
    vi.mocked(accountAccess.canAccessAllLineAccounts).mockResolvedValueOnce(false);
    const res = await req('/api/conversions/track', 'POST', {
      conversionPointId: 'cp-1', friendId: 'friend-a',
    });
    expect(res.status).toBe(403);
    expect(mocks.trackConversion).not.toHaveBeenCalled();
  });

  it('両方を見られても地点と友だちの交差記録は403', async () => {
    // 職員は両アカウントを見られるが、組み合わせ自体が禁じられる。
    mockTrackAccounts('acc-a', 'acc-b');
    const res = await req('/api/conversions/track', 'POST', {
      conversionPointId: 'cp-1', friendId: 'friend-a',
    });
    expect(res.status).toBe(403);
    expect(mocks.trackConversion).not.toHaveBeenCalled();
  });

  it('全アカウント対象の地点なら交差して記録できる', async () => {
    mockTrackAccounts(null, 'acc-b');
    mocks.trackConversion.mockResolvedValue(EVENT);
    const res = await req('/api/conversions/track', 'POST', {
      conversionPointId: 'cp-1', friendId: 'friend-a',
    });
    expect(res.status).toBe(201);
    expect(mocks.trackConversion).toHaveBeenCalled();
  });

  it('同じ冪等キーの別内容の使い回しは409', async () => {
    mockTrackAccounts();
    mocks.trackConversion.mockRejectedValueOnce(new Error('conversion_idempotency_key_conflict'));
    const res = await req('/api/conversions/track', 'POST', {
      conversionPointId: 'cp-1', friendId: 'friend-b', idempotencyKey: 'order-1',
    });
    expect(res.status).toBe(409);
  });

  it('事前確認後にhelperがaccount交差を検出しても403にする', async () => {
    mockTrackAccounts('acc-a', 'acc-a');
    mocks.trackConversion.mockRejectedValueOnce(new Error('conversion_account_mismatch'));
    const res = await req('/api/conversions/track', 'POST', {
      conversionPointId: 'cp-1', friendId: 'friend-a',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: '地点と友だちのアカウントが違うため記録できません',
    });
  });
});
