// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const fx = vi.hoisted(() => ({ redeemQr: vi.fn(), closeWindow: vi.fn() }));
vi.mock('../lib/api.js', () => ({
  api: { customerLook: vi.fn().mockResolvedValue({ success: true, data: { settings: { liff_theme: "line" } } }), bookingSettings: vi.fn().mockResolvedValue({ data: {} }), liffConfig: vi.fn().mockResolvedValue({ data: { accountId: 'acc-1', accountName: '店舗', botBasicId: '@shop' } }) },
  visitStampsApi: { redeemQr: fx.redeemQr },
}));
vi.mock('@line/liff', () => ({ default: { isInClient: () => true, closeWindow: fx.closeWindow } }));
import VisitStampQr from './VisitStampQr.js';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('読み込み失敗は共通の失敗表示から同じ依頼で再試行し、LINEへ戻れる', async () => {
  fx.redeemQr.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ data: { status: 'invalid', reason: 'invalid' } });
  render(<MemoryRouter initialEntries={['/visit-stamp-qr?token=qr-1&accountId=acc-1']}><VisitStampQr /></MemoryRouter>);
  expect(await screen.findByText('読み込めませんでした')).toBeTruthy();
  expect(screen.getByText('押印を確認できませんでした。読み直してください。')).toBeTruthy();
  const firstArgs = fx.redeemQr.mock.calls[0];
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }));
  expect(await screen.findByText('この QR は使えません')).toBeTruthy();
  await waitFor(() => expect(fx.redeemQr).toHaveBeenCalledTimes(2));
  expect(fx.redeemQr.mock.calls[1]).toEqual(firstArgs);
  expect(screen.queryByText('読み込めませんでした')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'LINE に戻る' }));
  expect(fx.closeWindow).toHaveBeenCalledOnce();
});
