import { readFileSync } from 'node:fs';
import { headerRules } from './artifacts.js';
import { result } from './common.js';

export type ResponseKind = 'admin' | 'admin-static' | 'admin-json' | 'admin-error' | 'worker-html' | 'worker-static' | 'json' | 'error';
export function assertResponse(response: Response, kind: ResponseKind, expectedStatus: number, source?: string): void {
  if (response.status !== expectedStatus) throw new Error('response_status');
  const type = response.headers.get('content-type') ?? '';
  if (kind === 'admin' || kind === 'admin-error' || kind === 'worker-html') {
    if (!type.includes('text/html')) throw new Error('response_type');
  } else if (kind === 'admin-json') {
    if (!type.includes('application/json')) throw new Error('response_type');
  } else if (kind === 'json' || kind === 'error') {
    if (!type.includes('application/json') || !response.headers.get('x-request-id') || !/noindex/.test(response.headers.get('x-robots-tag') ?? '')) throw new Error('json_headers');
    if (kind === 'error' && !/\bno-store\b/.test(response.headers.get('cache-control') ?? '')) throw new Error('error_cache');
    // HTML-only CSP is deliberately not required on JSON/errors.
    return;
  } else if (!/(?:javascript|css|image\/)/.test(type)) throw new Error('asset_type');
  if (!source) throw new Error('header_source');
  for (const [name, expected] of headerRules(source)) if (response.headers.get(name) !== expected) throw new Error('response_headers');
  if (!kind.startsWith('admin') && response.headers.has('x-frame-options')) throw new Error('liff_frame_blocked');
}
export async function verifyResponses(target: 'worker' | 'admin', fetcher: typeof fetch = fetch): Promise<void> {
  const workerRules = readFileSync('apps/worker/public/_headers', 'utf8');
  const adminRules = readFileSync('apps/web/public/_headers', 'utf8');
  const checks: Array<{ label: string; url: string; kind: ResponseKind; status: number; source?: string; bot?: boolean }> = target === 'worker' ? [
    { label: 'worker_static_html', url: 'https://api.musubo.jp/', kind: 'worker-html', status: 200, source: workerRules },
    { label: 'worker_generated_html', url: 'https://api.musubo.jp/', kind: 'worker-html', status: 200, source: workerRules, bot: true },
    { label: 'worker_static_asset', url: 'https://api.musubo.jp/icon.svg', kind: 'worker-static', status: 200, source: workerRules },
    { label: 'worker_json', url: 'https://api.musubo.jp/api/health', kind: 'json', status: 200 },
    { label: 'worker_error_401', url: 'https://api.musubo.jp/api/accounts', kind: 'error', status: 401 },
    { label: 'worker_error_404', url: 'https://api.musubo.jp/api/auth/register/__release_missing__', kind: 'error', status: 404 },
  ] : [
    { label: 'admin_html', url: 'https://admin.musubo.jp/login', kind: 'admin', status: 200, source: adminRules },
    { label: 'admin_json', url: 'https://admin.musubo.jp/version.json', kind: 'admin-json', status: 200, source: adminRules },
    { label: 'admin_error_404', url: 'https://admin.musubo.jp/__release_missing__', kind: 'admin-error', status: 404, source: adminRules },
  ];
  if (target === 'admin') {
    const html = readFileSync('apps/web/out/login.html', 'utf8');
    const asset = html.match(/<script\b[^>]*\bsrc="(\/[^"]+\.js(?:\?[^"]*)?)"/i)?.[1];
    if (!asset || asset.startsWith('//')) throw new Error('admin_asset');
    checks.push({ label: 'admin_static_asset', url: new URL(asset, 'https://admin.musubo.jp').href, kind: 'admin-static', status: 200, source: adminRules });
  }
  for (const check of checks) {
    try {
      const response = await fetcher(check.url, { method: 'GET', headers: { Accept: check.kind === 'error' || check.kind === 'json' ? 'application/json' : '*/*', ...(check.bot ? { 'User-Agent': 'facebookexternalhit/1.1' } : {}) }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      assertResponse(response, check.kind, check.status, check.source);
      await response.body?.cancel();
      result(check.label, true);
    } catch {
      result(check.label, false);
      throw new Error('public_response');
    }
  }
}
