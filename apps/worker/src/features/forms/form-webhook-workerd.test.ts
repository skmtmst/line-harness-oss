import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Miniflare } from 'miniflare';
import { redirectWorker } from '../../test-utils/workerd-redirect.js';

let mf: Miniflare;
beforeAll(async () => {
  mf = await redirectWorker(`
    import { callFormWebhook } from './features/forms/form-webhook.ts';
    export default { async fetch(request) {
      const url = new URL(request.url);
      const get = url.searchParams.get('get') === '1';
      const endpoint = 'https://verify.example.com' + url.pathname + url.search + (get ? '&answer={answer}' : '');
      return Response.json(await callFormWebhook({ on_submit_webhook_url: endpoint,
        on_submit_webhook_headers: JSON.stringify({ 'X-Api-Key': 'synthetic-webhook-token' }) }, { answer: 'yes' }, 'event-1', { lookupHost: async () => ['93.184.216.34'] }));
    } }
  `);
});
afterAll(async () => { await mf?.dispose(); });
beforeEach(async () => { await (await mf.getWorker('destination')).fetch('https://fixture.test/reset'); });
async function seen() { return (await (await mf.getWorker('destination')).fetch('https://fixture.test/seen')).json(); }

describe('form webhook actual workerd fetch', () => {
  it.each([false, true])('preserves normal webhook eligibility (GET: %s)', async get => {
    expect(await (await mf.dispatchFetch(`https://caller.test/check?get=${get ? 1 : 0}`)).json()).toEqual({ passed: true, data: { eligible: true } });
    expect(await seen()).toEqual([{ host: 'verify.example.com', path: '/check', method: get ? 'GET' : 'POST',
      authenticated: false, customAuthenticated: true, body: get ? '' : '{"answer":"yes"}' }]);
  });
  it.each([301, 302, 303, 307, 308].flatMap(status => [false, true].flatMap(get =>
    ['https://evil.example.com/stolen', 'https://verify.example.com/stolen'].map(target => [status, get, target] as const))))(
    'fails HTTP %s (GET: %s, target: %s) without leaking saved authentication', async (status, get, target) => {
      expect(await (await mf.dispatchFetch(`https://caller.test/redirect?status=${status}&get=${get ? 1 : 0}&target=${encodeURIComponent(target)}`)).json())
        .toEqual({ passed: false, data: { error: 'Webhook redirect refused' } });
      expect(await seen()).toEqual([{ host: 'verify.example.com', path: '/redirect', method: get ? 'GET' : 'POST',
        authenticated: false, customAuthenticated: true, body: get ? '' : '{"answer":"yes"}' }]);
    });
});
