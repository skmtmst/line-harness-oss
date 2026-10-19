// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

test.each(['http', 'offline', 'unsuccessful'] as const)('UI2-C02: %sの失敗は空きなしと分け、もう一度で回復する', async failure => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('liff', { getProfile: async () => ({ userId: 'friend', displayName: 'お客さま' }), getIDToken: () => null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let fail = true;
  const fetch = vi.fn(async () => {
    if (fail && failure === 'offline') throw new Error('offline');
    return new Response(JSON.stringify({ success: !fail || failure !== 'unsuccessful', data: [] }), { status: fail && failure === 'http' ? 503 : 200 });
  });
  vi.stubGlobal('fetch', fetch);
  const { initBooking } = await import('./booking.js');
  await initBooking();
  (document.querySelector('.cal-day.active') as HTMLElement).click();
  await vi.waitFor(() => expect(document.body.textContent).toContain('読み込めませんでした'));
  expect(document.body.textContent).not.toContain('この日は予約枠がありません');
  fail = false;
  const retry = document.querySelector('[data-action="retry-slots"]') as HTMLButtonElement;
  expect(retry).toBeTruthy();
  retry.click();
  await vi.waitFor(() => expect(document.body.textContent).toContain('この日は予約枠がありません'));
  expect(document.body.textContent).not.toContain('読み込めませんでした');
  expect(fetch).toHaveBeenCalledTimes(2);
});
