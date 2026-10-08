// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({ cards: vi.fn(), card: vi.fn(), showReward: vi.fn(), useReward: vi.fn(), requestPaper: vi.fn(), paperRequests: vi.fn(), uploadPaperPhoto: vi.fn() }));
vi.mock('../lib/api.js', () => ({
  api: {
    liffConfig: vi.fn().mockResolvedValue({ success: true, data: { accountId: 'acc-1', accountName: '然 - NEN - 銀座店', botBasicId: '@x' } }),
    bookingSettings: vi.fn().mockResolvedValue({ liff_date_view: 'list', booking_window_days: 60 }),
  },
  visitStampsApi: fx,
}));
vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));
import VisitStamps, { cardState, latestRequest, paperPhotoProblem } from './VisitStamps.js';

const card = {
  id: 'c1', name: '然 来店スタンプカード', accountIds: ['acc-1'], active: true, version: 1, expectedVersion: 1,
  settings: {
    mode: 'visit' as const, amountUnit: 1000, maxPerVisit: 3, firstVisitBonus: 0, expiryMonths: 6, timezone: 'Asia/Tokyo',
    multipliers: [], rankMultipliers: [], rewards: [{ id: 'r10', name: 'デザート 1品', stamps: 10 }, { id: 'r5', name: 'ドリンク 1杯', stamps: 5 }],
  },
};
const wallet = (balance: number) => ({ cardId: 'c1', friendId: 'f1', balance, earnedTotal: balance, expiresAt: '2026-07-13T03:00:00.000Z' });

beforeEach(() => {
  fx.cards.mockResolvedValue({ success: true, data: [{ card, wallet: wallet(6) }] });
  fx.card.mockResolvedValue({ success: true, data: { card, wallet: wallet(1), entries: [] } });
  fx.showReward.mockResolvedValue({ success: true, data: { id: 'red-1', cardId: 'c1', rewardId: 'r5', rewardName: 'ドリンク 1杯', stamps: 5, status: 'offered' } });
  fx.useReward.mockResolvedValue({ success: true, data: { id: 'red-1', status: 'used', staffId: 's-1', staffName: '田村' } });
  fx.paperRequests.mockResolvedValue({ success: true, data: [] });
  fx.uploadPaperPhoto.mockResolvedValue({ success: true, data: { id: 'ph-1', photoUrl: 'https://api.example/api/liff/visit-stamps/paper-photos/ph-1', contentType: 'image/jpeg', size: 1000 } });
  fx.requestPaper.mockResolvedValue({ success: true, data: { id: 'p-1', status: 'pending' } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('来店スタンプ（お客さまの LIFF）', () => {
  it('ページを開き直すと、ゴールで受け取った次のカードを表示する', async () => {
    const previous = { ...card, settings: { ...card.settings, completion: 'next_card' as const, nextCardId: 'gold' } };
    const next = { ...card, id: 'gold', name: 'ゴールドカード' };
    fx.cards.mockResolvedValue({ success: true, data: [{ card: previous, wallet: wallet(0) }, { card: next, wallet: { ...wallet(2), cardId: 'gold' } }] });
    render(<VisitStamps />);
    expect(await screen.findByText('ゴールドカード')).toBeTruthy();
    expect(screen.getByText('2 / 10')).toBeTruthy();
  });
  it('使い方の説明・背景画像・最初の来店からの期限を表示する', async () => {
    const configured = { ...card, settings: { ...card.settings, instructions: '1回で1個\n特典をお店で使えます', expiryBasis: 'first_visit' as const, backgroundColor: '#7b4a2e', backgroundImageUrl: 'https://example.test/card.png' } };
    fx.cards.mockResolvedValue({ success: true, data: [{ card: configured, wallet: wallet(3) }] });
    render(<VisitStamps />);
    expect(await screen.findByText('1回で1個 特典をお店で使えます')).toBeTruthy();
    expect(screen.getByText(/最初の来店から/)).toBeTruthy();
    expect(document.querySelector('img[src="https://example.test/card.png"]')).toBeTruthy();
  });
  it('いま使える特典と次の目標（特典は個数の順）', () => {
    const s = cardState(card, 6);
    expect(s.best?.name).toBe('ドリンク 1杯');
    expect(s.next?.name).toBe('デザート 1品');
    expect(cardState(card, 3).best).toBeNull();
  });

  it('店員に見せる → 店員が4桁を打つと使用済みになり、残りを読み直して出す', async () => {
    render(<VisitStamps />);
    expect(await screen.findByText('6 / 10')).toBeTruthy();
    expect(screen.getByText('あと 4個でデザート 1品')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '店員に見せる' }));
    await waitFor(() => expect(fx.showReward).toHaveBeenCalledWith('acc-1', 'c1', 'r5', expect.any(String)));
    expect(await screen.findByText('お客さまご自身では使用済みにできません')).toBeTruthy();
    // 4桁がそろうまでは送らない（お客さまだけでは使用済みにできない）
    fireEvent.change(screen.getByLabelText('店員の暗証番号（4桁）'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '使用済みにする' }));
    expect(fx.useReward).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('店員の暗証番号（4桁）'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: '使用済みにする' }));
    /* 店員は選ばない。暗証番号だけを送る。 */
    await waitFor(() => expect(fx.useReward).toHaveBeenCalledWith('acc-1', 'red-1', '1234'));
    expect(await screen.findByText('使用済み')).toBeTruthy();
    expect(screen.getByText('残り 1個（次はドリンク 1杯）')).toBeTruthy();
    /* 使った店員の名前（xe8ga の「担当」）。 */
    expect(screen.getByText('担当')).toBeTruthy();
    expect(screen.getByText('田村')).toBeTruthy();
  });

  it('暗証番号が違うと、店の理由を出して番号を消す（使用済みにしない）', async () => {
    fx.useReward.mockRejectedValue(Object.assign(new Error('API 403'), { status: 403, body: { success: false, error: '暗証番号が違います' } }));
    render(<VisitStamps />);
    fireEvent.click(await screen.findByRole('button', { name: '店員に見せる' }));
    await screen.findByText('お客さまご自身では使用済みにできません');
    fireEvent.change(screen.getByLabelText('店員の暗証番号（4桁）'), { target: { value: '9999' } });
    fireEvent.click(screen.getByRole('button', { name: '使用済みにする' }));
    expect(await screen.findByText('暗証番号が違います')).toBeTruthy();
    expect(screen.queryByText('使用済み')).toBeNull();
  });

  it('特典がまだ無いときは「店員に見せる」を出さない', async () => {
    fx.cards.mockResolvedValue({ success: true, data: [{ card, wallet: wallet(2) }] });
    render(<VisitStamps />);
    expect(await screen.findByText('あと 3個でドリンク 1杯')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '店員に見せる' })).toBeNull();
  });

  it('紙のカード：写真が無いと申請しない', async () => {
    render(<VisitStamps />);
    fireEvent.click(await screen.findByRole('button', { name: '紙のカードを移す' }));
    fireEvent.click(await screen.findByRole('button', { name: '申請する' }));
    expect(await screen.findByText('紙のカードの写真を撮ってください。')).toBeTruthy();
    expect(fx.requestPaper).not.toHaveBeenCalled();
  });

  it('紙のカード：写真を預けてから、返った URL と数で申請し、確認待ちを出す', async () => {
    render(<VisitStamps />);
    fireEvent.click(await screen.findByRole('button', { name: '紙のカードを移す' }));
    const file = new File(['x'], 'card.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('紙のカードの写真'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: '1個ふやす' }));
    fireEvent.click(screen.getByRole('button', { name: '申請する' }));
    await waitFor(() => expect(fx.uploadPaperPhoto).toHaveBeenCalledWith('acc-1', 'c1', file));
    await waitFor(() => expect(fx.requestPaper).toHaveBeenCalledWith('acc-1', 'c1', { photoUrl: 'https://api.example/api/liff/visit-stamps/paper-photos/ph-1', stamps: 2 }));
    expect(await screen.findByText('お店の確認待ち')).toBeTruthy();
  });

  it('自分の申請が確認待ちなら、紙のカードを開くと確認待ち（数と申請日）を出す。却下は理由を出す', async () => {
    fx.paperRequests.mockResolvedValue({ success: true, data: [
      { id: 'p-1', cardId: 'c1', photoUrl: 'x', stamps: 7, status: 'pending', reason: null, createdAt: '2026-01-12T11:14:00.000Z', reviewedAt: null },
    ] });
    render(<VisitStamps />);
    await screen.findByText('6 / 10');
    await waitFor(() => expect(fx.paperRequests).toHaveBeenCalledWith('acc-1', 'c1'));
    fireEvent.click(screen.getByRole('button', { name: '紙のカードを移す' }));
    expect(await screen.findByText('お店の確認待ち')).toBeTruthy();
    expect(screen.getByText('7 個')).toBeTruthy();
    expect(screen.getByText('2026年1月12日 20:14')).toBeTruthy();
    cleanup();
    fx.paperRequests.mockResolvedValue({ success: true, data: [
      { id: 'p-2', cardId: 'c1', photoUrl: 'x', stamps: 4, status: 'rejected', reason: '写真がぼやけています', createdAt: '2026-01-10T11:14:00.000Z', reviewedAt: null },
    ] });
    render(<VisitStamps />);
    await screen.findByText('6 / 10');
    await waitFor(() => expect(fx.paperRequests).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '紙のカードを移す' }));
    expect(await screen.findByText(/お店が確認できませんでした：写真がぼやけています/)).toBeTruthy();
  });

  it('申請の選び方と写真の確かめ', () => {
    const r = (id: string, status: string, createdAt: string) => ({ id, cardId: 'c1', photoUrl: 'x', stamps: 1, status, reason: null, createdAt, reviewedAt: null }) as never;
    expect(latestRequest([r('a', 'approved', '2026-01-03'), r('b', 'pending', '2026-01-01')])?.id).toBe('b');
    expect(latestRequest([r('a', 'rejected', '2026-01-03'), r('b', 'approved', '2026-01-01')])?.id).toBe('a');
    expect(latestRequest(null)).toBeNull();
    expect(paperPhotoProblem({ type: 'image/heic', size: 10 })).toContain('JPEG');
    expect(paperPhotoProblem({ type: 'image/png', size: 6 * 1024 * 1024 })).toContain('5MB');
    expect(paperPhotoProblem({ type: 'image/webp', size: 10 })).toBe('');
  });
});
