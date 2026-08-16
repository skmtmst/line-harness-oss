import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = {
  getDailyMessageCounts: vi.fn(),
  getLinkClickSummary: vi.fn(),
  getBroadcastSummary: vi.fn(),
  getTagFieldCross: vi.fn(),
  getFunnels: vi.fn(),
  getFunnelById: vi.fn(),
  getFunnelSteps: vi.fn(),
  createFunnel: vi.fn(),
  deleteFunnel: vi.fn(),
  countFunnelStep: vi.fn(),
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

const FUNNEL = { id: 'fn-1', name: '購入まで', segment_json: null, window_days: 30, created_at: '2026-08-16' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDailyMessageCounts.mockResolvedValue([]);
  mocks.getLinkClickSummary.mockResolvedValue([]);
  mocks.getBroadcastSummary.mockResolvedValue([]);
  mocks.getTagFieldCross.mockResolvedValue([]);
  mocks.getFunnels.mockResolvedValue([FUNNEL]);
  mocks.getFunnelById.mockResolvedValue(FUNNEL);
  mocks.getFunnelSteps.mockResolvedValue([
    { id: 's1', funnel_id: 'fn-1', step_order: 1, label: '友だち追加', kind: 'tag', match_json: '{}' },
    { id: 's2', funnel_id: 'fn-1', step_order: 2, label: '購入', kind: 'conversion', match_json: '{}' },
  ]);
  mocks.createFunnel.mockResolvedValue(FUNNEL);
  mocks.countFunnelStep.mockResolvedValue(['f-1', 'f-2']);
});

describe('期間の指定', () => {
  it('省略すると直近30日になる', async () => {
    const res = await req('/api/analytics/messages');
    expect(res.status).toBe(200);
    const [, range] = mocks.getDailyMessageCounts.mock.calls[0];
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('終了日はその日いっぱいを含める', async () => {
    // '2026-08-16' で切ると、その日のぶんがまるごと落ちる。
    await req('/api/analytics/messages?from=2026-08-01&to=2026-08-16');
    const [, range] = mocks.getDailyMessageCounts.mock.calls[0];
    expect(range.to).toBe('2026-08-16T23:59:59.999');
  });

  it('形が違えば弾く', async () => {
    const res = await req('/api/analytics/messages?from=2026/08/01');
    expect(res.status).toBe(400);
    expect(mocks.getDailyMessageCounts).not.toHaveBeenCalled();
  });

  it('開始と終了が逆なら弾く', async () => {
    const res = await req('/api/analytics/messages?from=2026-08-20&to=2026-08-01');
    expect(res.status).toBe(400);
  });

  it('長すぎる期間は弾く', async () => {
    // 期間を長くするほど走査する行が増える。
    const res = await req('/api/analytics/messages?from=2020-01-01&to=2026-08-16');
    expect(res.status).toBe(400);
  });
});

describe('クロス集計', () => {
  it('項目の指定が要る', async () => {
    const res = await req('/api/analytics/cross');
    expect(res.status).toBe(400);
  });

  it('項目を指定すれば返る', async () => {
    const res = await req('/api/analytics/cross?fieldId=ff-1');
    expect(res.status).toBe(200);
    expect(mocks.getTagFieldCross).toHaveBeenCalledWith(env.DB, 'ff-1');
  });
});

describe('ファネルの作成', () => {
  const validSteps = [
    { label: '友だち追加', kind: 'tag', match: { tagId: 't1' } },
    { label: '購入', kind: 'conversion', match: { conversionPointId: 'cp1' } },
  ];

  it('2段以上でないと作れない', async () => {
    // 1段は「ただの件数」で、離脱を見るという目的を果たさない。
    const res = await req('/api/funnels', 'POST', { name: 'x', steps: [validSteps[0]] });
    expect(res.status).toBe(422);
    expect(mocks.createFunnel).not.toHaveBeenCalled();
  });

  it('10段を超えたら弾く', async () => {
    const res = await req('/api/funnels', 'POST', {
      name: 'x',
      steps: Array.from({ length: 11 }, () => validSteps[0]),
    });
    expect(res.status).toBe(422);
  });

  it('知らない段の種類は弾く', async () => {
    const res = await req('/api/funnels', 'POST', {
      name: 'x',
      steps: [validSteps[0], { label: 'y', kind: 'horoscope', match: {} }],
    });
    expect(res.status).toBe(422);
  });

  it('段の名前が空なら弾く', async () => {
    const res = await req('/api/funnels', 'POST', {
      name: 'x',
      steps: [validSteps[0], { label: '  ', kind: 'tag', match: {} }],
    });
    expect(res.status).toBe(422);
  });

  it('正しければ作れる', async () => {
    const res = await req('/api/funnels', 'POST', { name: '購入まで', steps: validSteps });
    expect(res.status).toBe(201);
  });
});

describe('ファネルの結果', () => {
  it('前の段を通った人だけを次の段で見る', async () => {
    // 段ごとに独立して数えると、途中を飛ばした人まで含まれて、
    // 下の段が上の段より多い表になる。
    await req('/api/funnels/fn-1/result');
    const secondCall = mocks.countFunnelStep.mock.calls[1];
    expect(secondCall[2].friendIds).toEqual(['f-1', 'f-2']);
  });

  it('1段目は全員が対象', async () => {
    await req('/api/funnels/fn-1/result');
    const firstCall = mocks.countFunnelStep.mock.calls[0];
    expect(firstCall[2].friendIds).toBeUndefined();
  });

  it('誰も通らなかったら、その先は問い合わせない', async () => {
    mocks.countFunnelStep.mockResolvedValueOnce([]);
    const res = await req('/api/funnels/fn-1/result');
    expect(res.status).toBe(200);
    // 1段目で0人なら2段目は数えない。必ず0になるので。
    expect(mocks.countFunnelStep).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { data: { steps: Array<{ reached: number }> } };
    expect(body.data.steps).toHaveLength(2);
    expect(body.data.steps[1].reached).toBe(0);
  });

  it('無いファネルは404', async () => {
    mocks.getFunnelById.mockResolvedValue(null);
    const res = await req('/api/funnels/nope/result');
    expect(res.status).toBe(404);
  });
});
