// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); window.history.replaceState(null, '', '/'); });

test.each(['http', 'offline'] as const)('UI2-C03: 会員の日記の%s失敗は履歴なしと分け、再試行で回復する', async failure => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/?tab=health');
  document.body.innerHTML = '<div id="app"></div>';
  const member = { owner: { displayName: 'お客さま' }, pets: [{ id: 'pet', name: 'テスト犬', animalType: 'dog', birthday: '2020-01-01', concerns: [], weightKg: 5 }], commerce: { orders: [], subscription: null, purchaseAmount: 0, points: 0, rank: 'レギュラー' } };
  let fail = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (new URL(url, window.location.origin).pathname.endsWith('/member')) return new Response(JSON.stringify({ data: member }));
    if (fail && failure === 'offline') throw new Error('offline');
    return new Response(JSON.stringify({ data: [] }), { status: fail ? 503 : 200 });
  }));
  const { mountNenMember } = await import('./main.js');
  await act(async () => mountNenMember(document.getElementById('app')!, { liffId: 'store', lineUserId: 'friend', idToken: 'token' }));
  expect(document.body.textContent).toContain('読み込めませんでした');
  expect(document.body.textContent).not.toContain('まだ記録がありません');
  fail = false;
  const retry = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('もう一度'));
  expect(retry).toBeTruthy();
  await act(async () => retry!.click());
  expect(document.body.textContent).toContain('記録がありません');
  expect(document.body.textContent).not.toContain('読み込めませんでした');
});
