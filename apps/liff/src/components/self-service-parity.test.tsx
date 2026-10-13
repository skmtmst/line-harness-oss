// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MileageRewards from './MileageRewards.js';
import Affiliate from '../pages/Affiliate.js';
import AffiliatePayments from './AffiliatePayments.js';
import { affiliateSelfApi, SelfApiError } from '../lib/affiliate-self-api.js';

vi.mock('../lib/liff-auth.js', () => ({ getLiffId: () => 'test-liff', getIdToken: () => 'test-token' }));
vi.mock('@line/liff', () => ({ default: { getAccessToken: () => 'token', closeWindow: vi.fn() } }));
vi.mock('../lib/affiliate-self-api.js', async original => ({
  ...await original<typeof import('../lib/affiliate-self-api.js')>(),
  affiliateSelfApi: { rewards: vi.fn(), redeem: vi.fn(), bank: vi.fn(), saveBank: vi.fn(), statements: vi.fn(), download: vi.fn() },
}));
const reward = { id: 'r1', name: '割引券', description: '500円引き', imageUrl: null, currentVersion: { requiredMiles: 100 }, canRedeem: true, unavailableReason: null };
const bank = { bankCode: '0001', bankName: '銀行', branchCode: '123', branchName: '支店', accountType: 'ordinary' as const, accountLast4: '5678', accountHolderName: 'タナカ', version: 7 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(affiliateSelfApi.rewards).mockResolvedValue({ rewards: [reward, { ...reward, id: 'r2', name: '品切れ', canRedeem: false, unavailableReason: '在庫切れです' }], availableMiles: 150 });
  vi.mocked(affiliateSelfApi.bank).mockResolvedValue(bank);
  vi.mocked(affiliateSelfApi.statements).mockResolvedValue([]);
  vi.mocked(affiliateSelfApi.download).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('お客さまの交換と振込先', () => {
  it('交換を確認し、通信失敗の再送は同じキー。202は交換受付として扱う', async () => {
    vi.mocked(affiliateSelfApi.redeem).mockRejectedValueOnce(new Error('通信が切れました')).mockResolvedValueOnce({ status: 'delivery_failed', rewardName: '割引券', customerMessage: '', rewardCode: null, message: '交換を受け付けました' });
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<MileageRewards onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: '使い道を選ぶ' }));
    await screen.findByText('在庫切れです');
    expect(screen.getAllByRole('button', { name: 'これを選ぶ' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'これを選ぶ' }));
    expect(affiliateSelfApi.redeem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '交換する' }));
    await screen.findByText('通信が切れました');
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    fireEvent.click(screen.getByRole('button', { name: 'これを選ぶ' }));
    fireEvent.click(screen.getByRole('button', { name: '交換する' }));
    await screen.findByText('交換を受け付けました');
    expect(affiliateSelfApi.redeem).toHaveBeenCalledTimes(2);
    expect(vi.mocked(affiliateSelfApi.redeem).mock.calls[0]).toEqual(vi.mocked(affiliateSelfApi.redeem).mock.calls[1]);
    expect(onChanged).toHaveBeenCalledOnce();
  });
  it('コードと完了後の残高取得失敗を表示し、交換成立を取り消さない', async () => {
    vi.mocked(affiliateSelfApi.redeem).mockResolvedValue({ status: 'succeeded', rewardName: '割引券', customerMessage: 'お店で見せてください', rewardCode: 'CODE-001', message: null });
    render(<MileageRewards onChanged={async () => { throw new Error('通信'); }} />);
    await vi.waitFor(() => expect((screen.getByRole('button', { name: '使い道を選ぶ' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(await screen.findByRole('button', { name: '使い道を選ぶ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'これを選ぶ' }));
    fireEvent.click(screen.getByRole('button', { name: '交換する' }));
    expect(await screen.findByText('交換コード：CODE-001')).toBeTruthy();
    expect(await screen.findByText(/残高を読み直せませんでした/)).toBeTruthy();
    expect(affiliateSelfApi.redeem).toHaveBeenCalledOnce();
  });
  it('口座番号を復元せず、空の欄に赤表示とフォーカス。再送の入力と版とキーを保つ', async () => {
    vi.mocked(affiliateSelfApi.saveBank).mockRejectedValueOnce(new Error('保存できませんでした')).mockResolvedValueOnce({ ...bank, version: 8 });
    render(<AffiliatePayments editable />);
    fireEvent.click(await screen.findByRole('button', { name: '振込先を編集する' }));
    const number = screen.getByLabelText('口座番号') as HTMLInputElement;
    expect(number.value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    expect(screen.getByText('口座番号を1〜8桁の数字で入力してください')).toBeTruthy();
    expect(number.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(number);
    expect(affiliateSelfApi.saveBank).not.toHaveBeenCalled();
    fireEvent.change(number, { target: { value: '12345678' } });
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await screen.findByText('保存できませんでした');
    expect((screen.getByLabelText('口座番号') as HTMLInputElement).value).toBe('12345678');
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await screen.findByText('振込先を保存しました');
    expect(vi.mocked(affiliateSelfApi.saveBank).mock.calls[0]).toEqual(vi.mocked(affiliateSelfApi.saveBank).mock.calls[1]);
    expect(vi.mocked(affiliateSelfApi.saveBank).mock.calls[0][1]).toBe(7);
  });
  it('更新競合では入力を残して再取得を要求する。入力を破棄する前に確認する', async () => {
    vi.mocked(affiliateSelfApi.saveBank).mockRejectedValue(new SelfApiError(409, {}, '振込先が更新されています'));
    render(<AffiliatePayments editable />);
    fireEvent.click(await screen.findByRole('button', { name: '振込先を編集する' }));
    fireEvent.change(screen.getByLabelText('口座番号'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await screen.findByText('振込先が更新されています');
    expect(screen.queryByRole('button', { name: '保存する' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '最新の振込先を読み込む' }));
    await screen.findByText(/最新の振込先を取得しました/);
    expect((screen.getByLabelText('口座番号') as HTMLInputElement).value).toBe('12345678');
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.getByRole('alertdialog', { name: '入力を破棄しますか？' })).toBeTruthy();
  });
  it('停止した紹介者は振込先編集を隠し、期限切れ明細はダウンロードさせない', async () => {
    vi.mocked(affiliateSelfApi.statements).mockResolvedValue([{ id: 's1', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-02-01T00:00:00Z', totalAmount: 1000 }, { id: 's2', createdAt: '2026-01-02T00:00:00Z', expiresAt: null, totalAmount: 2000 }]);
    render(<AffiliatePayments editable={false} />);
    await screen.findByText('ダウンロード期限を過ぎています');
    expect(screen.queryByRole('button', { name: '振込先を編集する' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'PDFをダウンロードする' }));
    expect(affiliateSelfApi.download).toHaveBeenCalledWith('s2');
  });

});

it.each([true, false])('マイル画面への交換の配線を守り、登録した紹介者には振込先と明細も出す：%s', async registered => {
  vi.stubGlobal('fetch', vi.fn(async input => {
    const path = new URL(String(input), 'https://example.test').pathname;
    if (path.endsWith('/liff/config')) return new Response('{"success":true,"data":{}}');
    if (path.endsWith('/affiliate/me')) return new Response(JSON.stringify({ affiliate: { id: 'a1', isActive: true }, links: [] }), { status: registered ? 200 : 404 });
    if (path.endsWith('/affiliate/offers')) return new Response('{"offers":[]}');
    return new Response(JSON.stringify({ mileage: { available: 150, lifetimeEarned: 150, spent: 0, pending: 0 }, insights: { accountCount: 1 }, opportunities: [], history: [] }));
  }));
  render(<Affiliate />);
  expect(await screen.findByRole('region', { name: 'マイルを使う' })).toBeTruthy();
  if (registered) expect(await screen.findByRole('button', { name: '振込先を編集する' })).toBeTruthy();
  else expect(screen.queryByRole('region', { name: '振込先と支払明細' })).toBeNull();
});
