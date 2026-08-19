import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyLineMonthlyPlan, fetchLineMonthlyPlan } from './line-monthly-plan.js';

afterEach(() => vi.unstubAllGlobals());

describe('LINE月額プランの自動判定', () => {
  it.each([
    [200, 'communication', 'コミュニケーション'],
    [5_000, 'light', 'ライト'],
    [30_000, 'standard', 'スタンダード'],
    [45_000, 'standard', 'スタンダード'],
  ] as const)('当月上限%s通を%sとして表示する', (limit, key, label) => {
    expect(classifyLineMonthlyPlan(limit)).toMatchObject({ key, label, monthlyMessageLimit: limit });
  });

  it('LINE APIの上限を取得して判定する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ type: 'limited', value: 200 })));
    await expect(fetchLineMonthlyPlan('test-token')).resolves.toMatchObject({
      key: 'communication',
      label: 'コミュニケーション',
      monthlyMessageLimit: 200,
    });
  });

  it('取得失敗を契約プランだと誤判定しない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    await expect(fetchLineMonthlyPlan('test-token')).resolves.toMatchObject({
      key: 'unknown',
      label: '取得できません',
      monthlyMessageLimit: null,
    });
  });
});
