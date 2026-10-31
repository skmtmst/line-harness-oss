// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Confirm from './confirm.js';
import { api, type BookingCancellationPreview, type BookingEntitlement } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: { cancellationPreview: vi.fn(), entitlements: vi.fn(), createRequest: vi.fn(), cancellationSetup: vi.fn() } }));
const menu = { id: 'm', name: 'カット', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 8400, sort_order: 0, payment_mode: 'online' as const };
const staff = { id: 's', display_name: '担当', role: null, profile_image_url: null, bio: null, is_designation_optional: 0, price: 8400, duration_minutes: 60 };
const slot = { date: '2099-01-01', start: '10:00' };
const title = 'カード決済は準備中です';
const preview = (over: Partial<BookingCancellationPreview> = {}): BookingCancellationPreview => ({ enabled: false, version: 2, freeUntil: null, afterPercent: 50, noShowPercent: 100, price: 8400, deposit: null, payment: { mode: 'online', allowedMethods: ['online'] }, ...over });
const bar = () => document.querySelector('[data-liff-bottom-bar]') as HTMLElement;
function expectNotice() {
  expect(screen.getAllByText(title)).toHaveLength(1);
  expect(within(bar()).getByText(title)).toBeTruthy();
  expect(within(bar()).getByText(/いまは試験用のお支払いです。実際の請求・返金は行われません/)).toBeTruthy();
}
beforeEach(() => {
  vi.mocked(api.cancellationPreview).mockReset().mockResolvedValue(preview());
  vi.mocked(api.entitlements).mockReset().mockResolvedValue([]);
  vi.mocked(api.createRequest).mockReset(); vi.mocked(api.cancellationSetup).mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('external_network_forbidden'); }));
});
afterEach(() => { expect(api.createRequest).not.toHaveBeenCalled(); expect(api.cancellationSetup).not.toHaveBeenCalled(); cleanup(); vi.unstubAllGlobals(); });

it('有料オンラインの試験案内を予約操作の帯に1か所だけ出す', async () => {
  render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm onSubmitted={() => {}} />);
  await waitFor(expectNotice);
});

it.each([null, { amount: 2520 }])('カード必須の決まりと%jの前払いでは同意の条件を保って帯に案内する', async deposit => {
  vi.mocked(api.cancellationPreview).mockResolvedValue(preview({ enabled: true, cardRequired: true, deposit, payment: { mode: 'onsite', allowedMethods: ['onsite'] } }));
  render(<Confirm menu={{ ...menu, payment_mode: 'onsite' }} staff={staff} slot={slot} autoConfirm onSubmitted={() => {}} />);
  const consent = await screen.findByRole('checkbox', { name: 'キャンセル料の決まりを確認しました' });
  const submit = within(bar()).getByRole('button') as HTMLButtonElement;
  expect(submit.disabled).toBe(true); expectNotice(); fireEvent.click(consent); expect(submit.disabled).toBe(false);
});

it('カード不要でもデポジットがあれば試験の予約操作と一緒に案内する', async () => {
  vi.mocked(api.cancellationPreview).mockResolvedValue(preview({ enabled: true, cardRequired: false, deposit: { amount: 2520 }, payment: { mode: 'onsite', allowedMethods: ['onsite'] } }));
  render(<Confirm menu={{ ...menu, payment_mode: 'onsite' }} staff={staff} slot={slot} autoConfirm onSubmitted={() => {}} />);
  await screen.findByRole('button', { name: '¥2,520の試験で予約する' }); expectNotice();
});

it('方法未選択は送れず、オンラインと店払いを切り替えると案内も追従する', async () => {
  vi.mocked(api.cancellationPreview).mockResolvedValue(preview({ payment: { mode: 'customer_choice', allowedMethods: ['online', 'onsite'] } }));
  render(<Confirm menu={{ ...menu, payment_mode: 'customer_choice' }} staff={staff} slot={slot} autoConfirm onSubmitted={() => {}} />);
  const online = await screen.findByRole('radio', { name: 'オンラインで先に払う' });
  expect((within(bar()).getByRole('button') as HTMLButtonElement).disabled).toBe(true); expect(screen.queryByText(title)).toBeNull();
  fireEvent.click(online); expectNotice();
  fireEvent.click(screen.getByRole('radio', { name: 'お店で払う' })); expect(screen.queryByText(title)).toBeNull();
  expect((within(bar()).getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(online); expectNotice();
});

it('カード不要の回数券を選ぶと試験案内を外し、券を外すと元のオンライン案内へ戻る', async () => {
  const ticket: BookingEntitlement = { id: 'ticket', name: '5回券', kind: 'ticket', menuId: null, remaining: 5, monthlyLimit: null, monthAllowance: null, monthUsed: null, monthRemaining: null, validFrom: null, expiresAt: null, periodStart: null, periodEnd: null, usable: true };
  vi.mocked(api.entitlements).mockResolvedValue([ticket]);
  render(<Confirm menu={menu} staff={staff} slot={slot} autoConfirm onSubmitted={() => {}} />);
  await screen.findByRole('button', { name: /5回券/ }); expectNotice();
  fireEvent.click(screen.getByRole('button', { name: /5回券/ })); expect(screen.queryByText(title)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '使わない' })); expectNotice();
});

it.each(['onsite', 'free'] as const)('無関係な%sでは帯にも本文にも試験案内を出さない', async kind => {
  vi.mocked(api.cancellationPreview).mockResolvedValue(preview({ payment: { mode: kind === 'onsite' ? 'onsite' : 'online', allowedMethods: [kind === 'onsite' ? 'onsite' : 'online'] } }));
  render(<Confirm menu={{ ...menu, payment_mode: kind === 'onsite' ? 'onsite' : 'online', base_price: kind === 'free' ? 0 : 8400 }} staff={{ ...staff, price: kind === 'free' ? 0 : 8400 }} slot={slot} autoConfirm onSubmitted={() => {}} />);
  await waitFor(() => expect((within(bar()).getByRole('button') as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText(title)).toBeNull();
});
