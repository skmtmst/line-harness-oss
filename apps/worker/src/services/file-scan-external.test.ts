import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveExternalScanner, ScanRetryableError, type FileScanConfig } from './file-scan.js';

const config = (overrides: Partial<FileScanConfig> = {}): FileScanConfig => ({
  line_account_id: 'a', external_provider: 'scanner',
  external_endpoint_url: 'https://scan.example.com/check',
  external_secret_ref: 'FILE_SCAN_SECRET_PRIMARY', external_timeout_ms: 1000,
  max_bytes_override: null, max_pixels_override: null, stopped_notified_at: null,
  updated_by: null, updated_at: '2026-10-12', ...overrides,
});
const context = { filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 4 };
afterEach(() => vi.unstubAllGlobals());

async function expectDisabled(row: FileScanConfig, allowedPairs: string | undefined) {
  const reads: string[] = [];
  const env = new Proxy({ FILE_SCAN_ALLOWED_PAIRS: allowedPairs }, {
    get(target, name: string) {
      if (name === 'FILE_SCAN_ALLOWED_PAIRS') return target.FILE_SCAN_ALLOWED_PAIRS;
      reads.push(name);
      return 'test-only-token';
    },
  });
  const fetchMock = vi.fn(async () => Response.json({ verdict: 'clean' }));
  vi.stubGlobal('fetch', fetchMock);
  const scanner = resolveExternalScanner(env, row);
  if (scanner) await scanner.scan(new Uint8Array(4), context);
  expect(reads).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(scanner).toBeNull();
}

describe('S01 external scanner boundary', () => {
  it.each(['ADMIN_API_KEY', 'LINE_CHANNEL_ACCESS_TOKEN', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN',
    'FILE_SCAN_API_KEY', 'FILE_SCAN_SECRET_', 'FILE_SCAN_SECRET_lower', 'FILE_SCAN_SECRET_A-B',
    'FILE_SCAN_SECRET_' + 'A'.repeat(120), '', null])(
    'never reads or sends a legacy non-dedicated secret reference: %s', async (name) => {
      await expectDisabled(config({ external_secret_ref: name }), 'scan.example.com=FILE_SCAN_SECRET_PRIMARY');
    });
  it.each([undefined, '', ' , ', 'other.example.com', '*.example.com', 'https://scan.example.com', 'scan.example.com:443'])(
    'never reads or sends without an exact operator-approved pair: %s', async (allowed) => {
      await expectDisabled(config(), allowed);
    });
  it.each(['http://scan.example.com', 'https://user:password@scan.example.com', 'https://@scan.example.com',
    'https://scan.example.com:8443', 'https://127.0.0.1', 'https://2130706433', 'https://0x7f000001',
    'https://8.8.8.8', 'https://[::1]', 'https://[2606:4700:4700::1111]', 'https://localhost',
    'https://scanner', 'https://scanner.local', 'https://scanner.internal', 'https://scanner.lan',
    'https://scanner.home.arpa', 'https://metadata.google.internal', 'https://metadata.google.com',
    'https://scan.example.com.', 'https:////@scan.example.com', 'https://scan.example.com\\@evil.example.com', 'https://scan.example.com\n/check'])(
    'rejects unsafe destinations even if their host is listed: %s', async (endpoint) => {
      await expectDisabled(config({ external_endpoint_url: endpoint }), new URL(endpoint).hostname + '=FILE_SCAN_SECRET_PRIMARY');
    });
  it('never reads key A for approved host B even when both pairs are allowed', async () => {
    await expectDisabled(config({ external_endpoint_url: 'https://other.example.com/check' }),
      'scan.example.com=FILE_SCAN_SECRET_PRIMARY,other.example.com=FILE_SCAN_SECRET_OTHER');
  });
  it('never reads a well-formed key absent from the allowed pairs', async () => {
    await expectDisabled(config({ external_secret_ref: 'FILE_SCAN_SECRET_UNLISTED' }),
      'scan.example.com=FILE_SCAN_SECRET_PRIMARY');
  });
  it.each([
    'scan.example.com=FILE_SCAN_SECRET_PRIMARY,other.example.com=FILE_SCAN_SECRET_PRIMARY',
    'scan.example.com=FILE_SCAN_SECRET_PRIMARY,SCAN.EXAMPLE.COM=FILE_SCAN_SECRET_OTHER',
    'scan.example.com=FILE_SCAN_SECRET_PRIMARY,scanner.internal=FILE_SCAN_SECRET_PRIMARY',
  ])('never reads a key in conflicting operator assignments: %s', async pairs => {
    await expectDisabled(config(), pairs);
  });
  it('disables both destinations sharing a key while preserving an unrelated pair', async () => {
    const pairs = 'scan.example.com=FILE_SCAN_SECRET_PRIMARY,other.example.com=FILE_SCAN_SECRET_PRIMARY,third.example.com=FILE_SCAN_SECRET_THIRD';
    for (const host of ['scan.example.com', 'other.example.com']) {
      await expectDisabled(config({ external_endpoint_url: `https://${host}/check` }), pairs);
    }
    expect(resolveExternalScanner({ FILE_SCAN_ALLOWED_PAIRS: pairs }, config({ external_endpoint_url: 'https://third.example.com/check', external_secret_ref: 'FILE_SCAN_SECRET_THIRD' }))).not.toBeNull();
  });
  it('disables both keys sharing a host while allowing identical repeated pairs', async () => {
    for (const key of ['FILE_SCAN_SECRET_PRIMARY', 'FILE_SCAN_SECRET_OTHER']) {
      await expectDisabled(config({ external_secret_ref: key }), 'scan.example.com=FILE_SCAN_SECRET_PRIMARY,scan.example.com=FILE_SCAN_SECRET_OTHER');
    }
    expect(resolveExternalScanner({ FILE_SCAN_ALLOWED_PAIRS: 'scan.example.com=FILE_SCAN_SECRET_PRIMARY,SCAN.EXAMPLE.COM=FILE_SCAN_SECRET_PRIMARY' }, config())).not.toBeNull();
  });
  it('ignores the legacy host-only variable without reading it or the key', async () => {
    const reads: string[] = [];
    const env = { FILE_SCAN_ALLOWED_PAIRS: undefined };
    for (const name of ['FILE_SCAN_ALLOWED_HOSTS', 'FILE_SCAN_SECRET_PRIMARY']) {
      Object.defineProperty(env, name, { get() { reads.push(name); return name === 'FILE_SCAN_ALLOWED_HOSTS' ? 'scan.example.com' : 'synthetic-token'; } });
    }
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const scanner = resolveExternalScanner(env, config());
    if (scanner) await scanner.scan(new Uint8Array(4), context);
    expect(scanner).toBeNull();
    expect(reads).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sends a dedicated token to the exact approved HTTPS host with redirects disabled', async () => {
    const token = crypto.randomUUID();
    const env = { FILE_SCAN_ALLOWED_PAIRS: ' other.example.com=FILE_SCAN_SECRET_OTHER, SCAN.EXAMPLE.COM=FILE_SCAN_SECRET_PRIMARY ', FILE_SCAN_SECRET_PRIMARY: token };
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization') === `Bearer ${token}`).toBe(true);
      expect(init?.redirect).toBe('manual');
      return Response.json({ verdict: 'clean' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const scanner = resolveExternalScanner(env, config({ external_endpoint_url: 'https://SCAN.EXAMPLE.COM:443/check' }));
    expect(scanner).not.toBeNull();
    expect(await scanner!.scan(new Uint8Array(4), context)).toBe('clean');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('treats redirects as retryable failures and never requests the redirect target', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push(url);
      // Model fetch following a Location only when the caller permits it.
      if (init.redirect !== 'manual') requests.push('https://evil.example.com/stolen');
      return new Response(null, { status: 302, headers: { location: 'https://evil.example.com/stolen' } });
    }));
    const scanner = resolveExternalScanner({ FILE_SCAN_ALLOWED_PAIRS: 'scan.example.com=FILE_SCAN_SECRET_PRIMARY', FILE_SCAN_SECRET_PRIMARY: 'test-only-token' }, config());
    await expect(scanner!.scan(new Uint8Array(4), context)).rejects.toBeInstanceOf(ScanRetryableError);
    expect(requests).toEqual(['https://scan.example.com/check']);
  });
  it('rejects opaqueredirect even if a fetch adapter reports it as OK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'opaqueredirect', ok: true, status: 200, json: async () => ({ verdict: 'clean' }) })));
    const scanner = resolveExternalScanner({ FILE_SCAN_ALLOWED_PAIRS: 'scan.example.com=FILE_SCAN_SECRET_PRIMARY' }, config());
    await expect(scanner!.scan(new Uint8Array(4), context)).rejects.toBeInstanceOf(ScanRetryableError);
  });
  it('does not expose fetch exception text in a retryable error', async () => {
    const token = crypto.randomUUID();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(token); }));
    const scanner = resolveExternalScanner({ FILE_SCAN_ALLOWED_PAIRS: 'scan.example.com=FILE_SCAN_SECRET_PRIMARY', FILE_SCAN_SECRET_PRIMARY: token }, config());
    try { await scanner!.scan(new Uint8Array(4), context); } catch (error) {
      expect(error).toBeInstanceOf(ScanRetryableError);
      expect(String(error).includes(token)).toBe(false);
    }
  });
});
