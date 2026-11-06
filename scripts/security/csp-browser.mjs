// Built HTML + production headers; synthetic APIs and public resource fixtures only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { spawn } from 'node:child_process';
import { assertEnforcedPolicy, securityHeaders } from './csp-policy.mjs';

const target = process.argv[2];
assert.ok(['web', 'liff'].includes(target));
const root = resolve(`apps/${target}/${target === 'web' ? 'out' : 'dist'}`);
const sourceHeaders = readFileSync(`apps/${target}/public/_headers`, 'utf8');
assert.equal(readFileSync(join(root, '_headers'), 'utf8'), sourceHeaders, 'build must carry the current policy');
const headers = securityHeaders(sourceHeaders);
assertEnforcedPolicy(headers, target);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const policy = { ...headers };
  // Isolated control document only; never promote the application's policy.
  if (url.pathname === '/__enforced-control') {
    // The control uses exactly the production policy.
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
// Use full Chromium's headless mode, which includes the built-in PDF viewer.
const browser = await chromium.launch({ channel: 'chromium' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
const pages = [];
const requests = new Map();
const sdkRequests = [];
// The repository's read-only, synthetic API supplies real authenticated page
// states. Do not count a redirect back to login as an admin page verification.
let mock;
let mockBase;
if (target === 'web') {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  mockBase = `http://127.0.0.1:${port}`;
  mock = spawn(process.execPath, ['scripts/visual-qa/mock-api.mjs'], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore' });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (mock.exitCode !== null) throw new Error('synthetic API exited before ready');
    try { if ((await fetch(`${mockBase}/api/auth/session`)).ok) break; } catch { /* starting */ }
    if (attempt === 99) throw new Error('synthetic API not ready');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
const fontDir = resolve('apps/web/out/_next/static/media');
const font = readFileSync(join(fontDir, readdirSync(fontDir).find(name => name.endsWith('.woff2'))));
// A valid PDF with visible fixture text. No customer document or viewer substitute.
const pdfText = 'BT /F1 18 Tf 18 80 Td (CSP PDF preview) Tj ET\n';
const pdfObjects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${pdfText.length} >>\nstream\n${pdfText}endstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
let pdf = '%PDF-1.7\n';
const offsets = [0];
for (const [index, object] of pdfObjects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
const xref = pdf.length;
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
try {
  const context = await browser.newContext();
  const policyConsole = [];
  context.on('console', message => {
    if (/Content Security Policy/i.test(message.text())) policyConsole.push(message.text().replace(/(?:https?|blob):[^\s"']+/g, value => {
      if (value.startsWith('blob:')) return 'blob:';
      try { return new URL(value).origin; } catch { return '[public-origin]'; }
    }).slice(0, 300));
  });
  await context.addInitScript(() => {
    globalThis.__csp = [];
    document.addEventListener('securitypolicyviolation', e => {
      let resource = e.blockedURI;
      if (/^(blob|data):/.test(resource)) resource = resource.split(':')[0] + ':';
      else try { resource = new URL(resource).origin; } catch { /* inline/eval */ }
      globalThis.__csp.push({ directive: e.effectiveDirective, resource, disposition: e.disposition });
    });
  });
  if (target === 'liff' && process.env.CSP_LIFF_CACHED === '1') await context.addInitScript(() => {
    // Real bundled SDK, synthetic local cache only; no LINE login or token is sent.
    const id = '1000000000-CspTest00';
    const values = { accessToken: 'synthetic-access-token', IDToken: 'synthetic-id-token',
      context: { type: 'utou', userId: 'U-synthetic-csp', viewType: 'full', endpointUrl: `${location.origin}/`, permanentLinkPattern: 'concat', scope: ['profile', 'openid'], availability: {} } };
    for (const [name, value] of Object.entries(values)) localStorage.setItem(`LIFF_STORE:${id}:${name}`, JSON.stringify(value));
    // The SDK's cookie helper matches the literal store name (no URL encoding).
    document.cookie = `LIFF_STORE:expires:${id}=${Date.now() + 86400000};path=/`;
  });
  // Browser-owned PDF resources (chrome://, chrome-untrusted://, extensions,
  // blobs) must use the real built-in viewer. Only HTTP(S) gets fixtures.
  await context.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'https://api.line.me') sdkRequests.push({ method: route.request().method(), path: url.pathname });
    const category = `${url.origin === base ? 'self' : url.origin} ${route.request().resourceType()}`;
    requests.set(category, (requests.get(category) ?? 0) + 1);
    if (['blob:', 'data:', 'chrome-extension:', 'about:'].includes(url.protocol)) return route.continue();
    if (url.pathname.startsWith('/api/')) {
      if (target === 'liff') {
        const fixtures = {
          '/api/liff/customer-look': { success: true, data: { settings: {}, version: 1 } },
          '/api/liff/config': { success: true, data: { accountName: '架空の店', accountId: 'csp-account', botBasicId: '@fixture' } },
          '/api/liff/booking/menus': { menus: [{ id: 'csp-menu', name: '架空メニュー', category_label: '見本', description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 0, price_mode: 'free', payment_mode: 'none', sort_order: 0 }] },
          '/api/liff/booking/settings': { liff_date_view: 'list', booking_window_days: 60, approval_mode: 'manual' },
          '/api/liff/booking/me': { upcoming: [], past: [] },
          '/api/liff/booking/last-booking': { available: false },
        };
        return route.fulfill({ status: fixtures[url.pathname] ? 200 : 404, json: fixtures[url.pathname] ?? { success: false, code: 'synthetic_not_found' } });
      }
      if (!mockBase) return route.fulfill({ json: { success: false, code: 'synthetic_no_session' }, status: 401 });
      const fixture = await fetch(`${mockBase}${url.pathname}${url.search}`);
      return route.fulfill({ status: fixture.status, contentType: fixture.headers.get('content-type') ?? 'application/json', body: Buffer.from(await fixture.arrayBuffer()), headers: { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true' } });
    }
    if (url.origin === base) return route.continue();
    const sdkHeaders = { 'access-control-allow-origin': base, 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-credentials': 'true' };
    if (url.origin === 'https://api.line.me' && url.pathname === '/oauth2/v2.1/verify') return route.fulfill({ headers: sdkHeaders, json: { scope: 'profile openid', client_id: '1000000000', expires_in: 3600 } });
    if (url.origin === 'https://api.line.me' && url.pathname === '/v2/profile') return route.fulfill({ headers: sdkHeaders, json: { userId: 'U-synthetic-csp', displayName: '架空の利用者' } });
    // No external account, login, token, customer data or CSP report is sent.
    const kind = route.request().resourceType();
    if (kind === 'script') return route.fulfill({ contentType: 'text/javascript', body: 'globalThis.__publicScriptProbe=(globalThis.__publicScriptProbe||0)+1;' });
    if (kind === 'stylesheet') return route.fulfill({ contentType: 'text/css', body: '/* synthetic public font stylesheet */' });
    if (kind === 'font') return route.fulfill({ contentType: 'font/woff2', body: font, headers: { 'access-control-allow-origin': '*' } });
    if (kind === 'image') return route.fulfill({ contentType: 'image/png', body: png });
    if (kind === 'document') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Public frame fixture</title>' });
    return route.fulfill({ contentType: 'application/json', body: '{}', headers: { 'access-control-allow-origin': '*' } });
  });
  const paths = target === 'web' ? ['/login', '/login/two-factor', '/register', '/password/forgot', '/', '/friends', '/chats', '/ops/dashboard'] : ['/', '/booking/history', '/events/fixture-event', '/forms/fixture-form', '/affiliate', '/webinar/fixture-webinar'];
  for (const path of paths) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.name));
    const response = await page.goto(`${base}${path}${target === 'liff' && process.env.CSP_LIFF_CACHED === '1' ? '?liffId=1000000000-CspTest00' : ''}`);
    assert.equal(response.status(), 200, path);
    assert.equal(response.headers()['content-security-policy'], headers['content-security-policy']);
    if (path === '/login') {
      await page.getByRole('button', { name: 'パスワードを表示する' }).click();
      await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
    } else if (target === 'liff' && process.env.CSP_LIFF_CACHED !== '1') {
      // Normal bundle including the real LIFF SDK; deliberately no real login.
      await expect(page.getByText('開けませんでした', { exact: true })).toBeVisible();
    }
    await page.waitForTimeout(500);
    if (target === 'liff' && process.env.CSP_LIFF_CACHED === '1') {
      const sdkState = await page.evaluate(async () => {
        const state = { loggedIn: window.liff?.isLoggedIn(), scope: window.liff?.getContext()?.scope, idTokenPresent: !!window.liff?.getIDToken() };
        try {
          const profile = await Promise.race([window.liff.getProfile(), new Promise((_, reject) => setTimeout(() => reject(new Error('fixture_profile_timeout')), 3000))]);
          state.profileUserPresent = !!profile?.userId;
        } catch (error) { state.profileError = { name: error.name, code: error.code, message: String(error.message).replace(/https?:\/\/\S+/g, '[public-origin]').slice(0, 160) }; }
        return state;
      });
      writeFileSync('/tmp/lh-b351-liff-runtime-diagnostic.json', JSON.stringify({ path, sdkState, sdkRequests, errors }, null, 2));
      await expect(page.locator('#root')).not.toBeEmpty();
      if (await page.getByText('開けませんでした', { exact: true }).count()) {
        const diagnostic = await page.evaluate(async () => {
          const state = { loggedIn: window.liff?.isLoggedIn(), contextPresent: !!window.liff?.getContext(), cookieNames: document.cookie.split(';').map(v => v.trim().split('=')[0]) };
          try { await Promise.race([window.liff.init({ liffId: '1000000000-CspTest00' }), new Promise((_, reject) => setTimeout(() => reject(new Error('fixture_init_timeout')), 3000))]); }
          catch (error) { state.initError = { name: error.name, code: error.code, message: String(error.message).replace(/https?:\/\/\S+/g, '[public-origin]').slice(0, 200) }; }
          return state;
        });
        writeFileSync('/tmp/lh-b351-liff-init-diagnostic.json', JSON.stringify(diagnostic, null, 2));
      }
      await expect(page.getByText('開けませんでした', { exact: true })).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.liff?.isLoggedIn()), true, 'real SDK must initialize with the synthetic cache');
    }
    if (target === 'web') assert.equal(new URL(page.url()).pathname, path === '/' ? '/hq' : path, 'must reach the requested page (HQ dashboard is the owner default)');
    assert.equal(errors.length, 0, `runtime error at ${path}`);
    const violations = await page.evaluate(() => globalThis.__csp);
    pages.push({ path, finalPath: new URL(page.url()).pathname, violations });
    assert.equal(violations.length, 0, `CSP stopped an application resource: ${path}`);
    await page.close();
  }
  const page = await context.newPage();
  await page.goto(`${base}${target === 'web' ? '/login' : '/'}`);
  // Separate application boot findings from resource allowlist probes.
  await page.evaluate(() => { globalThis.__csp = []; });
  policyConsole.length = 0;
  const probes = await page.evaluate(async ({ target, pdf }) => {
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
      const preview = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
      results.blobFrame = await new Promise(resolve => {
        const frame = document.createElement('iframe'); frame.width = '600'; frame.height = '400'; frame.src = `${preview}#toolbar=0&view=FitH`;
        let poll;
        const finish = value => {
          try { results.pdfDocument = { contentType: frame.contentDocument?.contentType, pdfEmbed: !!frame.contentDocument?.querySelector('embed[type="application/pdf"]') }; }
          catch { results.pdfDocument = { inaccessible: true }; }
          clearInterval(poll); clearTimeout(deadline); resolve(value);
        };
        const deadline = setTimeout(() => finish(false), 10000);
        const check = () => {
          try { if (frame.contentDocument?.contentType === 'application/pdf' && frame.contentDocument.readyState === 'complete') finish(true); } catch { /* still committing */ }
        };
        frame.onload = check; frame.onerror = () => finish(false); document.body.append(frame);
        poll = setInterval(check, 50);
      });
      // The built-in viewer reads the blob asynchronously after document commit.
      // Keep it alive until this isolated context closes.
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
  }, { target, pdf });
  await page.waitForTimeout(100);
  const probeViolations = await page.evaluate(() => globalThis.__csp);
  writeFileSync(process.env.CSP_REPORT_PATH ?? `/tmp/lh-b351-csp-${target}.json`, JSON.stringify({ target, pages, probes, probeViolations, policyConsole }, null, 2));
  if (target === 'web') {
    const frame = page.locator('iframe').last();
    await expect.poll(async () => {
      const bytes = await frame.screenshot({ timeout: 5000 });
      const png = PNG.sync.read(bytes);
      let paper = 0, ink = 0;
      for (let y = 40; y < Math.min(260, png.height); y++) for (let x = 20; x < Math.min(560, png.width); x++) {
        const i = (y * png.width + x) * 4;
        if (png.data[i] > 240 && png.data[i + 1] > 240 && png.data[i + 2] > 240) paper++;
        if (png.data[i] < 50 && png.data[i + 1] < 50 && png.data[i + 2] < 50) ink++;
      }
      return paper > 10000 && ink > 50;
    }, { timeout: 15000, message: 'the actual PDF must paint paper and fixture text, beyond committing its MIME type' }).toBe(true);
    probes.pdfPaint = true;
    await frame.screenshot({ path: '/tmp/lh-b351-pdf-preview.png' });
  }
  assert.equal(probes.inlineRan, false, 'unhashed inline script must be blocked');
  const failed = Object.entries(probes).filter(([name, ok]) => name !== 'inlineRan' && !ok).map(([name]) => name);
  assert.deepEqual(failed, [], `allowed resource failures: ${failed.join(', ')}`);
  assert.ok(!policyConsole.some(text => /object-src|frame-src|frame-ancestors/.test(text)), 'PDF and allowed frames must not be blocked in child documents');
  assert.ok(probeViolations.some(v => v.directive === 'script-src-elem' && v.resource === 'inline' && v.disposition === 'enforce'));
  assert.ok(!probeViolations.some(v => v.resource.startsWith('https:')), 'allowlisted HTTPS resources must not generate violations');
  // Unlisted scripts must be blocked by the application's real response header.
  await page.evaluate(() => new Promise(resolve => {
    const script = document.createElement('script'); script.src = 'https://unlisted.csp-fixture.invalid/control.js';
    script.onload = () => resolve(true); script.onerror = () => resolve(false); document.head.append(script);
  }));
  await expect.poll(() => page.evaluate(() => globalThis.__csp.some(v => v.resource === 'https://unlisted.csp-fixture.invalid' && v.disposition === 'enforce'))).toBe(true);
  await page.goto(`${base}/__enforced-control`);
  await page.evaluate(() => {
    const script = document.createElement('script'); script.textContent = 'globalThis.__blockedControl=true'; document.head.append(script);
  });
  await expect.poll(() => page.evaluate(() => globalThis.__csp.some(v => v.disposition === 'enforce'))).toBe(true);
  assert.equal(await page.evaluate(() => globalThis.__blockedControl), undefined);
  const result = { target, mode: 'production-enforced', externalResources: 'synthetic fixtures; no external login', requests: Object.fromEntries(requests), pages, probes, probeViolations, policyConsole, unlistedControl: 'blocked', enforceControl: 'blocked' };
  writeFileSync(process.env.CSP_REPORT_PATH ?? `/tmp/lh-b351-csp-${target}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ target, pages: pages.length, probes: 'passed', enforceControl: 'blocked', actualViolations: pages.map(p => ({ path: p.path, count: p.violations.length })) }));
} finally {
  mock?.kill();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
