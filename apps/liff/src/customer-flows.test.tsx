// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './app.js';
import CustomerStyleScope from './components/customer-style-scope.js';
import { api, type EventBookingMine } from './lib/api.js';

vi.mock('./lib/liff-auth.js', () => ({ getLiffId: () => 'fixture', getLineUserId: () => 'me', getIdToken: () => 'fixture' }));
vi.mock('./components/ui/liff-header.js', () => ({ default: ({ title }: { title: string }) => <header>{title}</header> }));
vi.mock('./lib/liff-runtime.js', () => ({ default: { getProfile: async () => ({ displayName: '人工会員' }), closeWindow: () => {} } }));
vi.mock('./lib/affiliate-self-api.js', () => ({ affiliateSelfApi: { rewards: async () => ({ availableMiles: 0, rewards: [] }) } }));
vi.mock('./lib/api.js', () => ({ api: {
  liffConfig: vi.fn(), customerLook: vi.fn(), menus: vi.fn(), storePhotos: vi.fn(), staffOf: vi.fn(), lastBooking: vi.fn(), addons: vi.fn(), bookingSettings: vi.fn(),
  me: vi.fn(), bookingWaitlists: vi.fn(), entitlements: vi.fn(), notificationPreferences: vi.fn(),
  myEventBookings: vi.fn(), makeupCredits: vi.fn(), makeupOptions: vi.fn(), eventAbsence: vi.fn(), useMakeup: vi.fn(),
  getEvent: vi.fn(), getEventSlots: vi.fn(), createEventBooking: vi.fn(), createRequest: vi.fn(),
}, visitStampsApi: { cards: async () => ({ success: true, data: [] }) } }));

const menu = { id: 'm', name: '人工メニュー', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 5000, sort_order: 0 };
const event = { id: 'e', name: '人工クラス', venue_name: '人工教室', venue_url: null, image_url: null, description: '', description_centered: 0, max_bookings_per_friend: 2, requires_approval: 1, cancel_deadline_hours_before: 3 };
const slot = { id: 'slot', event_id: 'e', starts_at: '2099-01-01T01:00:00Z', ends_at: '2099-01-01T02:00:00Z', capacity: 5, remaining: 3, active_count: 2, is_active: 1 };
const booking: EventBookingMine = { id: 'mine', event_id: 'e', event_name: '人工クラス', status: 'confirmed', slot_starts_at: slot.starts_at, slot_ends_at: slot.ends_at, cancel_deadline_hours_before: 3, venue_name: '人工教室', venue_url: null, makeup: { enabled: true, cutoff_at: '2098-12-31T22:00:00Z', valid_until: '2099-02-01T01:00:00Z' } } as EventBookingMine;
function Location() { const l = useLocation(); return <output data-testid="location">{l.pathname + l.search}</output>; }
function mount(style: string, route = '/?liffId=fixture') {
  vi.mocked(api.liffConfig).mockResolvedValue({ success: true, data: { accountId: 'a', accountName: '人工事業者', botBasicId: '', style } });
  return render(<MemoryRouter initialEntries={[route]}><CustomerStyleScope><App /><Location /></CustomerStyleScope></MemoryRouter>);
}
beforeEach(() => {
  vi.mocked(api.customerLook).mockResolvedValue({ success: true, data: { settings: {} } } as never);
  vi.mocked(api.menus).mockResolvedValue({ menus: [menu] });
  vi.mocked(api.storePhotos).mockResolvedValue([]);
  vi.mocked(api.lastBooking).mockResolvedValue({ available: false });
  vi.mocked(api.addons).mockResolvedValue([]);
  vi.mocked(api.bookingSettings).mockResolvedValue({ liff_date_view: 'list', booking_window_days: 60 });
  vi.mocked(api.me).mockResolvedValue({ upcoming: [], past: [] });
  vi.mocked(api.bookingWaitlists).mockResolvedValue({ waitlist: [] });
  vi.mocked(api.entitlements).mockResolvedValue([]);
  vi.mocked(api.notificationPreferences).mockResolvedValue({ purposeSpecificEnforcement: true, items: [] } as never);
  vi.mocked(api.myEventBookings).mockImplementation(async (tab) => ({ items: tab === 'upcoming' ? [booking] : [] }));
  vi.mocked(api.makeupCredits).mockResolvedValue({ credits: [] });
  vi.mocked(api.makeupOptions).mockResolvedValue({ options: [] });
  vi.mocked(api.getEvent).mockResolvedValue(event);
  vi.mocked(api.getEventSlots).mockResolvedValue({ items: [slot] } as never);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it.each(['standard', 'restaurant', 'salon', 'consult'])('%s の入口は同じ所属の予約メニューへ進む', async (style) => {
  vi.mocked(api.storePhotos).mockResolvedValue([{ slot: 'exterior', url: '/media/booking-photo/content' }]);
  mount(style);
  expect(await screen.findByRole('button', { name: /人工メニュー/ })).toBeTruthy();
  fireEvent.click(await screen.findByText('お店の案内'));
  expect((await screen.findByRole('img', { name: 'お店の外観' })).getAttribute('src')).toBe('/media/booking-photo/content');
  expect(screen.getByTestId('location').textContent).toBe('/booking?liffId=fixture');
  expect(api.createRequest).not.toHaveBeenCalled();
});

it('ECの入口はマイページで、新しい予約ボタンを出さない', async () => {
  vi.mocked(api.notificationPreferences).mockResolvedValue({ purposeSpecificEnforcement: true, items: [{ purpose: 'booking_reminders', enabled: true, version: 1, label: '予約のお知らせ' }] } as never);
  mount('ec');
  await screen.findByRole('button', { name: /クーポン/ });
  expect(screen.getByTestId('location').textContent).toBe('/mypage?liffId=fixture');
  expect(screen.queryByRole('button', { name: '予約する' })).toBeNull();
  expect(screen.queryByText('次の予約はありません')).toBeNull();
  expect(screen.queryByText('予約のお知らせ')).toBeNull();
});

it('ECの古い予約リンクを開いてもメニュー・送信を出さない', async () => {
  mount('ec', '/booking?liffId=fixture&style=salon');
  await screen.findByText('LINEのメニューをご確認ください');
  expect(api.menus).not.toHaveBeenCalled();
  expect(api.createRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'マイページを見る' }));
  await screen.findByRole('button', { name: /クーポン/ });
});

it('ECで予約を使った記録があれば、予約を新規作成させず履歴を開ける', async () => {
  vi.mocked(api.me).mockResolvedValue({ upcoming: [], past: [{ id: 'old', menu_name: '前の予約', status: 'completed', starts_at: '2020-01-01T01:00:00Z', staff_name: '担当', profile_image_url: null, lock_version: 1, menu_id: 'old-menu', staff_id: 'old-staff' }] });
  mount('ec');
  fireEvent.click(await screen.findByRole('button', { name: /予約の履歴/ }));
  fireEvent.click(await screen.findByRole('tab', { name: 'これまで' }));
  expect(await screen.findByText('前の予約')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '新しく予約する' })).toBeNull();
});

it('ECでも過去の予約は読めるが、新しく予約する入口は出さない', async () => {
  mount('ec', '/booking/history?liffId=fixture');
  await screen.findByRole('tab', { name: 'これから' });
  expect(screen.queryByRole('button', { name: '新しく予約する' })).toBeNull();
  expect(api.me).toHaveBeenCalled();
});

it('教室の入口と振替は本人のクラス一覧、回数券はマイページへ進む', async () => {
  mount('lesson');
  await screen.findByRole('button', { name: '欠席する' });
  expect(screen.getByTestId('location').textContent).toBe('/events/me?liffId=fixture');
  expect(screen.getByText('確定')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '回数券と月謝を見る' }));
  await screen.findByRole('button', { name: /予約の確認・振替/ });
  fireEvent.click(screen.getByRole('button', { name: /予約の確認・振替/ }));
  await screen.findByRole('button', { name: '欠席する' });
  expect(api.createRequest).not.toHaveBeenCalled();
});

it('教室の公開クラスID付き旧リンクを、同じ開催回へつなぐ', async () => {
  mount('lesson', '/?page=event&eventId=e&liffId=fixture');
  await screen.findByText('人工クラス');
  expect(screen.getByTestId('location').textContent).toContain('/events/e?');
  fireEvent.click(screen.getByRole('button', { name: /10:00/ }));
  fireEvent.click(screen.getByRole('button', { name: 'この時間で申し込む' }));
  await screen.findByRole('heading', { name: '内容を確かめてください' });
  expect(screen.getByTestId('location').textContent).toContain('/events/e/confirm?');
  expect(screen.queryByRole('button', { name: '担当を選ぶ' })).toBeNull();
});

it('クラスIDのない旧リンクを汎用予約へ落とさない', async () => {
  mount('lesson', '/?page=event&liffId=fixture');
  await screen.findByText('クラスのご案内をご確認ください');
  expect(api.menus).not.toHaveBeenCalled();
});

it('欠席は振替先を選ぶ前に確定し、同じ本人の残りと期限を読み直す', async () => {
  vi.mocked(api.eventAbsence).mockResolvedValue({ credit: null, reason_if_none: '欠席を受け付けました。' });
  mount('lesson');
  fireEvent.click(await screen.findByRole('button', { name: '欠席する' }));
  const dialog = await screen.findByRole('dialog', { name: '欠席の確かめ' });
  expect(dialog.textContent).toContain('振替先はこのあと選べます');
  fireEvent.click(screen.getAllByRole('button', { name: '欠席する' }).at(-1)!);
  await vi.waitFor(() => expect(api.eventAbsence).toHaveBeenCalledWith('mine', expect.any(String)));
  expect(api.useMakeup).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(api.makeupCredits).toHaveBeenCalledTimes(2));
});

it('サロンの指名と指名料を保持し、選んだ担当だけで次へ進める', async () => {
  vi.mocked(api.staffOf).mockResolvedValue({ staff: [
    { id: 'auto', display_name: '自動', role: null, profile_image_url: null, bio: null, is_designation_optional: 1, price: 5000, duration_minutes: 60 },
    { id: 'named', display_name: '人工担当', role: 'スタイリスト', profile_image_url: null, bio: null, is_designation_optional: 0, price: 6000, duration_minutes: 60 },
  ] });
  mount('salon');
  fireEvent.click(await screen.findByRole('button', { name: /人工メニュー/ }));
  fireEvent.click(screen.getByRole('button', { name: '担当を選ぶ' }));
  expect(await screen.findByRole('button', { name: /指名なし（指名料なし）/ })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: /人工担当.*指名料/ }));
  expect(screen.getByText('¥6,000')).toBeTruthy();
  expect((screen.getByRole('button', { name: '日時を選ぶ' }) as HTMLButtonElement).disabled).toBe(false);
});

it('振替先はあとで選ぶとマイページへ戻り、振替を消費せず本人の一覧から再開できる', async () => {
  vi.mocked(api.makeupCredits).mockResolvedValue({ credits: [{ id: 'credit', status: 'open', expires_at: '2099-12-31T00:00:00Z' }] } as never);
  mount('lesson');
  const later = await screen.findByRole('button', { name: '振替先はあとで選ぶ' });
  expect(screen.getByRole('button', { name: /^キャンセルする$/ })).toBeTruthy();
  fireEvent.click(later);
  await screen.findByRole('button', { name: /予約の確認・振替/ });
  expect(screen.getByTestId('location').textContent).toBe('/mypage?liffId=fixture');
  expect(api.useMakeup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /予約の確認・振替/ }));
  expect(await screen.findByRole('button', { name: '振替先はあとで選ぶ' })).toBeTruthy();
});

it.each([false, true])('通常の申込が空でも、振替の選択中=%sでは空表示と選択画面を重ねない', async (hasCredit) => {
  vi.mocked(api.myEventBookings).mockResolvedValue({ items: [] });
  vi.mocked(api.makeupCredits).mockResolvedValue({ credits: hasCredit
    ? [{ id: 'credit', status: 'open', expires_at: '2099-12-31T00:00:00Z' }] : [] } as never);
  mount('lesson');
  if (hasCredit) {
    await screen.findByRole('heading', { name: '振替先を選ぶ' });
    await vi.waitFor(() => expect(screen.queryByText('これからのクラスはありません')).toBeNull());
    expect(api.useMakeup).not.toHaveBeenCalled();
  } else {
    expect(await screen.findByText('これからのクラスはありません')).toBeTruthy();
  }
});

it('振替を使い終えたら本人の最新一覧を読み直し、新しい申込を表示する', async () => {
  let used = false;
  vi.mocked(api.myEventBookings).mockImplementation(async () => ({ items: used
    ? [{ ...booking, id: 'after-makeup', event_name: '振替後のクラス' }] : [] }));
  vi.mocked(api.makeupCredits).mockImplementation(async () => ({ credits: used ? []
    : [{ id: 'credit', status: 'open', expires_at: '2099-12-31T00:00:00Z' }] } as never));
  vi.mocked(api.makeupOptions).mockResolvedValue({ options: [{
    slot_id: 'next-slot', event_id: 'e', starts_at: slot.starts_at, ends_at: slot.ends_at,
    name: '振替後のクラス', full: false, remaining: 3,
  }] });
  vi.mocked(api.useMakeup).mockImplementation(async () => { used = true; return { id: 'after-makeup', status: 'confirmed' }; });
  mount('lesson');
  fireEvent.click(await screen.findByRole('button', { name: /に振り替える$/ }));
  expect(await screen.findByRole('button', { name: /^キャンセルする$/ })).toBeTruthy();
  await vi.waitFor(() => expect(screen.queryByRole('heading', { name: '振替先を選ぶ' })).toBeNull());
  expect(screen.getByText('振替後のクラス')).toBeTruthy();
  expect(screen.queryByText('これからのクラスはありません')).toBeNull();
  expect(api.useMakeup).toHaveBeenCalledTimes(1);
});
