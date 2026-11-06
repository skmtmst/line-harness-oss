// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLayoutEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
const commits = vi.hoisted(() => [] as string[]);
vi.mock('../lib/liff-auth.js', () => ({ getIdToken: () => 'test-token', getLiffId: () => 'test-liff' }));
vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));
vi.mock('../components/liff-look-scope.js', () => ({ default: function Scope({ children }: { children: ReactNode }) {
  useLayoutEffect(() => { commits.push(document.body.textContent ?? ''); });
  return <div>{children}</div>;
} }));
vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api.js')>();
  return { ...original, api: { ...original.api, liffConfig: vi.fn().mockResolvedValue({ success: true, data: { accountName: '見本店' } }) } };
});
import EntryRouteCoupon from './entry-route-coupon.js';
const recorded = 'クーポンの使用を記録しました';
const partial = 'クーポンの使用を記録しました。使用後の処理に失敗したため、お店に確認してください';
const replayNotice = 'クーポンの使用は記録済みです。使用後の処理の結果は確認できません。お店に確認してください。';
const unknown = '使用結果を確認できませんでした。お店の方と確認してから、もう一度お試しください。';
const receipt = { receiptId: 'receipt-a', name: '割引A', assetId: 'c', usedCount: 0, receivedAt: '2026-11-01', payload: { description: 'お会計の割引', startsAt: '2026-01-01', endsAt: '2026-12-01', oncePerFriend: true } };
const envelope = (data: unknown) => ({ success: true, data });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const modern = (message: string) => ({ success: false, error: { code: 'CONFLICT', message, requestId: 'test-request', fieldErrors: [] } });
let receive: (ref: string) => Promise<Response>;
let use: (body: { receiptId: string; requestId: string }) => Promise<Response>;
let writes: Array<{ receiptId: string; requestId: string }>;
beforeEach(() => {
  commits.length = 0; writes = [];
  receive = async () => reply(envelope(receipt));
  use = async () => reply(envelope({ message: recorded, replayed: false }));
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (path === '/api/liff/entry-route-coupon/use') { writes.push(body); return use(body); }
    if (path === '/api/liff/entry-route-coupon') return receive(body.ref);
    throw new Error('unexpected request');
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Navigation() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate('/?couponRef=a')}>経路A</button><button onClick={() => navigate('/?couponRef=b')}>経路B</button></>;
}
function mount() { return render(<MemoryRouter initialEntries={['/?couponRef=a']}><Navigation /><EntryRouteCoupon /></MemoryRouter>); }
async function confirmUse() {
  fireEvent.click(await screen.findByRole('button', { name: 'クーポンを使う' }));
  const dialog = await screen.findByRole('dialog', { name: 'クーポンを使いますか？' });
  const button = within(dialog).getByRole('button', { name: '使用を確定' });
  fireEvent.click(button); return button;
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
it.each([recorded, partial])('記録成立を表示して窓を閉じ、使用回数を維持する：%s', async (message) => {
  use = async () => reply(envelope({ message, replayed: false })); mount(); await confirmUse();
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.getByText('このクーポンは使用済みです')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'クーポンを使う' })).toBeNull();
  expect(writes).toHaveLength(1);
});
it.each(['知らない日本語の案内', '<script>内部情報</script>', undefined])('未知の成功本文を反射せず記録成立を表示する：%s', async (message) => {
  use = async () => reply(envelope({ message, replayed: false })); mount(); await confirmUse();
  expect(await screen.findByText(recorded)).toBeTruthy();
  if (message) expect(document.body.textContent).not.toContain(message);
});
const reasons = ['このクーポンは使えません', 'クーポンの設定を確認してください', 'まだクーポンの利用期間ではありません', 'クーポンの期限が切れています', 'このクーポンは使える回数に達しています'];
for (const shape of ['legacy', 'modern']) it.each(reasons)('409の固定理由を表示する '+shape+'：%s', async (message) => {
  use = async () => reply(shape === 'legacy' ? { success: false, error: message } : modern(message), 409);
  mount(); await confirmUse(); expect((await screen.findByRole('alert')).textContent).toBe(message);
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.queryByText('このクーポンは使用済みです')).toBeNull();
});
it.each(['クーポンの期限が切れています。追加の秘密', '<script>内部情報</script>'])('未知409は結果不明にし本文を出さない：%s', async (message) => {
  use = async () => reply(modern(message), 409); mount(); await confirmUse();
  expect((await screen.findByRole('alert')).textContent).toBe(unknown);
  expect(document.body.textContent).not.toContain(message);
});
it('既知の理由文でも409以外の応答は結果不明にする', async () => {
  use = async () => reply(modern(reasons[3]), 503); mount(); await confirmUse();
  expect((await screen.findByRole('alert')).textContent).toBe(unknown);
  expect(document.body.textContent).not.toContain(reasons[3]);
});
it('401は結果を断定せずLINEからの開き直しを案内する', async () => {
  use = async () => reply({ success: false, error: 'Invalid ID token' }, 401); mount(); await confirmUse();
  expect((await screen.findByRole('alert')).textContent).toBe('使用結果を確認できませんでした。お店の方と確認し、LINEから画面を開き直してください。');
  expect(screen.getByRole('dialog')).toBeTruthy();
});
it.each(['network', 'server'])('結果不明の同じ操作を再試行し、連打やreplayで回数を増やさない：%s', async (failure) => {
  const pending = deferred<Response>(); use = () => pending.promise; mount(); const button = await confirmUse();
  fireEvent.click(button);
  expect(writes).toHaveLength(1);
  if (failure === 'server') await act(async () => pending.resolve(reply({ error: '一時的な障害' }, 503)));
  else await act(async () => pending.reject(new TypeError('network')));
  expect((await screen.findByRole('alert')).textContent).toBe(unknown);
  use = async () => reply(envelope({ message: recorded, replayed: true }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '使用を確定' }));
  expect(await screen.findByText(replayNotice)).toBeTruthy(); expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]); expect(screen.getByText('このクーポンは使用済みです')).toBeTruthy();
});
it('再送の既知の失敗文は、結果不明ではなく失敗として表示する', async () => {
  use = async () => reply(envelope({ message: partial, replayed: true })); mount(); await confirmUse();
  expect(await screen.findByText(partial)).toBeTruthy();
  expect(screen.queryByText(replayNotice)).toBeNull();
});
it('再送の結果を別の券に持ち越さない', async () => {
  receive = async (ref) => reply(envelope({ ...receipt, receiptId: ref, name: ref === 'a' ? '割引A' : '割引B', payload: { ...receipt.payload, oncePerFriend: false } }));
  use = async () => reply(envelope({ message: recorded, replayed: true })); mount(); await confirmUse(); await screen.findByText(replayNotice);
  commits.length = 0; fireEvent.click(screen.getByRole('button', { name: '経路B' })); await screen.findByRole('heading', { name: '割引B' });
  expect(commits.length).toBeGreaterThan(0);
  expect(commits.every(text => !text.includes(replayNotice))).toBe(true);
});
it('既に表示した結果文を経路切替の最初の描画にも残さない', async () => {
  receive = async (ref) => reply(envelope({ ...receipt, receiptId: ref, name: ref === 'a' ? '割引A' : '割引B', payload: { ...receipt.payload, oncePerFriend: false } }));
  use = async () => reply(envelope({ message: partial, replayed: false })); mount(); await confirmUse(); await screen.findByText(partial);
  commits.length = 0; fireEvent.click(screen.getByRole('button', { name: '経路B' })); await screen.findByRole('heading', { name: '割引B' });
  expect(commits.length).toBeGreaterThan(0); expect(commits.every(text => !text.includes(partial))).toBe(true);
});
for (const route of ['b', 'back', 'reload']) it.each(['success', 'replay', 'error'])('古い応答の結果文を混ぜない '+route+'：%s', async (outcome) => {
  const pending = deferred<Response>(); let visitsA = 0;
  receive = async (ref) => {
    if (ref === 'a') { visitsA++; if (route === 'reload' && visitsA === 2) return reply({ error: 'unavailable' }, 503); }
    return reply(envelope({ ...receipt, receiptId: ref === 'a' ? receipt.receiptId : 'receipt-b', name: ref === 'a' ? '割引A' : '割引B' }));
  };
  use = () => pending.promise; mount(); await confirmUse();
  fireEvent.click(screen.getByRole('button', { name: '経路B' })); await screen.findByRole('heading', { name: '割引B' });
  if (route !== 'b') {
    fireEvent.click(screen.getByRole('button', { name: '経路A' }));
    if (route === 'reload') { fireEvent.click(await screen.findByRole('button', { name: 'もう一度読み込む' })); }
    await screen.findByRole('heading', { name: '割引A' });
  }
  commits.length = 0;
  await act(async () => pending.resolve(outcome === 'success' ? reply(envelope({ message: partial, replayed: false })) : outcome === 'replay' ? reply(envelope({ message: recorded, replayed: true })) : reply(modern(reasons[3]), 409)));
  await waitFor(() => expect(screen.queryByText(partial)).toBeNull());
  expect(commits.length).toBeGreaterThan(0);
  expect(commits.every(text => !text.includes(partial) && !text.includes(replayNotice) && !text.includes(reasons[3]))).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();
});
