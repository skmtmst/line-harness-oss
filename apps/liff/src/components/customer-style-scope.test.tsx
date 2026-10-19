// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CustomerStyleScope, { useCustomerWords } from './customer-style-scope.js';
import { api } from '../lib/api.js';

const identity = vi.hoisted(() => ({ account: 'a', user: 'one' }));
vi.mock('../lib/liff-auth.js', () => ({ getLiffId: () => identity.account, getLineUserId: () => identity.user }));
vi.mock('../lib/api.js', () => ({ api: { liffConfig: vi.fn() } }));
vi.mock('./ui/liff-header.js', () => ({ default: () => null }));
function Content() { const words = useCustomerWords(); return <><p>{`${words.bookingContent}・${words.approvalPending}`}</p><input aria-label="入力" /></>; }
const config = (style: unknown) => ({ success: true, data: { accountId: identity.account, accountName: '', botBasicId: '', style } });
beforeEach(() => { identity.account = 'a'; identity.user = 'one'; });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it.each([
  ['standard', 'メニュー・お店の確認待ち'], ['ec', 'メニュー・お店の確認待ち'],
  ['restaurant', 'コース・お店の確認待ち'], ['salon', 'メニュー・お店の確認待ち'],
  ['consult', '面談の種類・確認待ち'], ['lesson', 'クラス・確認待ち'],
])('公開APIの正式業種 %s を使い、URLの業種を採用しない', async (style, text) => {
  window.history.replaceState(null, '', '/?style=restaurant');
  vi.mocked(api.liffConfig).mockResolvedValue(config(style));
  render(<CustomerStyleScope><Content /></CustomerStyleScope>);
  expect(await screen.findByText(text)).toBeTruthy();
});

it.each([undefined, null, 'meeting', 'unknown'])('未取得・不正な業種 %s を標準にせず読直しで回復する', async (style) => {
  vi.mocked(api.liffConfig).mockResolvedValueOnce(config(style)).mockResolvedValueOnce(config('consult'));
  render(<CustomerStyleScope><Content /></CustomerStyleScope>);
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度読み込む' }));
  expect(await screen.findByText('面談の種類・確認待ち')).toBeTruthy();
});

it.each(['account', 'user'] as const)('%s の切替で前の語・入力・遅い応答を持ち越さない', async (field) => {
  let resolveOld!: (r: ReturnType<typeof config>) => void;
  vi.mocked(api.liffConfig).mockReturnValueOnce(new Promise((r) => { resolveOld = r; })).mockResolvedValueOnce(config('lesson'));
  const view = render(<CustomerStyleScope><Content /></CustomerStyleScope>);
  identity[field] = 'two';
  view.rerender(<CustomerStyleScope><Content /></CustomerStyleScope>);
  expect(await screen.findByText('クラス・確認待ち')).toBeTruthy();
  await act(async () => resolveOld(config('salon')));
  expect(screen.queryByText('メニュー・お店の確認待ち')).toBeNull();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '前の入力' } });
  identity[field] = 'three';
  vi.mocked(api.liffConfig).mockResolvedValue(config('consult'));
  view.rerender(<CustomerStyleScope><Content /></CustomerStyleScope>);
  expect(screen.queryByText('クラス・確認待ち')).toBeNull();
  expect(await screen.findByText('面談の種類・確認待ち')).toBeTruthy();
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
});

it('所属不明・通信失敗は予約の入口を描かず、読み取りだけを再試行する', async () => {
  vi.mocked(api.liffConfig).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(config('salon'));
  render(<CustomerStyleScope><Content /></CustomerStyleScope>);
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度読み込む' }));
  expect(await screen.findByText('メニュー・お店の確認待ち')).toBeTruthy();
  expect(api.liffConfig).toHaveBeenCalledTimes(2);
});

it('業種を必要としない既存機能は、業種未設定だけで止めず中立語で保つ', async () => {
  vi.mocked(api.liffConfig).mockResolvedValue(config(null));
  render(<CustomerStyleScope required={false}><Content /></CustomerStyleScope>);
  await act(async () => {});
  expect(screen.getByRole('textbox')).toBeTruthy();
  expect(screen.getByText('予約内容・担当者の確認待ち')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull();
});
