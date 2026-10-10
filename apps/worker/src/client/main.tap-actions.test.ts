// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const couponMount = vi.hoisted(() => vi.fn());
vi.mock('./entry-route-coupon/main.js', () => ({ mountEntryRouteCoupon: couponMount }));
const mount = vi.hoisted(() => vi.fn());
vi.mock('./visit-stamps/main.js', () => ({ mountVisitStamps: mount }));

beforeEach(() => {
  vi.resetModules(); mount.mockClear(); couponMount.mockClear();
  window.history.replaceState(null, '', '/?liffId=store-id&page=visit-stamps&card=chosen');
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('liff', {
    init: vi.fn().mockResolvedValue(undefined), isLoggedIn: () => true, isInClient: () => true,
    getProfile: vi.fn().mockResolvedValue({ userId: 'friend', displayName: 'お客さま' }),
    getIDToken: () => 'id-token', getFriendship: vi.fn().mockResolvedValue({ friendFlag: true }),
    login: vi.fn(),
  });
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

function configResponse() { return new Response(JSON.stringify({ success: true, data: { botBasicId: '@shop' } })); }
test('本人の紐付け完了後、認証とカード指定を保って既存スタンプ画面を開く', async () => {
  let complete!: (r: Response) => void;
  const linking = new Promise<Response>(resolve => { complete = resolve; });
  const fetch = vi.fn((url: string) => url.startsWith('/api/liff/config') ? Promise.resolve(configResponse()) : linking);
  vi.stubGlobal('fetch', fetch);
  await import('./main.js');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/liff/link', expect.anything()));
  expect(mount).not.toHaveBeenCalled();
  complete(new Response(JSON.stringify({ success: true, data: { userId: 'uuid' } })));
  await vi.waitFor(() => expect(mount).toHaveBeenCalledWith(document.getElementById('app'), { liffId: 'store-id', lineUserId: 'friend', idToken: 'id-token' }));
  expect(new URLSearchParams(window.location.search).get('card')).toBe('chosen');
});
test('未フォローの人は友だち追加へ案内し、スタンプ画面を開かない', async () => {
  vi.mocked((globalThis as unknown as { liff: { getFriendship: ReturnType<typeof vi.fn> } }).liff.getFriendship).mockResolvedValue({ friendFlag: false });
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.startsWith('/api/liff/config') ? configResponse() : new Response('{}'))));
  await import('./main.js');
  await vi.waitFor(() => expect(document.getElementById('addFriendBtn')).toBeTruthy());
  expect(mount).not.toHaveBeenCalled();
});
test('本人の紐付けに失敗した場合は画面を開かず、再実行を案内する', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.startsWith('/api/liff/config') ? configResponse() : new Response('{}', { status: 503 }))));
  await import('./main.js');
  await vi.waitFor(() => expect(document.body.textContent).toContain('来店スタンプを開けませんでした'));
  expect(mount).not.toHaveBeenCalled();
});

test('クーポンQRは紐付けを待ち、同じ店の認証とrefを保ってクーポン画面へ進む', async () => {
  window.history.replaceState(null, '', '/?liffId=store-id&ref=qr&couponRef=qr');
  let complete!: (r: Response) => void;
  const linking = new Promise<Response>(resolve => { complete = resolve; });
  const fetch = vi.fn((url: string) => url.startsWith('/api/liff/config') ? Promise.resolve(configResponse()) : url === '/api/liff/link' ? linking : Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch', fetch);
  await import('./main.js');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/liff/link', expect.anything()));
  expect(couponMount).not.toHaveBeenCalled();
  complete(new Response(JSON.stringify({ success: true, data: { userId: 'uuid' } })));
  await vi.waitFor(() => expect(couponMount).toHaveBeenCalledWith(document.getElementById('app'), { liffId: 'store-id', lineUserId: 'friend', idToken: 'id-token' }));
  expect(new URLSearchParams(window.location.search).get('couponRef')).toBe('qr');
  expect(mount).not.toHaveBeenCalled();
});
test('クーポンQRも未フォローなら友だち追加へ進み、追加前は表示しない', async () => {
  window.history.replaceState(null, '', '/?liffId=store-id&ref=qr&couponRef=qr');
  vi.mocked((globalThis as unknown as { liff: { getFriendship: ReturnType<typeof vi.fn> } }).liff.getFriendship).mockResolvedValue({ friendFlag: false });
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.startsWith('/api/liff/config') ? configResponse() : new Response('{}'))));
  await import('./main.js');
  await vi.waitFor(() => expect(document.getElementById('addFriendBtn')).toBeTruthy());
  expect(couponMount).not.toHaveBeenCalled();
});
