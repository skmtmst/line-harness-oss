import { afterEach, expect, test, vi } from 'vitest';
import { verifyLineMessagingIdentity } from './line-messaging-identity.js';
afterEach(() => vi.unstubAllGlobals());
const input = { channelId: '1001', channelSecret: 'secret-a', channelAccessToken: 'supplied' };
test.each([['U-a', true], ['U-b', false], [undefined, false]] as const)('only same bot credentials are accepted (%s)', async (suppliedId, expected) => {
  vi.stubGlobal('fetch', vi.fn(async (url, init) => String(url) === 'https://api.line.me/oauth2/v3/token'
    ? Response.json({ access_token: 'issued', expires_in: 3600 })
    : Response.json({ userId: init.headers.Authorization === 'Bearer issued' ? 'U-a' : suppliedId })));
  expect(await verifyLineMessagingIdentity(input)).toBe(expected);
});
test.each([401, 429, 500])('token proof failure %i never accepts or logs credentials', async (status) => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status })); vi.stubGlobal('fetch', fetcher);
  expect(await verifyLineMessagingIdentity(input)).toBe(false); expect(fetcher).toHaveBeenCalledOnce();
});
test('network failure fails closed', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret response')));
  expect(await verifyLineMessagingIdentity(input)).toBe(false);
});

test('proof uses stateless credentials and does not reissue stored sending credentials', async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === 'https://api.line.me/oauth2/v3/token') {
      expect(init?.method).toBe('POST');
      expect(String(init?.body)).toBe('grant_type=client_credentials&client_id=1001&client_secret=secret-a');
      return Response.json({ access_token: 'proof', expires_in: 900 });
    }
    expect(url).toBe('https://api.line.me/v2/bot/info');
    return Response.json({ userId: 'U-a' });
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await verifyLineMessagingIdentity(input)).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
test('malformed proof fails closed before bot lookups', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ access_token: 123 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await verifyLineMessagingIdentity(input)).toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
});
