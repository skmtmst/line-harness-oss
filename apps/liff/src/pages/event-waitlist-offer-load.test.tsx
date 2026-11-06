// @vitest-environment happy-dom
import { StrictMode, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EventWaitlistOffer from './event-waitlist-offer.js';
import { api, type EventWaitlistOfferDetail } from '../lib/api.js';

const handlers = vi.hoisted(() => new Map<string, (() => void)[]>());
vi.mock('../components/ui/button/index.js', async original => {
  const { default: Button } = await original<typeof import('../components/ui/button/index.js')>();
  return { default: (props: ComponentProps<typeof Button>) => {
    if (typeof props.children === 'string' && props.onClick) {
      const saved = handlers.get(props.children) ?? [];
      saved.push(() => { void props.onClick!({} as never); });
      handlers.set(props.children, saved);
    }
    return <Button {...props} />;
  } };
});
vi.mock('../lib/api.js', () => ({ api: {
  eventWaitlistOffer: vi.fn(), acceptEventWaitlistOffer: vi.fn(),
  customerLook: vi.fn().mockResolvedValue({ success: true, data: { settings: {} } }),
  liffConfig: vi.fn().mockResolvedValue({ data: {} }),
} }));
vi.mock('@line/liff', () => ({ default: { closeWindow: vi.fn() } }));
vi.mock('../lib/user-message.js', async original => ({ ...await original<typeof import('../lib/user-message.js')>(), logFailure: vi.fn() }));
const detail: EventWaitlistOfferDetail = {
  waitlistId: 'w', eventId: 'e', slotId: 's', partySize: 2, status: 'offered',
  expiresAt: '2030-11-01T01:00:00Z', eventName: '見本の体験会',
  startsAt: '2030-11-20T01:00:00Z', endsAt: '2030-11-20T02:00:00Z',
  venueName: '見本の会場', remainingSeconds: 3600, canAccept: true,
};
const success = (name = detail.eventName) => ({ success: true as const, data: { ...detail, eventName: name } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const view = (token: string) => <MemoryRouter><EventWaitlistOffer token={token} /></MemoryRouter>;
function lastHandler(name: string) {
  const all = handlers.get(name) ?? [];
  expect(all.length).toBeGreaterThan(0);
  return all[all.length - 1];
}
function expectNoOffer() {
  expect(screen.queryByText('空きが出ました')).toBeNull();
  expect(screen.queryByRole('button', { name: 'この席を取る' })).toBeNull();
  expect(document.querySelector('[data-liff-bottom-bar]')).toBeNull();
  expect(api.acceptEventWaitlistOffer).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks(); handlers.clear();
  vi.mocked(api.eventWaitlistOffer).mockReset().mockResolvedValue(success());
  vi.mocked(api.acceptEventWaitlistOffer).mockReset().mockResolvedValue({ success: true, data: { bookingId: 'b', status: 'confirmed', alreadyConfirmed: false } });
});
afterEach(cleanup);

it('詳細の取得中は読込状態と閉じるだけで、承諾を出さない', () => {
  vi.mocked(api.eventWaitlistOffer).mockReturnValueOnce(new Promise(() => {}));
  render(view('a'));
  expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy();
  expectNoOffer();
});

it.each(['503', '401', '404', 'network', 'null', 'missing', 'sync-throw'])('%s は固定の取得失敗とGET読み直しになり、自動承諾しない', async mode => {
  const get = vi.mocked(api.eventWaitlistOffer);
  if (mode === 'null') get.mockResolvedValueOnce({ success: true, data: null } as never);
  else if (mode === 'missing') get.mockResolvedValueOnce({ success: true } as never);
  else if (mode === 'sync-throw') get.mockImplementationOnce(() => { throw new Error('private-detail-secret'); });
  else get.mockRejectedValueOnce(Object.assign(new Error('private-detail-secret'), { status: Number(mode) || undefined }));
  render(view('a'));
  expect(await screen.findByText('読み込めませんでした')).toBeTruthy();
  expect(screen.queryByText(/private-detail-secret/)).toBeNull();
  expectNoOffer();
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }));
  expect(await screen.findByText('見本の体験会')).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(2);
  expect(api.acceptEventWaitlistOffer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'この席を取る' }));
  expect(await screen.findByText('予約が確定しました')).toBeTruthy();
  expect(api.acceptEventWaitlistOffer).toHaveBeenCalledExactlyOnceWith('a');
});

it('読み直しを同tickで連打してもGETは1回、取得中に承諾は出ない', async () => {
  const next = deferred<ReturnType<typeof success>>();
  vi.mocked(api.eventWaitlistOffer).mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(next.promise);
  render(view('a'));
  await screen.findByText('読み込めませんでした');
  const retry = lastHandler('もう一度読み込む');
  act(() => { retry(); retry(); });
  expect(api.eventWaitlistOffer).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  expectNoOffer();
  await act(async () => next.resolve(success()));
  await screen.findByText('見本の体験会');
  act(retry);
  expect(api.eventWaitlistOffer).toHaveBeenCalledTimes(2);
  expect(api.acceptEventWaitlistOffer).not.toHaveBeenCalled();
});

it('同tickの古い承諾handlerでも二度送らず、送信失敗から手動で再試行できる', async () => {
  const post = deferred<Awaited<ReturnType<typeof api.acceptEventWaitlistOffer>>>();
  vi.mocked(api.acceptEventWaitlistOffer).mockReturnValueOnce(post.promise);
  render(view('a'));
  await screen.findByText('見本の体験会');
  const accept = lastHandler('この席を取る');
  act(() => { accept(); accept(); });
  expect(api.acceptEventWaitlistOffer).toHaveBeenCalledTimes(1);
  await act(async () => post.reject(new Error('offline')));
  fireEvent.click(await screen.findByRole('button', { name: 'もう一度試す' }));
  await screen.findByText('予約が確定しました');
  expect(api.acceptEventWaitlistOffer).toHaveBeenCalledTimes(2);
  expect(api.eventWaitlistOffer).toHaveBeenCalledTimes(1);
});

it.each(['success', 'failure'])('A→B→Aで古いGETの%sを持ち越さず、今の対象だけ表示する', async outcome => {
  const a = deferred<ReturnType<typeof success>>();
  const b = deferred<ReturnType<typeof success>>();
  const current = deferred<ReturnType<typeof success>>();
  vi.mocked(api.eventWaitlistOffer).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(current.promise);
  const page = render(view('a'));
  page.rerender(view('b')); page.rerender(view('a'));
  expect(api.eventWaitlistOffer).toHaveBeenCalledTimes(3);
  await act(async () => {
    if (outcome === 'success') { a.resolve(success('古いA')); b.resolve(success('古いB')); }
    else { a.reject(new Error('old-a')); b.reject(new Error('old-b')); }
  });
  expectNoOffer();
  await act(async () => current.resolve(success('現在のA')));
  expect(await screen.findByText('現在のA')).toBeTruthy();
  expect(screen.queryByText(/古い/)).toBeNull();
  expect(api.acceptEventWaitlistOffer).not.toHaveBeenCalled();
});

it('取得済みカードから別tokenへ切り替わった初描画に古い詳細や承諾を残さない', async () => {
  vi.mocked(api.eventWaitlistOffer).mockResolvedValueOnce(success()).mockReturnValueOnce(new Promise(() => {}));
  const page = render(view('a'));
  await screen.findByText('見本の体験会');
  const oldAccept = lastHandler('この席を取る');
  page.rerender(view('b'));
  act(oldAccept);
  expectNoOffer();
  expect(screen.queryByText('見本の体験会')).toBeNull();
});

it('消えたカードの旧読み直しと旧承諾handlerは新カードの同tick操作に割り込まない', async () => {
  vi.mocked(api.eventWaitlistOffer).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(success()).mockReturnValueOnce(new Promise(() => {}));
  const page = render(view('a'));
  await screen.findByText('読み込めませんでした');
  const oldRetry = lastHandler('もう一度読み込む');
  act(oldRetry);
  await screen.findByText('見本の体験会');
  const oldAccept = lastHandler('この席を取る');
  page.rerender(view('b'));
  act(() => { oldRetry(); oldAccept(); });
  expectNoOffer();
  expect(api.eventWaitlistOffer).toHaveBeenCalledTimes(3);
  page.unmount();
  act(() => { oldAccept(); oldRetry(); });
  expect(api.acceptEventWaitlistOffer).not.toHaveBeenCalled();
  expect(api.eventWaitlistOffer).toHaveBeenCalledTimes(3);
});

it.each(['success', 'failure'])('古いPOSTの%sで新しい案内を完了や失敗にしない', async outcome => {
  const post = deferred<Awaited<ReturnType<typeof api.acceptEventWaitlistOffer>>>();
  vi.mocked(api.acceptEventWaitlistOffer).mockReturnValueOnce(post.promise);
  const page = render(view('a'));
  fireEvent.click(await screen.findByRole('button', { name: 'この席を取る' }));
  page.rerender(view('b'));
  await screen.findByText('見本の体験会');
  await act(async () => {
    if (outcome === 'success') post.resolve({ success: true, data: { bookingId: 'old', status: 'confirmed', alreadyConfirmed: false } });
    else post.reject({ status: 410 });
  });
  expect(screen.getByRole('button', { name: 'この席を取る' })).toBeTruthy();
  expect(screen.queryByText('予約が確定しました')).toBeNull();
  expect(screen.queryByText('回答期限を過ぎています')).toBeNull();
  expect(api.acceptEventWaitlistOffer).toHaveBeenCalledTimes(1);
});

it.each(['success', 'failure'])('StrictModeで破棄された最初のGETの%sを捨て、2回目の結果だけ採る', async outcome => {
  const first = deferred<ReturnType<typeof success>>();
  const second = deferred<ReturnType<typeof success>>();
  vi.mocked(api.eventWaitlistOffer).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(<StrictMode>{view('a')}</StrictMode>);
  await waitFor(() => expect(api.eventWaitlistOffer).toHaveBeenCalledTimes(2));
  await act(async () => {
    if (outcome === 'success') first.resolve(success('破棄された結果'));
    else first.reject(new Error('discarded'));
  });
  expectNoOffer();
  await act(async () => second.resolve(success('現在の結果')));
  expect(await screen.findByText('現在の結果')).toBeTruthy();
  expect(screen.queryByText('破棄された結果')).toBeNull();
  expect(screen.queryByText('読み込めませんでした')).toBeNull();
});
