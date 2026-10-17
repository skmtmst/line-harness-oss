// @vitest-environment happy-dom
import { act } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mountSalonBooking, unmountSalonBooking } from '../../worker/src/client/salon-booking/main.js';

let calendarMode = 'week-first';
let availability: 'ok' | 'error' | 'pending' = 'ok';
let submit: (() => Promise<Response>) | null = null;
const requests: Array<{ url: URL; options: RequestInit }> = [];
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList);
  // 端末の記憶より店の4択を調べるため、記憶なしにする。
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  requests.length = 0; availability = 'ok'; submit = null;
  window.history.replaceState(null, '', '/?liffId=store&page=salon-book&menu_id=m');
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = new URL(String(input), window.location.origin);
    requests.push({ url, options });
    if (url.pathname === '/api/liff/customer-look') return reply({ success: true, data: { settings: { liff_theme: 'night' } } });
    if (url.pathname === '/api/liff/config') return reply({ success: true, data: { accountName: '試験店' } });
    if (url.pathname.endsWith('/requests') && submit) return submit();
    if (url.pathname.endsWith('/cost-estimate')) return reply({ success: true, data: { cancellation: { enabled: false, version: 0, price: 1000, cardRequired: true, tiers: [{ beforeHours: 24, percent: 0 }, { beforeHours: 0, percent: 50 }], noShowPercent: 100, freeUntil: null }, deposit: { amount: 0 } } });
    if (url.pathname.endsWith('/entitlements')) return reply({ success: true, data: [] });
    if (url.pathname.endsWith('/settings')) return reply({ liff_calendar_mode: calendarMode, booking_window_days: 60 });
    if (url.pathname.endsWith('/menus')) return reply({ menus: [{ id: 'm', name: '試験メニュー', duration_minutes: 30, base_price: 1000 }] });
    if (url.pathname.endsWith('/staff')) return reply({ staff: [{ id: 's', display_name: '試験担当', price: 1000, duration_minutes: 30 }] });
    if (url.pathname.endsWith('/last-booking')) return reply({ available: false });
    if (url.pathname.endsWith('/availability')) {
      if (availability === 'pending') return new Promise<Response>(() => {});
      if (availability === 'error') return reply({}, 503);
      return reply({ by_staff: [{ staff_id: 's', slots: [{ date: url.searchParams.get('from'), start: '10:00', end: '10:30', remaining: 1 }] }] });
    }
    if (url.pathname.endsWith('/me')) return reply({ upcoming: [{ id: 'b', starts_at: '2099-10-20T01:00:00Z', status: 'confirmed', menu_name: '試験メニュー', staff_name: '試験担当', lock_version: 3, menu_id: 'm', staff_id: 's', cancel_deadline_at: '2099-10-19T01:00:00Z' }], past: [] });
    if (url.pathname.endsWith('/cancel')) return reply({ status: 'cancelled', lock_version: 4 });
    if (url.pathname.endsWith('/reschedule')) return reply({ status: 'confirmed', lock_version: 4 });
    throw new Error(`未設定の人工API: ${url.pathname}`);
  }));
});
afterEach(async () => { await act(async () => unmountSalonBooking()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function open(history = false) {
  if (history) window.history.replaceState(null, '', '/?liffId=store&page=salon-book&view=history');
  await act(async () => mountSalonBooking(document.getElementById('app')!, { liffId: 'store', lineUserId: 'friend', idToken: 'token' }));
}
async function datetime() {
  await open();
  fireEvent.click(await screen.findByRole('button', { name: /試験担当/ }));
  const next = screen.queryByRole('button', { name: '日時を選ぶ' });
  if (next) fireEvent.click(next);
}

test('NORMAL3-02: 現役入口の日時取得の失敗から、同じ選択のままやり直せる', async () => {
  calendarMode = 'week-first'; availability = 'error';
  await datetime();
  const retry = await screen.findByRole('button', { name: 'もう一度読み込む' });
  expect(screen.queryByText('この週は空きがありません')).toBeNull();
  availability = 'ok'; fireEvent.click(retry);
  await screen.findByRole('button', { name: /10:00/ });
  expect(requests.filter(r => r.url.pathname.endsWith('/availability')).every(r => new Headers(r.options.headers).get('Authorization') === 'Bearer token')).toBe(true);
});
test('NORMAL3-02: 現役入口の日時取得中は骨組みを見せる', async () => {
  calendarMode = 'week-first'; availability = 'pending';
  await datetime();
  await vi.waitFor(() => expect(document.querySelector('[data-design-node="AcTHQ"]')).toBeTruthy());
});
test.each(['week-first', 'month-first', 'week-only', 'month-only'])('NORMAL3-04: 現役入口が店の%sを読み分ける', async mode => {
  calendarMode = mode;
  await datetime();
  await vi.waitFor(() => expect(document.querySelector('[data-design-node="'+(mode.startsWith('month') ? 'k3aJKU' : 'M2p63S')+'"]')).toBeTruthy());
  if (mode.endsWith('only')) expect(screen.queryByRole('radiogroup', { name: '表示の切り替え' })).toBeNull();
  else {
    expect(screen.getByRole('radio', { name: '週で見る' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'カレンダー' })).toBeTruthy();
  }
});
test('NORMAL3-03: 現役履歴から版つきの取消を確かめて既存APIへ送る', async () => {
  await open(true);
  fireEvent.click(await screen.findByRole('button', { name: 'キャンセル' }));
  expect(screen.getByRole('button', { name: '日時を変える' })).toBeTruthy();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'キャンセルする' }));
  await vi.waitFor(() => expect(requests.find(r => r.url.pathname.endsWith('/cancel'))).toBeTruthy());
  const sent = requests.find(r => r.url.pathname.endsWith('/cancel'))!;
  expect(JSON.parse(String(sent.options.body))).toEqual({ lock_version: 3 });
});


test.each(['成功', '失敗'])('XL-01: 現役Worker入口でも選び直したあとの古い%sを採用しない', async outcome => {
  calendarMode = 'week-first';
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  submit = () => pending;
  await datetime();
  fireEvent.click(await screen.findByRole('button', { name: /10:00/ }));
  fireEvent.click(await screen.findByRole('button', { name: '内容を確かめる' }));
  const send = await screen.findByRole('button', { name: 'この内容で予約をリクエストする' });
  await vi.waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(send);
  await vi.waitFor(() => expect(requests.some(r => r.url.pathname.endsWith('/requests'))).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: '確かめを閉じて日時に戻る' }));
  await screen.findByRole('button', { name: /10:00/ });
  await act(async () => { finish(outcome === '成功' ? reply({ booking_id: 'old', status: 'confirmed' }) : reply({}, 503)); await pending; });
  expect(screen.queryByText('ご予約を受け付けました')).toBeNull();
  expect(screen.queryByText(/予約リクエストの送信に失敗/)).toBeNull();
  expect(screen.getByRole('button', { name: /10:00/ })).toBeTruthy();
});
