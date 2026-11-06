// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import EventWaitlistOffer from './event-waitlist-offer.js';
import { api, type EventWaitlistOfferDetail } from '../lib/api.js';
import { formatJstEventAt } from '../lib/datetime.js';

vi.mock('../lib/api.js', () => ({ api: {
  eventWaitlistOffer: vi.fn(), acceptEventWaitlistOffer: vi.fn(),
  customerLook: vi.fn().mockResolvedValue({ success: true, data: { settings: {} } }),
  liffConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
} }));
vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const offer: EventWaitlistOfferDetail = {
  waitlistId: 'w', eventId: 'e', slotId: 's', eventName: '見本の陶芸体験会', venueName: '見本の本店工房',
  startsAt: '2030-11-20T01:00:00.000Z', endsAt: '2030-11-20T02:00:00.000Z', partySize: 2,
  status: 'offered', expiresAt: '2030-11-01T01:00:00.000Z', remainingSeconds: 3600, canAccept: true,
};
const notice = `${formatJstEventAt(offer.startsAt)}〜 に 2 席あります。下のボタンを押すまで、予約にはなりません。`;
async function show(overrides: Partial<EventWaitlistOfferDetail> = {}) {
  vi.mocked(api.eventWaitlistOffer).mockResolvedValueOnce({ success: true, data: { ...offer, ...overrides } });
  render(<MemoryRouter><EventWaitlistOffer token="offer/token" /></MemoryRouter>);
  await screen.findByText('あと 1時間 0分 取っておきます');
  expect(api.eventWaitlistOffer).toHaveBeenCalledExactlyOnceWith('offer/token');
  expect(api.acceptEventWaitlistOffer).not.toHaveBeenCalled();
  return screen.getByRole('button', { name: 'この席を取る' }) as HTMLButtonElement;
}

it('承諾前にイベント名と会場を表示し、日時人数と元の注意文・期限・操作を保つ', async () => {
  const take = await show();
  expect(screen.getByText(offer.eventName)).toBeTruthy();
  expect(screen.getByText(`会場：${offer.venueName}`)).toBeTruthy();
  expect(screen.getByText(notice)).toBeTruthy();
  expect(take.disabled).toBe(false);
  expect(screen.getByRole('button', { name: '今回は見送る' })).toBeTruthy();
});

it('会場がnullなら場所を補わず、イベント名を表示する', async () => {
  await show({ venueName: null });
  expect(screen.getByText(offer.eventName)).toBeTruthy();
  expect(screen.queryByText(/^会場：/)).toBeNull();
  expect(screen.getByText(notice)).toBeTruthy();
});

it('GETが返した申込時の名前と会場を表示する', async () => {
  await show({ eventName: '申込時の見本体験会', venueName: '申込時の見本会場' });
  expect(screen.getByText('申込時の見本体験会')).toBeTruthy();
  expect(screen.getByText('会場：申込時の見本会場')).toBeTruthy();
  expect(screen.queryByText(offer.eventName)).toBeNull();
});

it('名前と会場の前後の空白を表示時だけ取り除く', async () => {
  await show({ eventName: '　見本の体験会 \n', venueName: '\t 見本の会場　' });
  expect(screen.getByText('見本の体験会').textContent).toBe('見本の体験会');
  expect(screen.getByText('会場：見本の会場').textContent).toBe('会場：見本の会場');
});

it.each(['', '　 \t\n'])('空の名前と空白だけの会場は空行や会場ラベルを作らない: %j', async eventName => {
  await show({ eventName, venueName: '　 \t\n' });
  const body = screen.getByText(notice).closest('p')!;
  expect(body.textContent).toBe(notice);
  expect(body.querySelectorAll('br')).toHaveLength(0);
  expect(screen.queryByText(/^会場：/)).toBeNull();
});

it('名前と会場の特殊文字をHTMLにせず、全文を文字として表示する', async () => {
  const eventName = '<script>見本の体験会</script>';
  const venueName = '<img src=x onerror="alert(1)">見本会場 & 本店';
  await show({ eventName, venueName });
  expect(screen.getByText(eventName).textContent).toBe(eventName);
  expect(screen.getByText(`会場：${venueName}`).textContent).toBe(`会場：${venueName}`);
  expect(document.querySelectorAll('main script, main img')).toHaveLength(0);
});

it('承諾中も同じ対象名を保ち、既存の連打防止と送信形を変えない', async () => {
  vi.mocked(api.acceptEventWaitlistOffer).mockImplementationOnce(() => new Promise(() => {}));
  const take = await show();
  fireEvent.click(take); fireEvent.click(take);
  expect((screen.getByRole('button', { name: '予約を確定しています…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(offer.eventName)).toBeTruthy();
  expect(screen.getByText(`会場：${offer.venueName}`)).toBeTruthy();
  expect(api.acceptEventWaitlistOffer).toHaveBeenCalledExactlyOnceWith('offer/token');
});
