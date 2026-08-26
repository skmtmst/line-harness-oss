import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getDailyMessageCounts: vi.fn(),
  getTrackedLinkStats: vi.fn(),
  getLinkClickSummary: vi.fn(),
  getBroadcastSummary: vi.fn(),
  getTagFieldCross: vi.fn(),
  getFunnels: vi.fn(),
  getLegacyFunnels: vi.fn(),
  getFunnelById: vi.fn(),
  getFunnelSteps: vi.fn(),
  createFunnel: vi.fn(),
  deleteFunnel: vi.fn(),
  countFunnelStep: vi.fn(),
  createVersionedFunnel: vi.fn(),
  createFunnelVersion: vi.fn(),
  runChronologicalFunnel: vi.fn(),
  createFunnelResultAudience: vi.fn(),
  createAnalyticsCrossRun: vi.fn(),
  getAnalyticsCrossRun: vi.fn(),
  createAnalyticsCrossAudience: vi.fn(),
  getCurrentFunnelVersion: vi.fn(),
  getLineAccountById: vi.fn(),
  getLineAccounts: vi.fn(),
  FUNNEL_STEP_KINDS: [
    'tag',
    'field',
    'form',
    'site_event',
    'purchase',
    'link_click',
    'conversion',
  ],
  buildFunnelResult: (
    steps: Array<{ step_order: number; label: string }>,
    reached: string[][],
  ) =>
    steps.map((s, i) => ({
      stepOrder: s.step_order,
      label: s.label,
      reached: reached[i]?.length ?? 0,
      conversionFromPrevious: 1,
    })),
};
vi.mock('@line-crm/db', () => mocks);

const { analytics } = await import('./analytics.js');

const app = new Hono<Env>();
app.use('*', async (c, next) => {
  c.set('staff', { id: 'u-1', name: 'テスト', role: 'owner', readOnly: false });
  return next();
});
app.route('/', analytics);
const env = { DB: {} as D1Database };

function req(path: string, method = 'GET', body?: unknown) {
  return app.fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

const FUNNEL = { id: 'fn-1', line_account_id: 'account-a', name: '購入まで', segment_json: null, window_days: 30, created_at: '2026-08-16' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDailyMessageCounts.mockResolvedValue([]);
  mocks.getTrackedLinkStats.mockResolvedValue([]);
  mocks.getLinkClickSummary.mockResolvedValue([]);
  mocks.getBroadcastSummary.mockResolvedValue([]);
  mocks.getTagFieldCross.mockResolvedValue([]);
  mocks.getFunnels.mockResolvedValue([FUNNEL]);
  mocks.getLegacyFunnels.mockResolvedValue([FUNNEL]);
  mocks.getFunnelById.mockResolvedValue(FUNNEL);
  mocks.getFunnelSteps.mockResolvedValue([
    { id: 's1', funnel_id: 'fn-1', step_order: 1, label: '友だち追加', kind: 'tag', match_json: '{}' },
    { id: 's2', funnel_id: 'fn-1', step_order: 2, label: '購入', kind: 'conversion', match_json: '{}' },
  ]);
  mocks.createFunnel.mockResolvedValue(FUNNEL);
  mocks.countFunnelStep.mockResolvedValue(['f-1', 'f-2']);
  mocks.createVersionedFunnel.mockResolvedValue({
    funnelId: 'fn-v6', version: { id: 'fv-1', versionNumber: 1 },
  });
  mocks.createFunnelVersion.mockResolvedValue({ id: 'fv-2', versionNumber: 2 });
  mocks.runChronologicalFunnel.mockResolvedValue({
    runId: 'run-1', state: 'available', stateReason: null,
    dataCutoffAt: '2026-08-26T00:00:00.000Z',
    groups: [{
      key: 'all', label: '全体', entrants: 2, completed: 1,
      steps: [
        { stepOrder: 1, label: '友だち追加', reached: 2, conversionFromPrevious: 1 },
        { stepOrder: 2, label: '購入', reached: 1, conversionFromPrevious: 0.5 },
      ],
    }],
  });
  mocks.createFunnelResultAudience.mockResolvedValue({
    id: 'audience-1', memberCount: 1, expiresAt: '2026-08-27T00:00:00.000Z',
  });
  mocks.createAnalyticsCrossRun.mockResolvedValue({ id: 'cross-1', state: 'pending' });
  mocks.getAnalyticsCrossRun.mockResolvedValue({
    id: 'cross-1', state: 'available', errorCode: null,
    result: { state: 'available', cells: [], totalValue: 0 },
    createdAt: '2026-08-26T00:00:00.000Z',
  });
  mocks.createAnalyticsCrossAudience.mockResolvedValue({
    id: 'audience-cross-1', memberCount: 2, expiresAt: '2026-08-27T00:00:00.000Z',
  });
  mocks.getCurrentFunnelVersion.mockResolvedValue({
    id: 'fv-1', versionNumber: 1, createdAt: '2026-08-01T00:00:00.000Z',
  });
  mocks.getLineAccountById.mockResolvedValue({ id: 'account-a', timezone: 'Asia/Tokyo' });
  mocks.getLineAccounts.mockResolvedValue([
    { id: 'account-a', tenant_id: null },
    { id: 'account-b', tenant_id: 'other-tenant' },
  ]);
});

const ACCOUNT = 'account_id=account-a';

describe('期間の指定', () => {
  it('省略すると直近30日になる', async () => {
    const res = await req(`/api/analytics/messages?${ACCOUNT}`);
    expect(res.status).toBe(200);
    const [, accountId, range] = mocks.getDailyMessageCounts.mock.calls[0];
    expect(accountId).toBe('account-a');
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('終了日はその日いっぱいを含める', async () => {
    // '2026-08-16' で切ると、その日のぶんがまるごと落ちる。
    await req(`/api/analytics/messages?${ACCOUNT}&from=2026-08-01&to=2026-08-16`);
    const [, , range] = mocks.getDailyMessageCounts.mock.calls[0];
    expect(range.to).toBe('2026-08-16T23:59:59.999');
  });

  it('形が違えば弾く', async () => {
    const res = await req(`/api/analytics/messages?${ACCOUNT}&from=2026/08/01`);
    expect(res.status).toBe(400);
    expect(mocks.getDailyMessageCounts).not.toHaveBeenCalled();
  });

  it('開始と終了が逆なら弾く', async () => {
    const res = await req(`/api/analytics/messages?${ACCOUNT}&from=2026-08-20&to=2026-08-01`);
    expect(res.status).toBe(400);
  });

  it('長すぎる期間は弾く', async () => {
    // 期間を長くするほど走査する行が増える。
    const res = await req(`/api/analytics/messages?${ACCOUNT}&from=2020-01-01&to=2026-08-16`);
    expect(res.status).toBe(400);
  });
});

describe('クロス集計', () => {
  it('項目の指定が要る', async () => {
    const res = await req(`/api/analytics/cross?${ACCOUNT}`);
    expect(res.status).toBe(400);
  });

  it('項目を指定すれば返る', async () => {
    const res = await req(`/api/analytics/cross?${ACCOUNT}&fieldId=ff-1`);
    expect(res.status).toBe(200);
    expect(mocks.getTagFieldCross).toHaveBeenCalledWith(env.DB, 'account-a', 'ff-1');
  });
});

describe('V6クロス分析API', () => {
  const body = {
    rowAxis: { kind: 'route' },
    columnAxis: { kind: 'tag' },
    measure: { kind: 'unique_friends' },
    filters: [],
    periodFrom: '2026-08-01T00:00:00.000Z',
    periodTo: '2026-08-07T23:59:59.999Z',
  };

  it('重い集計をHTTP内で行わずpendingの結果IDを返す', async () => {
    const res = await req(`/api/analytics/cross/query?${ACCOUNT}`, 'POST', body);
    expect(res.status).toBe(202);
    expect(mocks.createAnalyticsCrossRun).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        lineAccountId: 'account-a', timeZone: 'Asia/Tokyo', createdBy: 'u-1', query: body,
      }),
    );
    expect(await res.json()).toMatchObject({ data: { id: 'cross-1', state: 'pending' } });
  });

  it('選択中アカウント内の結果だけを返す', async () => {
    const res = await req(`/api/analytics/cross/results/cross-1?${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mocks.getAnalyticsCrossRun).toHaveBeenCalledWith(env.DB, 'account-a', 'cross-1');
  });

  it('セルから友だちIDではなく24時間の対象者IDを返す', async () => {
    const res = await req(`/api/analytics/results/cross-1/audiences?${ACCOUNT}`, 'POST', {
      sourceKind: 'cross', rowKey: 'route-1', columnKey: 'tag-1',
    });
    expect(res.status).toBe(201);
    expect(mocks.createAnalyticsCrossAudience).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        lineAccountId: 'account-a', runId: 'cross-1',
        rowKey: 'route-1', columnKey: 'tag-1', createdBy: 'u-1',
      }),
    );
    expect(await res.json()).toMatchObject({ data: { id: 'audience-cross-1', memberCount: 2 } });
  });
});

describe('ファネルの作成', () => {
  const validSteps = [
    { label: '友だち追加', kind: 'tag', match: { tagId: 't1' } },
    { label: '購入', kind: 'conversion', match: { conversionPointId: 'cp1' } },
  ];

  it('2段以上でないと作れない', async () => {
    // 1段は「ただの件数」で、離脱を見るという目的を果たさない。
    const res = await req(`/api/funnels?${ACCOUNT}`, 'POST', { name: 'x', steps: [validSteps[0]] });
    expect(res.status).toBe(422);
    expect(mocks.createFunnel).not.toHaveBeenCalled();
  });

  it('10段を超えたら弾く', async () => {
    const res = await req(`/api/funnels?${ACCOUNT}`, 'POST', {
      name: 'x',
      steps: Array.from({ length: 11 }, () => validSteps[0]),
    });
    expect(res.status).toBe(422);
  });

  it('知らない段の種類は弾く', async () => {
    const res = await req(`/api/funnels?${ACCOUNT}`, 'POST', {
      name: 'x',
      steps: [validSteps[0], { label: 'y', kind: 'horoscope', match: {} }],
    });
    expect(res.status).toBe(422);
  });

  it('段の名前が空なら弾く', async () => {
    const res = await req(`/api/funnels?${ACCOUNT}`, 'POST', {
      name: 'x',
      steps: [validSteps[0], { label: '  ', kind: 'tag', match: {} }],
    });
    expect(res.status).toBe(422);
  });

  it('正しければ作れる', async () => {
    const res = await req(`/api/funnels?${ACCOUNT}`, 'POST', { name: '購入まで', steps: validSteps });
    expect(res.status).toBe(201);
    expect(mocks.createFunnel).toHaveBeenCalledWith(env.DB, expect.objectContaining({ lineAccountId: 'account-a' }));
  });
});

describe('ファネルの結果', () => {
  it('前の段を通った人だけを次の段で見る', async () => {
    await req(`/api/funnels/fn-1/result?${ACCOUNT}`);
    const secondCall = mocks.countFunnelStep.mock.calls[1];
    expect(secondCall[2].friendIds).toEqual(['f-1', 'f-2']);
    expect(secondCall[2].lineAccountId).toBe('account-a');
  });

  it('誰も通らなかったら、その先は問い合わせない', async () => {
    mocks.countFunnelStep.mockResolvedValueOnce([]);
    const res = await req(`/api/funnels/fn-1/result?${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mocks.countFunnelStep).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { data: { steps: Array<{ reached: number }> } };
    expect(body.data.steps[1].reached).toBe(0);
  });

  it('無いファネルは404', async () => {
    mocks.getFunnelById.mockResolvedValue(null);
    const res = await req(`/api/funnels/nope/result?${ACCOUNT}`);
    expect(res.status).toBe(404);
  });
});

describe('現行ファネルの削除', () => {
  it('V6の版付き定義は現行APIから削除できない', async () => {
    const res = await req(`/api/funnels/fn-1?${ACCOUNT}`, 'DELETE');
    expect(res.status).toBe(404);
    expect(mocks.deleteFunnel).not.toHaveBeenCalled();
  });

  it('現行形式だけを削除できる', async () => {
    mocks.getCurrentFunnelVersion.mockResolvedValueOnce(null);
    const res = await req(`/api/funnels/fn-1?${ACCOUNT}`, 'DELETE');
    expect(res.status).toBe(200);
    expect(mocks.deleteFunnel).toHaveBeenCalledWith(env.DB, 'account-a', 'fn-1');
  });
});

describe('V6ファネルAPI', () => {
  const body = {
    name: '購入まで',
    windowDays: 14,
    steps: [
      { label: '追加', kind: 'friend_add', match: {} },
      { label: '購入', kind: 'purchase', match: { status: 'confirmed' } },
    ],
  };

  it('一覧で現行定義の移行要否を分ける', async () => {
    mocks.getCurrentFunnelVersion.mockResolvedValueOnce(null);
    const res = await req(`/api/analytics/funnels?${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: [{ id: 'fn-1', currentVersion: null, migrationState: 'needs_migration' }],
    });
  });

  it('作成時に第1版を固定する', async () => {
    const res = await req(`/api/analytics/funnels?${ACCOUNT}`, 'POST', body);
    expect(res.status).toBe(201);
    expect(mocks.createVersionedFunnel).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({ lineAccountId: 'account-a', windowDays: 14, createdBy: 'u-1' }),
    );
  });

  it('タイムゾーン付き期間で不変結果を作る', async () => {
    const res = await req(`/api/analytics/funnels/fn-1/run?${ACCOUNT}`, 'POST', {
      cohortFrom: '2026-08-01T00:00:00.000+09:00',
      cohortTo: '2026-08-10T23:59:59.999+09:00',
    });
    expect(res.status).toBe(201);
    expect(mocks.runChronologicalFunnel).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        lineAccountId: 'account-a', funnelId: 'fn-1', timeZone: 'Asia/Tokyo', persist: true,
      }),
    );
  });

  it('時刻にタイムゾーンがなければ集計しない', async () => {
    const res = await req(`/api/analytics/funnels/fn-1/run?${ACCOUNT}`, 'POST', {
      cohortFrom: '2026-08-01T00:00:00',
      cohortTo: '2026-08-10T23:59:59',
    });
    expect(res.status).toBe(422);
    expect(mocks.runChronologicalFunnel).not.toHaveBeenCalled();
  });

  it('対象者IDだけを返し、友だちIDをURLへ出さない', async () => {
    const res = await req(`/api/analytics/results/run-1/audiences?${ACCOUNT}`, 'POST', {
      stepOrder: 2,
      selection: 'stopped',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { id: 'audience-1', memberCount: 1 },
    });
  });
});

describe('LINE公式アカウントの分離', () => {
  it('アカウント指定がなければ集計しない', async () => {
    const res = await req('/api/analytics/messages');
    expect(res.status).toBe(400);
    expect(mocks.getDailyMessageCounts).not.toHaveBeenCalled();
  });

  it('権限外アカウントは存在を明かさない', async () => {
    const res = await req('/api/analytics/messages?account_id=account-b');
    expect(res.status).toBe(404);
    expect(mocks.getDailyMessageCounts).not.toHaveBeenCalled();
  });

  it('ファネル一覧も選択中アカウントだけで読む', async () => {
    const res = await req(`/api/funnels?${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mocks.getLegacyFunnels).toHaveBeenCalledWith(env.DB, 'account-a');
  });
});
