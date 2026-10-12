import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Miniflare } from 'miniflare';
import { redirectWorker } from '../test-utils/workerd-redirect.js';

let mf: Miniflare;
beforeAll(async () => {
  mf = await redirectWorker(`
    import { resolveExternalScanner, ScanRetryableError } from './services/file-scan.ts';
    export default { async fetch(request) {
      const url = new URL(request.url);
      const scanner = resolveExternalScanner({ FILE_SCAN_ALLOWED_HOSTS: 'scan.example.com', FILE_SCAN_SECRET_PRIMARY: 'synthetic-scan-token' }, {
        external_provider: 'scanner', external_endpoint_url: 'https://scan.example.com' + url.pathname + url.search,
        external_secret_ref: 'FILE_SCAN_SECRET_PRIMARY', external_timeout_ms: 1000
      });
      try { return Response.json({ verdict: await scanner.scan(new TextEncoder().encode('file'), { filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 4 }) }); }
      catch (err) { return Response.json({ retryable: err instanceof ScanRetryableError }); }
    } }
  `);
});
afterAll(async () => { await mf?.dispose(); });
beforeEach(async () => { await (await mf.getWorker('destination')).fetch('https://fixture.test/reset'); });
async function seen() { return (await (await mf.getWorker('destination')).fetch('https://fixture.test/seen')).json(); }

describe('S01 actual workerd fetch', () => {
  it('delivers the file and dedicated authorization to the approved HTTPS destination', async () => {
    expect(await (await mf.dispatchFetch('https://caller.test/check')).json()).toEqual({ verdict: 'clean' });
    expect(await seen()).toEqual([{ host: 'scan.example.com', path: '/check', method: 'POST', authenticated: true, customAuthenticated: false, body: 'file' }]);
  });
  it.each([301, 302, 303, 307, 308])('fails HTTP %s without requesting the second destination', async (status) => {
    expect(await (await mf.dispatchFetch(`https://caller.test/redirect?status=${status}`)).json()).toEqual({ retryable: true });
    expect(await seen()).toEqual([{ host: 'scan.example.com', path: '/redirect', method: 'POST', authenticated: true, customAuthenticated: false, body: 'file' }]);
  });
});
