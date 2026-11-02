// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const ranks = [
  { key: 'regular', name: 'レギュラー', thresholdYen: 0, mileRatePercent: 1 },
  { key: 'gold', name: 'ゴールド', thresholdYen: 60000, mileRatePercent: 2 },
];

test.each([
  { key: 'diamond', name: 'ダイヤモンド', known: false },
  { key: null, name: '会員', known: false },
  { key: null, name: '未設定', known: false },
  { key: 'regular', name: 'レギュラー', known: true },
])('会員画面は位置を確認できる場合だけ目盛りを表示する: $name', async ({ key, name, known }) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="app"></div>';
  const membership = { rankConfigured: true, rankPositionKnown: known, rankKey: key, rankName: name,
    mileRatePercent: null, annualMilesYen: 10000, lifetimeMilesYen: 10000, mileBalance: 123,
    validUntil: null, next: known ? { name: 'ゴールド', thresholdYen: 60000, remainingYen: 50000 } : null,
    ranks, milestones: [], nextMilestone: null };
  const member = { owner: { displayName: 'サンプル' }, membership, pets: [], photos: [],
    commerce: { orders: [], subscription: null, purchaseAmount: 0, points: 0, rank: name },
    photoStats: { submittedCount: 0, pendingCount: 0, adoptedCount: 0, earnedPoints: 0 } };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: member }))));
  const { mountNenMember } = await import('./main.js');
  await act(async () => mountNenMember(document.getElementById('app')!, { liffId: 'sample', lineUserId: 'sample', idToken: 'sample' }));
  const sheet = document.querySelector('.nm-membership-sheet')!;
  expect(sheet.textContent).toContain(name);
  expect(Boolean(sheet.querySelector('.nm-rank-levels'))).toBe(known);
  expect(Boolean(sheet.querySelector('.nm-gauge-value'))).toBe(known);
  if (known) expect(sheet.textContent).toContain('ゴールドまで あと');
  else {
    expect(sheet.textContent).toContain('ランクは未設定です');
    expect(sheet.textContent).not.toMatch(/ゴールド|レギュラー|最高ランク|まで あと/);
  }
});
