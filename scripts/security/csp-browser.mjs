// Built HTML + production headers; synthetic APIs and public resource fixtures only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { assertReportingPolicy, securityHeaders } from './csp-policy.mjs';

const target = process.argv[2];
assert.ok(['web', 'liff'].includes(target));
const root = resolve(`apps/${target}/${target === 'web' ? 'out' : 'dist'}`);
const sourceHeaders = readFileSync(`apps/${target}/public/_headers`, 'utf8');
assert.equal(readFileSync(join(root, '_headers'), 'utf8'), sourceHeaders, 'build must carry the current policy');
const headers = securityHeaders(sourceHeaders);
assertReportingPolicy(headers, target);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const policy = { ...headers };
  // Isolated control document only; never promote the application's policy.
  if (url.pathname === '/__enforced-control') {
    policy['content-security-policy'] = policy['content-security-policy-report-only'];
    res.writeHead(200, { ...policy, 'content-type': 'text/html' });
    return res.end('<!doctype html><title>CSP control</title>');
  }
  const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  for (const suffix of ['', '.html', '/index.html']) {
    const file = resolve(root, `.${pathname}${suffix}`);
    if (file.startsWith(`${root}/`) && existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { ...policy, 'content-type': types[extname(file)] ?? 'application/octet-stream' });
      return res.end(readFileSync(file));
    }
  }
  if (target === 'liff') {
    res.writeHead(200, { ...policy, 'content-type': 'text/html' });
    return res.end(readFileSync(join(root, 'index.html')));
  }
  res.writeHead(404); res.end();
});
await new Promise(accept => server.listen(0, '127.0.0.1', accept));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
const pages = [];
const requests = new Map();
const fontDir = resolve('apps/web/out/_next/static/media');
const font = readFileSync(join(fontDir, readdirSync(fontDir).find(name => name.endsWith('.woff2'))));
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    globalThis.__csp = [];
    document.addEventListener('securitypolicyviolation', e => {
      let resource = e.blockedURI;
      if (/^(blob|data):/.test(resource)) resource = resource.split(':')[0] + ':';
      else try { resource = new URL(resource).origin; } catch { /* inline/eval */ }
      globalThis.__csp.push({ directive: e.effectiveDirective, resource, disposition: e.disposition });
    });
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const category = `${url.origin === base ? 'self' : url.origin} ${route.request().resourceType()}`;
    requests.set(category, (requests.get(category) ?? 0) + 1);
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success: false, code: 'synthetic_no_session' }, status: 401 });
    if (url.origin === base) return route.continue();
    // No external account, login, token, customer data or CSP report is sent.
    const kind = route.request().resourceType();
    if (kind === 'script') return route.fulfill({ contentType: 'text/javascript', body: 'globalThis.__publicScriptProbe=(globalThis.__publicScriptProbe||0)+1;' });
    if (kind === 'stylesheet') return route.fulfill({ contentType: 'text/css', body: '/* synthetic public font stylesheet */' });
    if (kind === 'font') return route.fulfill({ contentType: 'font/woff2', body: font, headers: { 'access-control-allow-origin': '*' } });
    if (kind === 'image') return route.fulfill({ contentType: 'image/png', body: png });
    if (kind === 'document') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Public frame fixture</title>' });
    return route.fulfill({ contentType: 'application/json', body: '{}', headers: { 'access-control-allow-origin': '*' } });
  });
  const paths = target === 'web' ? ['/login', '/login/two-factor', '/register', '/password/forgot'] : ['/'];
  for (const path of paths) {
    const page = await context.newPage();
    const response = await page.goto(`${base}${path}`);
    assert.equal(response.status(), 200, path);
    assert.equal(response.headers()['content-security-policy-report-only'], headers['content-security-policy-report-only']);
    if (path === '/login') {
      await page.getByRole('button', { name: 'パスワードを表示する' }).click();
      await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
    } else if (target === 'liff') {
      // Normal bundle including the real LIFF SDK; deliberately no real login.
      await expect(page.getByText('開けませんでした', { exact: true })).toBeVisible();
    }
    await page.waitForTimeout(100);
    pages.push({ path, violations: await page.evaluate(() => globalThis.__csp) });
    await page.close();
  }
  const page = await context.newPage();
  await page.goto(`${base}${target === 'web' ? '/login' : '/'}`);
  // Separate application boot findings from resource allowlist probes.
  await page.evaluate(() => { globalThis.__csp = []; });
  const probes = await page.evaluate(async ({ target }) => {
    const results = {};
    const scripts = ['https://static.line-scdn.net/liff/edge/2/sdk.js'];
    if (target === 'web') scripts.push('https://challenges.cloudflare.com/turnstile/v0/api.js');
    for (const src of scripts) results[new URL(src).hostname] = await new Promise(resolve => {
      const el = document.createElement('script'); el.src = src;
      el.onload = () => resolve(true); el.onerror = () => resolve(false); document.head.append(el);
    });
    results.httpsImage = await new Promise(resolve => {
      const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false);
      image.src = 'https://stickershop.line-scdn.net/csp-fixture.png'; document.body.append(image);
    });
    results.httpsApi = await fetch('https://api.csp-fixture.invalid/probe', { credentials: 'omit' }).then(r => r.ok, () => false);
    results.fontCss = await new Promise(resolve => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://fonts.googleapis.com/css2?family=Inter';
      link.onload = () => resolve(true); link.onerror = () => resolve(false); document.head.append(link);
    });
    results.fontFile = await new FontFace('CspProbe', 'url(https://fonts.gstatic.com/synthetic.woff2)').load().then(() => true, () => false);
    results.lineFrame = await new Promise(resolve => {
      const frame = document.createElement('iframe'); frame.src = 'https://access.line.me/csp-fixture';
      frame.onload = () => resolve(true); frame.onerror = () => resolve(false); document.body.append(frame);
    });
    if (target === 'web') results.turnstileFrame = await new Promise(resolve => {
      const frame = document.createElement('iframe'); frame.src = 'https://challenges.cloudflare.com/csp-fixture';
      frame.onload = () => resolve(true); frame.onerror = () => resolve(false); document.body.append(frame);
    });
    if (target === 'web') {
      // FormFileAttachments uses a blob iframe for authenticated PDF previews.
      const preview = URL.createObjectURL(new Blob(['<!doctype html><title>Preview fixture</title>'], { type: 'text/html' }));
      results.blobFrame = await new Promise(resolve => {
        const frame = document.createElement('iframe'); frame.src = preview;
        frame.onload = () => resolve(true); frame.onerror = () => resolve(false); document.body.append(frame);
        setTimeout(() => resolve(false), 2000);
      });
      URL.revokeObjectURL(preview);
    }
    results.inlineRan = false;
    const inline = document.createElement('script'); inline.textContent = 'globalThis.__inlineProbe=true'; document.head.append(inline);
    results.inlineRan = globalThis.__inlineProbe === true;
    const workerUrl = URL.createObjectURL(new Blob(['postMessage("ok")'], { type: 'text/javascript' }));
    results.blobWorker = await new Promise(resolve => {
      try { const w = new Worker(workerUrl); w.onmessage = () => { w.terminate(); resolve(true); }; w.onerror = () => resolve(false); }
      catch { resolve(false); }
      setTimeout(() => resolve(false), 2000);
    });
    URL.revokeObjectURL(workerUrl);
    return results;
  }, { target });
  assert.ok(Object.values(probes).every(Boolean), 'report-only resource probes must continue');
  await page.waitForTimeout(100);
  const probeViolations = await page.evaluate(() => globalThis.__csp);
  assert.ok(probeViolations.some(v => v.directive === 'script-src-elem' && v.resource === 'inline' && v.disposition === 'report'));
  assert.ok(!probeViolations.some(v => v.resource.startsWith('https:')), 'allowlisted HTTPS resources must not generate violations');
  // A deliberately unlisted script must run under Report-Only AND be reported.
  await page.evaluate(() => new Promise(resolve => {
    const script = document.createElement('script'); script.src = 'https://unlisted.csp-fixture.invalid/control.js';
    script.onload = resolve; document.head.append(script);
  }));
  await expect.poll(() => page.evaluate(() => globalThis.__csp.some(v => v.resource === 'https://unlisted.csp-fixture.invalid' && v.disposition === 'report'))).toBe(true);
  await page.goto(`${base}/__enforced-control`);
  await page.evaluate(() => {
    const script = document.createElement('script'); script.textContent = 'globalThis.__blockedControl=true'; document.head.append(script);
  });
  await expect.poll(() => page.evaluate(() => globalThis.__csp.some(v => v.disposition === 'enforce'))).toBe(true);
  assert.equal(await page.evaluate(() => globalThis.__blockedControl), undefined);
  const result = { target, mode: 'production-report-only', externalResources: 'synthetic fixtures; no external login', requests: Object.fromEntries(requests), pages, probes, probeViolations, unlistedControl: 'reported', enforceControl: 'blocked' };
  writeFileSync(process.env.CSP_REPORT_PATH ?? `/tmp/lh-b351-csp-${target}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ target, pages: pages.length, probes: 'passed', enforceControl: 'blocked', actualViolations: pages.map(p => ({ path: p.path, count: p.violations.length })) }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
