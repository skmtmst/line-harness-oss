// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); document.body.innerHTML = ''; });
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(b => b.textContent?.includes(label));
  expect(found, label).toBeTruthy();
  return found!;
}
const booking = (id: string, name: string) => ({
  id, event_id: id, event_name: name, status: 'confirmed', customer_note: null,
  event_image_url: null, venue_name: null, venue_url: null, cancel_deadline_hours_before: null,
  slot_starts_at: '2030-10-20T10:00:00Z', slot_ends_at: '2030-10-20T11:00:00Z',
});
const response = (items: unknown[]) => new Response(JSON.stringify({ items }));

test.each(['success', 'error'] as const)('OPSSET-02: 遅れた旧タブの%sは、選択中タブと読込状態を上書きしない', async stale => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="app"></div>';
  const pending: Array<{ tab: string; resolve: (r: Response) => void }> = [];
  vi.stubGlobal('fetch', vi.fn((url: string) => new Promise<Response>(resolve => {
    pending.push({ tab: new URL(url).searchParams.get('tab')!, resolve });
  })));
  const { mountEventBooking } = await import('./main.js');
  await act(async () => mountEventBooking(document.getElementById('app')!, { liffId: 'store', lineUserId: 'friend', idToken: 'token' }, { kind: 'history' }));
  await act(async () => button('過去').click());
  await act(async () => pending.filter(p => p.tab === 'upcoming').forEach(p => p.resolve(stale === 'error' ? new Response('{}', { status: 503 }) : response([booking('up', '旧タブの予約')]))));
  expect(document.body.textContent).not.toContain('旧タブの予約');
  expect(document.body.textContent).not.toContain('予約はありません');
  await act(async () => pending.filter(p => p.tab === 'past').forEach(p => p.resolve(response([booking('past', '過去の予約A')]))));
  expect(document.body.textContent).toContain('過去の予約A');
  expect(document.body.textContent).not.toContain('旧タブの予約');
  expect(document.body.textContent).not.toContain('API 503');
});

test('イベント履歴の失敗は空履歴を出さず、もう一度から回復する', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="app"></div>';
  let fail = true;
  const fetch = vi.fn(async () => fail ? new Response('{}', { status: 503 }) : response([]));
  vi.stubGlobal('fetch', fetch);
  const { mountEventBooking } = await import('./main.js');
  await act(async () => mountEventBooking(document.getElementById('app')!, { liffId: 'store', lineUserId: 'friend', idToken: 'token' }, { kind: 'history' }));
  expect(document.body.textContent).toContain('読み込めませんでした');
  expect(document.body.textContent).not.toContain('予約はありません');
  fail = false;
  await act(async () => button('もう一度').click());
  expect(document.body.textContent).toContain('これからの予約はありません');
});
