// @vitest-environment happy-dom
import { emptyLayout } from '@line-crm/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { initForm } from './form.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', '/?page=form&id=form-a&liffId=store-a');
  vi.stubGlobal('liff', {
    getProfile: vi.fn().mockResolvedValue({ userId: 'user-a', displayName: '利用者' }),
    getIDToken: () => null,
  });
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

test.each([true, false])('予約ブロックの受付が%sの時、保存済みのフォームを読み、受付中だけ既存の予約入口を1回開く', async active => {
  const layout = emptyLayout();
  layout.sections[0].blocks = [{ id: 'booking', kind: 'input', type: 'booking', name: 'visit', label: '予約',
    booking: { menuId: 'menu-a', staffId: null, daysAhead: 14 } }];
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {
    id: 'form-a', name: '予約フォーム', isActive: active, layout,
  } })));
  vi.stubGlobal('fetch', fetch);
  const openBooking = vi.fn().mockResolvedValue(undefined);
  await initForm('form-a', openBooking);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('/api/forms/form-a');
  expect(openBooking).toHaveBeenCalledTimes(active ? 1 : 0);
  if (!active) expect(document.body.textContent).toContain('受付を停止');
  expect(window.location.search).toBe('?page=form&id=form-a&liffId=store-a');
});
