import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyResponses } from './responses.js';
import { headerRules } from './artifacts.js';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const rules = Object.fromEntries(headerRules(readFileSync('apps/worker/public/_headers', 'utf8')));
function probe(missing = '') {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.musubo.jp');
    expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('error');
    expect(init?.headers).not.toHaveProperty('Authorization'); expect(init?.headers).not.toHaveProperty('Cookie');
    let status = 200, type = url.pathname === '/icon.svg' ? 'image/svg+xml' : url.pathname === '/' ? 'text/html' : 'application/json';
    if (url.pathname === '/api/accounts') status = 401;
    if (url.pathname.endsWith('__release_missing__')) status = 404;
    const headers = new Headers({ ...rules, 'Content-Type': type, 'X-Request-ID': 'synthetic-request', ...(status >= 400 ? { 'Cache-Control': 'no-store' } : {}) });
    if (missing) headers.delete(missing);
    return new Response('synthetic private body', { status, headers });
  });
}
describe('post-deploy probe is read-only and logs only pass/fail', () => {
  it('covers generated/static HTML, static asset, JSON, unauthenticated and missing responses', async () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {}), fetcher = probe();
    await verifyResponses('worker', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(log.mock.calls).toHaveLength(6);
    expect(log.mock.calls.every(([line]) => /^worker_[a-z_0-9]+: PASS$/.test(line))).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|synthetic|Cookie/);
  });
  it.each(['Content-Security-Policy', 'Content-Security-Policy-Report-Only', 'X-Content-Type-Options', 'Permissions-Policy'])('stops on absent %s and never prints provider body', async missing => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(verifyResponses('worker', probe(missing))).rejects.toThrow('public_response');
    expect(log.mock.calls).toEqual([['worker_static_html: FAIL']]);
  });
});
