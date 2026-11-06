import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { join, resolve } from 'node:path';
import { unstable_readConfig } from 'wrangler';
import { assertSha, cloudflare, command, requireValue } from './common.js';

export function headerRules(source: string): Map<string, string> {
  const rules = new Map<string, string>();
  let global = false;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { global = line === '/*'; continue; }
    const match = line.match(/^\s+([^:]+):\s*(.+)$/);
    if (global && match) rules.set(match[1].toLowerCase(), match[2]);
  }
  return rules;
}
export function assertHeaderRules(source: string, actual: string, kind: 'admin' | 'worker'): void {
  const wanted = headerRules(source), found = headerRules(actual);
  const required = ['x-content-type-options', 'referrer-policy', 'permissions-policy', 'content-security-policy', 'x-robots-tag', kind === 'admin' ? 'x-frame-options' : 'content-security-policy-report-only'];
  for (const name of required) if (!wanted.get(name) || wanted.get(name) !== found.get(name)) throw new Error('headers_missing_or_changed');
  const csp = wanted.get('content-security-policy')!;
  if (!csp.includes("object-src 'none'") || (kind === 'admin' ? !csp.includes("frame-ancestors 'none'") || wanted.get('x-frame-options') !== 'DENY' : !csp.includes('https://*.line.me') || found.has('x-frame-options'))) throw new Error('headers_policy');
}
export function verifyHeaders(kind: 'admin' | 'worker'): void {
  const source = kind === 'admin' ? 'apps/web/public/_headers' : 'apps/worker/public/_headers';
  const built = kind === 'admin' ? 'apps/web/out/_headers' : 'apps/worker/dist/client/_headers';
  assertHeaderRules(readFileSync(source, 'utf8'), readFileSync(built, 'utf8'), kind);
  if (kind === 'admin') {
    // Every exported page must reference its same-origin external bootstrap.
    const root = resolve('apps/web/out');
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '_next') walk(path); continue; }
        if (entry.name.endsWith('.html')) assertBootstrap(readFileSync(path, 'utf8'), file => {
          const target = resolve(root, `.${file.split('?')[0]}`);
          return target.startsWith(`${root}/`) && existsSync(target);
        });
      }
    };
    if (!existsSync(join(root, 'login.html'))) throw new Error('login_html_missing');
    walk(root);
  }
}
export function assertReleaseInputs(): void {
  const source = unstable_readConfig({ config: 'apps/worker/wrangler.toml' });
  if (requireValue(process.env.SECURITY_WORKER_NAME) !== source.name) throw new Error('production_identity');
  if (requireValue(process.env.PAGES_PROJECT_NAME) !== source.vars.ADMIN_PAGES_PROJECT) throw new Error('pages_project');
  requireValue(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}
export function prepareAdmin(): void {
  assertReleaseInputs();
  verifyHeaders('admin');
}
export function assertBootstrap(html: string, exists: (file: string) => boolean): void {
  for (const tag of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = tag[1], code = tag[2];
    const src = attrs.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (src) {
      if (src.startsWith('/') && !src.startsWith('//') && !exists(src)) throw new Error('bootstrap_missing');
      continue;
    }
    const type = attrs.match(/\btype=["']([^"']+)["']/i)?.[1];
    if (code.trim() && type !== 'application/json' && type !== 'application/ld+json') throw new Error('inline_bootstrap');
  }
}
const bindingMap = (bindings: any[], key: string) => bindings.map(item => [item.binding, item[key]]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
export function assertWorkerConfig(source: any, built: any): void {
  for (const key of ['name', 'workers_dev', 'preview_urls', 'routes']) {
    // Wrangler's default preview_urls follows workers_dev when absent in TOML.
    const expected = key === 'preview_urls' ? source.preview_urls ?? source.workers_dev : source[key];
    const actual = key === 'preview_urls' ? built.preview_urls ?? built.workers_dev : built[key];
    if (expected === undefined || !isDeepStrictEqual(actual, expected)) throw new Error('worker_route_drift');
  }
  for (const key of ['nodejs_compat', 'global_fetch_strictly_public']) if (!built.compatibility_flags?.includes(key)) throw new Error('compatibility_flag');
  for (const [collection, key] of [['d1_databases', 'database_name'], ['d1_databases', 'database_id'], ['r2_buckets', 'bucket_name']]) {
    if (!source[collection]?.length || JSON.stringify(bindingMap(source[collection], key)) !== JSON.stringify(bindingMap(built[collection] ?? [], key))) throw new Error('binding_drift');
  }
}
export function workerArtifactPath(name: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) throw new Error('worker_name');
  return `apps/worker/dist/${name.replaceAll('-', '_')}/wrangler.json`;
}
export function prepareWorker(sha: string): void {
  assertSha(sha);
  const source = unstable_readConfig({ config: 'apps/worker/wrangler.toml' });
  const path = workerArtifactPath(source.name);
  const built = JSON.parse(readFileSync(path, 'utf8'));
  assertWorkerConfig(source, built); // Reject drift before changing anything.
  if (source.d1_databases?.[0]?.database_name !== requireValue(process.env.D1_DATABASE_NAME) || source.d1_databases?.[0]?.database_id !== requireValue(process.env.D1_DATABASE_ID) || source.account_id !== requireValue(process.env.CLOUDFLARE_ACCOUNT_ID) || source.name !== requireValue(process.env.SECURITY_WORKER_NAME)) throw new Error('production_identity');
  built.vars = { ...built.vars, ADMIN_ORIGIN: 'https://admin.musubo.jp', ADMIN_ALLOW_CROSS_SITE: 'false', WORKER_URL: 'https://api.musubo.jp', BUILD_GIT_COMMIT: sha, BUILD_VERSION: JSON.parse(readFileSync('package.json', 'utf8')).version, BUILD_RELEASED_AT: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(built));
  assertWorkerConfig(source, JSON.parse(readFileSync(path, 'utf8')));
  requireValue(process.env.GITHUB_ENV);
  // Only an internally derived relative path, never configuration values.
  command('node', ['-e', 'require("fs").appendFileSync(process.env.GITHUB_ENV, "WORKER_DEPLOY_CONFIG="+process.argv[1]+"\\n")', path.replace('apps/worker/', '')]);
}
export async function verifyPages(sha: string): Promise<void> {
  assertSha(sha);
  const project = requireValue(process.env.PAGES_PROJECT_NAME);
  const source = unstable_readConfig({ config: 'apps/worker/wrangler.toml' });
  if (project !== source.vars.ADMIN_PAGES_PROJECT) throw new Error('pages_project');
  for (let attempt = 0; attempt < 15; attempt++) {
    const metadata = await cloudflare(`pages/projects/${encodeURIComponent(project)}`);
    const canonical = metadata.canonical_deployment;
    if (canonical?.environment === 'production' && canonical?.deployment_trigger?.metadata?.commit_hash === sha && canonical?.deployment_trigger?.metadata?.branch === 'main') return;
    if (attempt < 14) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('pages_canonical_sha');
}
