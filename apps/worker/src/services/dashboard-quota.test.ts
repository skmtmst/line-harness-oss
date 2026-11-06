import { afterEach, expect, test, vi } from 'vitest';
import { fetchQuota } from './dashboard-quota.js';

afterEach(() => { vi.unstubAllGlobals(); });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test('not connected is distinct from unavailable and performs no external request', async () => {
  const transport = vi.fn(); vi.stubGlobal('fetch', transport);
  expect(await fetchQuota(undefined)).toEqual({ limit: null, used: null, unlimited: false, failed: false, reason: 'not_connected', asOf: null });
  expect(transport).not.toHaveBeenCalled();
});
test.each(['limited', 'none'])('retains successful quota contract: %s', async type => {
  const transport = vi.fn().mockResolvedValueOnce(response({ type, value: 200 }))
    .mockResolvedValueOnce(response({ totalUsage: 30 }));
  vi.stubGlobal('fetch', transport);
  expect(await fetchQuota('private-token')).toMatchObject({ limit: type === 'limited' ? 200 : null,
    used: 30, unlimited: type === 'none', failed: false, reason: null, asOf: expect.any(String) });
  expect(transport).toHaveBeenCalledTimes(2);
  const signals = transport.mock.calls.map(call => call[1].signal);
  expect(signals[0]).toBe(signals[1]);
  expect(transport.mock.calls.every(call => call[1].redirect === 'manual')).toBe(true);
});
test.each([401, 403, 429, 500])('HTTP %s stays unavailable without retry or zero', async status => {
  const transport = vi.fn().mockResolvedValueOnce(response({}, status)).mockResolvedValueOnce(response({ totalUsage: 30 }));
  vi.stubGlobal('fetch', transport);
  expect(await fetchQuota('private-token')).toEqual({ limit: null, used: null, unlimited: false, failed: true, reason: 'fetch_failed', asOf: null });
  expect(transport).toHaveBeenCalledTimes(2);
});
test('malformed successful response is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ type: 'limited' })).mockResolvedValueOnce(response({})));
  expect(await fetchQuota('private-token')).toHaveProperty('reason', 'fetch_failed');
});
test('header request and JSON body both obey the existing deadline', async () => {
  for (const stage of ['headers', 'body']) {
    const transport = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => stage === 'headers'
      ? new Promise<Response>(() => {})
      : Promise.resolve({ ok: true, json: () => new Promise(() => {}) }));
    vi.stubGlobal('fetch', transport);
    expect(await fetchQuota('private-token', 20)).toMatchObject({ used: null, failed: true, asOf: null });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
  }
});
