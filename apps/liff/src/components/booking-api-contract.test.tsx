// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Confirm from './confirm.js';
import RecurringCard from './recurring-card.js';
import BookingHistoryCancelDialog from './booking-history-cancel-dialog.js';
import { api, type MenuItem, type StaffItem, type BookingHistoryItem } from '../lib/api.js';

vi.mock('../lib/liff-auth.js', () => ({ getLiffId: () => 'liff-a', getIdToken: () => 'token' }));
vi.mock('../lib/user-message.js', async (original) => ({ ...await original<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
const menu = { id: 'menu', name: '相談', base_price: 8400, duration_minutes: 60 } as MenuItem;
const staff = { id: 'bs', display_name: '担当', price: 8400, duration_minutes: 60 } as StaffItem;
const estimate = (enabled = true) => ({ success: true, data: {
  cancellation: { enabled, version: 2, price: 8400, tiers: [{ beforeHours: 24, percent: 0 }, { beforeHours: 0, percent: 50 }], noShowPercent: 100,
    freeUntil: enabled ? '2099-01-01T01:00:00.000Z' : null, feeNow: 0, feeNoShow: enabled ? 8400 : 0, policyAcceptedRequired: enabled, cardRequired: true },
  deposit: { amount: 0, paymentCollectionAvailable: false, testMode: true },
} });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let failEstimate = false;
let failRequestPolicy = false;
let writes: Array<{ path: string; body: Record<string, unknown> }>;
let reads: URL[];
beforeEach(() => {
  failEstimate = false; failRequestPolicy = false; writes = []; reads = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); reads.push(url);
    expect(url.searchParams.get('liffId')).toBe('liff-a');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token' });
    if (url.pathname.endsWith('/cost-estimate')) return failEstimate ? json({ error: 'storage_unavailable' }, 503) : json(estimate());
    if (url.pathname.endsWith('/entitlements')) return json({ success: true, data: [] });
    if (url.pathname.endsWith('/setup-intent')) return json({ success: true, data: { setupIntentId: 'seti_test_1', status: 'ready', url: '', testMode: true } }, 201);
    if (url.pathname.endsWith('/requests')) {
      writes.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
      return failRequestPolicy ? json({ error: 'policy_changed' }, 409) : json({ booking_id: 'b1', status: 'confirmed' }, 201);
    }
    throw new Error(`Unexpected API: ${url.pathname}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function confirm() {
  const submitted = vi.fn();
  render(<Confirm menu={menu} staff={staff} slot={{ date: '2099-01-02', start: '10:00' }} autoConfirm onSubmitted={submitted} />);
  return submitted;
}
it('実際のAPI関数で費用見積もりを読み、同意・版・登録IDを送って予約が完了する', async () => {
  const submitted = confirm();
  expect((screen.getByRole('button', { name: 'この内容で予約を確定する' }) as HTMLButtonElement).disabled).toBe(true);
  const box = await screen.findByRole('checkbox', { name: 'キャンセル料の決まりを確認しました' });
  expect((box as HTMLInputElement).checked).toBe(false);
  fireEvent.click(box);
  fireEvent.click(screen.getByRole('button', { name: '試験のカードを登録して予約する' }));
  await waitFor(() => expect(submitted).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'b1' })));
  expect(writes).toEqual([{ path: '/api/liff/booking/requests', body: {
    menu_id: 'menu', staff_id: 'bs', starts_at: '2099-01-02T01:00:00.000Z', policyAccepted: true, policyVersion: 2, setupIntentId: 'seti_test_1',
  } }]);
  const url = reads.find((u) => u.pathname.endsWith('/cost-estimate'))!;
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ menu_id: 'menu', staff_id: 'bs', starts_at: '2099-01-02T01:00:00.000Z' });
});
it('読み込み失敗時は確認で止まり、もう一度で回復してから同意できる', async () => {
  failEstimate = true;
  confirm();
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('決まりを読み込めませんでした'));
  const submit = screen.getByRole('button', { name: 'この内容で予約を確定する' }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true); fireEvent.click(submit); expect(writes).toHaveLength(0);
  failEstimate = false;
  fireEvent.click(screen.getByRole('button', { name: 'もう一度' }));
  expect(await screen.findByRole('checkbox')).toBeTruthy();
  expect((screen.getByRole('button', { name: '試験のカードを登録して予約する' }) as HTMLButtonElement).disabled).toBe(true);
});
it('版が変わった後の再読み込み失敗でも、決まりなしで再送しない', async () => {
  confirm();
  fireEvent.click(await screen.findByRole('checkbox'));
  failRequestPolicy = true; failEstimate = true;
  fireEvent.click(screen.getByRole('button', { name: '試験のカードを登録して予約する' }));
  await screen.findByText('キャンセル料の決まりを読み込めませんでした。');
  expect(writes).toHaveLength(1);
  expect((screen.getByRole('button', { name: 'この内容で予約を確定する' }) as HTMLButtonElement).disabled).toBe(true);
});
it.each([404, 503])('APIの取得失敗 %s をnullにしない', async (status) => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'unavailable' }, status)));
  await expect(api.cancellationPreview({ menuId: menu.id, staffId: staff.id, startsAt: '2099-01-02T01:00:00Z' })).rejects.toMatchObject({ status });
});
it('決まりがオフの正常応答と不完全な応答を区別する', async () => {
  const read = () => api.cancellationPreview({ menuId: menu.id, staffId: staff.id, startsAt: '2099-01-02T01:00:00Z' });
  vi.stubGlobal('fetch', vi.fn(async () => json(estimate(false))));
  await expect(read()).resolves.toMatchObject({ enabled: false, version: 2 });
  vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, data: { cancellation: {}, deposit: {} } })));
  await expect(read()).rejects.toThrow('応答の形が違います');
});
it('繰り返しの本物のAPI関数はruleを送り、data.occurrencesの日時をカードへ渡す', async () => {
  const start = '2099-01-02T01:00:00.000Z';
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body))).toEqual({ menuId: 'menu', staffId: 'bs', startsAt: start, rule: { freq: 'weekly', count: 4 } });
    return json({ success: true, data: { occurrences: [0, 1, 2, 3].map((index) => ({ index, startsAt: new Date(Date.parse(start) + index * 7 * 86400000).toISOString(), available: index !== 1, reason: index === 1 ? 'slot_unavailable' : null, alternatives: [] })) } });
  });
  vi.stubGlobal('fetch', fetcher);
  const changed = vi.fn();
  render(<RecurringCard menu={{ ...menu, recurring: { enabled: true, max_count: 12 } }} staff={staff} startsAt={start} onChange={changed} />);
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ count: 4, made: 3 })));
  expect(screen.getByText('取れない回は飛ばして 3 回で予約します。1 回ずつ取り消せます。')).toBeTruthy();
  expect(screen.getByText('1/2（金）10:00')).toBeTruthy();
  expect(screen.getByText(/空きがありません/)).toBeTruthy();
});
it('店頭払いでは全額返金の約束や返金を受ける操作を出さない', () => {
  render(<BookingHistoryCancelDialog booking={{ starts_at: '2099-01-02T01:00:00Z', menu_name: '相談', staff_name: '担当' } as BookingHistoryItem}
    payment={{ kind: 'onsite', label: 'お店で払う', tone: 'neutral', amount: 8400, receiptUrl: null, holdUntil: null }} busy={false} error={null} onConfirm={() => {}} onCancel={() => {}} />);
  expect(screen.queryByText(/全額返金/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'キャンセルする（試験返金）' })).toBeNull();
  expect(screen.getByRole('button', { name: 'キャンセルする' })).toBeTruthy();
});

it('キャンセル料が掛かる支払い済み予約では、自動の全額返金を約束しない', () => {
  render(<BookingHistoryCancelDialog booking={{ starts_at: '2099-01-02T01:00:00Z', menu_name: '相談', staff_name: '担当', cancellationQuote: { feeNow: 4200 } } as BookingHistoryItem}
    payment={{ kind: 'paid', label: '支払い済み', tone: 'confirmed', amount: 8400, receiptUrl: null, holdUntil: null }} busy={false} error={null} onConfirm={() => {}} onCancel={() => {}} />);
  expect(screen.queryByText(/全額返金/)).toBeNull();
  expect(screen.getByText('返金についてはトークで担当者へご確認ください。')).toBeTruthy();
});

it('キャンセル料が3段の店は、見積もりの段を省かず同意の前に表示する', async () => {
  const data = estimate();
  data.data.cancellation.tiers = [{ beforeHours: 24, percent: 0 }, { beforeHours: 12, percent: 25 }, { beforeHours: 0, percent: 50 }];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/cost-estimate') ? json(data) : json({ success: true, data: [] })));
  confirm();
  expect(await screen.findByText('開始の12時間前まで')).toBeTruthy();
  expect(screen.getByText('料金の 25%（¥2,100）')).toBeTruthy();
  expect(screen.getByText('料金の 50%（¥4,200）')).toBeTruthy();
});


it('返金額が未取得の試験記録を0円と表示しない', () => {
  render(<BookingHistoryCancelDialog booking={{ starts_at: '2099-01-02T01:00:00Z', menu_name: '相談', staff_name: '担当' } as BookingHistoryItem}
    payment={{ kind: 'paid', label: '支払い済み', tone: 'confirmed', amount: null, receiptUrl: null, holdUntil: null }} busy={false} error={null} onConfirm={() => {}} onCancel={() => {}} />);
  expect(screen.getByText('試験の全額返金を記録します（金額は未取得です）')).toBeTruthy();
  expect(screen.queryByText(/¥0/)).toBeNull();
});


it('回数券の回数が未取得なら確認画面でも0回にしない', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/cost-estimate')
    ? json(estimate(false)) : json({ success: true, data: [{ id: 'pass', name: '人工の回数券', kind: 'ticket', usable: true, remaining: null }] })));
  confirm();
  expect(await screen.findByText('残り — 回')).toBeTruthy();
  expect(screen.queryByText('残り 0 回')).toBeNull();
});
