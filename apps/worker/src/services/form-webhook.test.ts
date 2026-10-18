import { afterEach, describe, expect, it, vi } from 'vitest';
import { callFormWebhook } from './form-webhook.js';

const form = { on_submit_webhook_url: 'https://verify.example.com/check', on_submit_webhook_headers: JSON.stringify({ 'X-Api-Key': 'synthetic-webhook-token' }) };
afterEach(() => vi.unstubAllGlobals());
describe('form webhook redirect boundary', () => {
  it('keeps normal eligibility checks and the stable event id', async () => {
    const mock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      expect(new Headers(init?.headers).get('x-form-event-id')).toBe('event-1');
      return Response.json({ eligible: true });
    });
    vi.stubGlobal('fetch', mock);
    expect((await callFormWebhook(form, { answer: 'yes' }, 'event-1', { lookupHost: async () => ['93.184.216.34'] })).passed).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it.each([301, 302, 303, 304, 307, 308])('rejects HTTP %s and does not follow a redirect carrying saved headers', async status => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push(url);
      if (init.redirect !== 'manual') seen.push('https://evil.example.com/stolen');
      return new Response(null, { status, headers: { location: 'https://evil.example.com/stolen' } });
    }));
    expect((await callFormWebhook(form, {}, null, { lookupHost: async () => ['93.184.216.34'] })).passed).toBe(false);
    expect(seen).toEqual([form.on_submit_webhook_url]);
  });
  it('rejects opaqueredirect without reading its body', async () => {
    const json = vi.fn(async () => ({ eligible: true }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'opaqueredirect', ok: true, status: 200, json })));
    expect((await callFormWebhook(form, {}, null, { lookupHost: async () => ['93.184.216.34'] })).passed).toBe(false);
    expect(json).not.toHaveBeenCalled();
  });
  it('does not return or log a fetch exception containing saved credentials', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('synthetic-webhook-token'); }));
      const result = await callFormWebhook(form, {}, null, { lookupHost: async () => ['93.184.216.34'] });
      expect(result.passed).toBe(false);
      expect(JSON.stringify(result).includes('synthetic-webhook-token')).toBe(false);
      expect(JSON.stringify(log.mock.calls).includes('synthetic-webhook-token')).toBe(false);
    } finally { log.mockRestore(); }
  });
});

it('returns only the eligibility and existing safe join link, never arbitrary response fields', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ eligible: true, secret: 'private-upstream-value', join_url: 'https://join.example.com/event' })));
  expect(await callFormWebhook(form, {}, 'event', { lookupHost: async () => ['93.184.216.34'] })).toEqual({
    passed: true, data: { eligible: true, join_url: 'https://join.example.com/event' },
  });
});
it('bounds streamed external responses without trusting Content-Length', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(' '.repeat(65537))));
  expect(await callFormWebhook(form, {}, 'event', { lookupHost: async () => ['93.184.216.34'] })).toEqual({ passed: false, data: { error: 'Webhook response too large' } });
});
it('does not send saved headers when the response destination is an answer variable', async () => {
  const send = vi.fn(); vi.stubGlobal('fetch', send);
  expect((await callFormWebhook({ ...form, on_submit_webhook_url: 'https://{host}/check' }, { host: 'evil.example.com' }, 'event')).passed).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

it.each(['X-Form-Event-Id', 'x-form-event-id'])('keeps the durable event id when legacy saved %s tries to override it', async headerName => {
  const send = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('X-Form-Event-Id')).toBe('stable-event');
    return Response.json({ eligible: true });
  });
  vi.stubGlobal('fetch', send);
  expect((await callFormWebhook({ ...form, on_submit_webhook_headers: JSON.stringify({ [headerName]: 'wrong-event' }) }, {}, 'stable-event', { lookupHost: async () => ['93.184.216.34'] })).passed).toBe(true);
});

it('projects legacy persisted outcomes and refuses join links carrying credentials', async () => {
  const { publicFormWebhookData } = await import('./form-webhook.js');
  expect(publicFormWebhookData({ success: true, data: { eligible: true, credential: 'synthetic-private-upstream' }, privateData: 'synthetic-private-upstream', join_url: 'https://user:password@example.com/join' }))
    .toEqual({ eligible: true });
  expect(publicFormWebhookData({ eligible: false, error: 'synthetic-private-upstream', join_url: 'https://example.com/private-join' })).toEqual({ eligible: false });
});
