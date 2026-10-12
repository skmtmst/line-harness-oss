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
    expect((await callFormWebhook(form, { answer: 'yes' }, 'event-1')).passed).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it.each([301, 302, 303, 304, 307, 308])('rejects HTTP %s and does not follow a redirect carrying saved headers', async status => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push(url);
      if (init.redirect !== 'manual') seen.push('https://evil.example.com/stolen');
      return new Response(null, { status, headers: { location: 'https://evil.example.com/stolen' } });
    }));
    expect((await callFormWebhook(form, {}, null)).passed).toBe(false);
    expect(seen).toEqual([form.on_submit_webhook_url]);
  });
  it('rejects opaqueredirect without reading its body', async () => {
    const json = vi.fn(async () => ({ eligible: true }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'opaqueredirect', ok: true, status: 200, json })));
    expect((await callFormWebhook(form, {}, null)).passed).toBe(false);
    expect(json).not.toHaveBeenCalled();
  });
  it('does not return or log a fetch exception containing saved credentials', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('synthetic-webhook-token'); }));
      const result = await callFormWebhook(form, {}, null);
      expect(result.passed).toBe(false);
      expect(JSON.stringify(result).includes('synthetic-webhook-token')).toBe(false);
      expect(JSON.stringify(log.mock.calls).includes('synthetic-webhook-token')).toBe(false);
    } finally { log.mockRestore(); }
  });
});
