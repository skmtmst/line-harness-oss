// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
const fx = vi.hoisted(() => ({ receive: vi.fn(), use: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { entryRouteCoupon: fx,
  bookingSettings: vi.fn().mockResolvedValue({}), liffConfig: vi.fn().mockResolvedValue({ success: true, data: { accountName: 'お店' } }) } }));
vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));
import EntryRouteCoupon from './EntryRouteCoupon.js';
const receipt = { receiptId: 'receipt-1', name: '店頭10%オフ', assetId: 'c', usedCount: 0, receivedAt: '2026-10-10', payload: { description: '10%オフ', startsAt: '2026-01-01', endsAt: '2099-01-01', oncePerFriend: true } };
beforeEach(() => { fx.receive.mockReset().mockResolvedValue(receipt); fx.use.mockReset().mockResolvedValue({ replayed: false }); });
afterEach(cleanup);
function mount() { return render(<MemoryRouter initialEntries={['/?couponRef=shop-pop']}><EntryRouteCoupon /></MemoryRouter>); }
test('読んだ経路のクーポンを出す。使用前に確認し、失敗した同じ操作IDで再試行する', async () => {
  mount();
  expect(await screen.findByText('店頭10%オフ')).toBeTruthy();
  expect(fx.receive).toHaveBeenCalledWith('shop-pop');
  fireEvent.click(screen.getByRole('button', { name: 'クーポンを使う' }));
  const dialog = await screen.findByRole('dialog', { name: 'クーポンを使いますか？' });
  expect(fx.use).not.toHaveBeenCalled();
  fx.use.mockRejectedValueOnce(new Error('timeout'));
  fireEvent.click(within(dialog).getByRole('button', { name: '使用を確定' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '使用を確定' }));
  expect(await screen.findByText('このクーポンは使用済みです')).toBeTruthy();
  expect(fx.use).toHaveBeenCalledTimes(2);
  expect(fx.use.mock.calls[0]).toEqual(fx.use.mock.calls[1]);
  expect(fx.use.mock.calls[0][0]).toBe('receipt-1');
  expect(screen.queryByRole('button', { name: 'クーポンを使う' })).toBeNull();
});
test('受け取れないときは利用ボタンを出さず、読み直せる', async () => {
  fx.receive.mockRejectedValueOnce(new Error('unavailable'));
  mount();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'クーポンを使う' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }));
  expect(await screen.findByText('店頭10%オフ')).toBeTruthy();
});
test('使用の応答を待っている間に別の経路へ移動しても、新しいクーポンを使用済みにしない', async () => {
  let resolveUse!: (value: { replayed: boolean }) => void;
  fx.use.mockImplementationOnce(() => new Promise((resolve) => { resolveUse = resolve; }));
  fx.receive.mockResolvedValueOnce(receipt).mockResolvedValueOnce({ ...receipt, receiptId: 'receipt-2', name: '別のお店の割引' });
  function Navigation() {
    const navigate = useNavigate();
    return <button onClick={() => navigate('/?couponRef=another-shop')}>別の経路</button>;
  }
  render(<MemoryRouter initialEntries={['/?couponRef=shop-pop']}><Navigation /><EntryRouteCoupon /></MemoryRouter>);
  await screen.findByText('店頭10%オフ');
  fireEvent.click(screen.getByRole('button', { name: 'クーポンを使う' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '使用を確定' }));
  fireEvent.click(screen.getByRole('button', { name: '別の経路' }));
  await screen.findByText('別のお店の割引');
  await act(async () => { resolveUse({ replayed: false }); });
  expect(screen.queryByText('このクーポンは使用済みです')).toBeNull();
  expect(screen.getByRole('button', { name: 'クーポンを使う' })).toBeTruthy();
});
