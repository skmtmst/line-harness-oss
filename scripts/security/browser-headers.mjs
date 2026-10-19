// Local builds and synthetic API responses only. Public SDK/font CDNs are the only external resources.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { assertEnforcedPolicy } from './csp-policy.mjs';

const target = process.argv[2] ?? 'web';
assert.ok(['web', 'worker'].includes(target));
const root = resolve(target === 'web' ? 'apps/web/out' : 'apps/worker/dist/client');
assert.ok(existsSync(join(root, '_headers')), 'build must include its security headers');
const headers = {};
for (const line of readFileSync(join(root, '_headers'), 'utf8').split('\n')) {
  if (!/^\s+[^#]/.test(line)) continue;
  const delimiter = line.indexOf(':');
  if (delimiter > 0) headers[line.slice(0, delimiter).trim().toLowerCase()] = line.slice(delimiter + 1).trim();
}
assert.equal(headers['x-content-type-options'], 'nosniff');
assert.equal(headers['referrer-policy'], 'no-referrer');
assert.ok(headers['content-security-policy'].includes('frame-ancestors'));
if (target === 'web') assertEnforcedPolicy(headers, 'web');
else assert.ok(headers['content-security-policy-report-only'].includes('script-src'));

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=', 'base64');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function server(strict = false) {
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const policy = { ...headers };
    if (strict && policy['content-security-policy-report-only']) policy['content-security-policy'] = policy['content-security-policy-report-only'];
    if (url.pathname === '/__mime-probe.js') {
      res.writeHead(200, { ...policy, 'content-type': 'text/plain' }); return res.end('window.__badMimeExecuted=true');
    }
    if (url.pathname === '/__image-probe.png') { res.writeHead(200, { ...policy, 'content-type': 'image/png' }); return res.end(png); }
    if (url.pathname === '/__frame-parent') {
      res.writeHead(200, { ...policy, 'content-type': 'text/html' });
      return res.end('<!doctype html><iframe id="liff-frame" src="/booking?liffId=synthetic&waitlist=w"></iframe>');
    }
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index' : url.pathname);
    for (const name of [pathname, `${pathname}.html`, `${pathname}/index.html`]) {
      const path = resolve(root, `.${name}`);
      if (path.startsWith(`${root}/`) && existsSync(path) && statSync(path).isFile()) {
        res.writeHead(200, { ...policy, 'content-type': types[extname(path)] ?? 'application/octet-stream' });
        return res.end(readFileSync(path));
      }
    }
    if (target === 'worker') { res.writeHead(200, { ...policy, 'content-type': 'text/html' }); return res.end(readFileSync(join(root, 'index.html'))); }
    res.writeHead(404, policy); res.end('not_found');
  });
}
async function listen(instance) { await new Promise((accept, reject) => { instance.once('error', reject); instance.listen(0, '127.0.0.1', accept); }); return `http://127.0.0.1:${instance.address().port}`; }
const standard = server(), strict = server(true);
const base = await listen(standard), strictBase = await listen(strict);
// This parent has no CSP: rejection must come from the protected child document.
const foreignParent = createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><title>Synthetic parent</title>');});
const parentBase = await listen(foreignParent);
const browser = await chromium.launch();
const results = { target, functional: false, mimeBlocked: false, imageVisible: false, fontsReady: false, foreignFrameBlocked: false, sameOriginFrameWorks: null, inlineReports: 0, strictScriptControl: null, sdkLoaded: null };
const external = new Set(['static.line-scdn.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const fixtureSdk = `globalThis.__realSdkLoaded=typeof globalThis.liff?.init==='function';globalThis.liff={init:async()=>{},isLoggedIn:()=>true,getProfile:async()=>({userId:'synthetic-user',displayName:'Synthetic'}),getIDToken:()=> 'synthetic-id-token',getAccessToken:()=> 'synthetic-access',getDecodedIDToken:()=>({sub:'synthetic-user'}),getFriendship:async()=>({friendFlag:true}),isInClient:()=>true,closeWindow:()=>{}};`;

async function setup(context) {
  await context.addInitScript(() => {
    globalThis.__securityViolations = [];
    document.addEventListener('securitypolicyviolation', event => globalThis.__securityViolations.push({ directive: event.violatedDirective, kind: event.blockedURI === 'inline' ? 'inline' : 'resource', disposition: event.disposition }));
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) {
      const headers = { 'access-control-allow-origin': request.headers().origin ?? base,
        'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, Authorization',
        'access-control-allow-methods': 'GET, POST, OPTIONS' };
      const reply = value => route.fulfill({ headers, ...value });
      if (request.method() === 'OPTIONS') return reply({ status: 204 });
      let data;
      if (url.pathname === '/api/auth/two-factor/verify') return reply({ status: 400, json: { success: false, error: 'コードが違います' } });
      if (url.pathname === '/api/liff/config') data = { accountName: 'Synthetic', botBasicId: '@synthetic', customerLook: { preset: 'line' } };
      else if (url.pathname === '/api/liff/customer-look') data = { settings: { liff_theme: 'line' } };
      else if (url.pathname === '/api/uuid') data = { uuid: 'synthetic-uuid' };
      else if (url.pathname === '/api/liff/link') data = {};
      else if (url.pathname.endsWith('/settings')) return reply({ json: { liff_calendar_mode: 'week-first', booking_window_days: 60 } });
      else if (url.pathname.endsWith('/menus')) return reply({ json: { menus: [{ id: 'm', name: 'Synthetic', duration_minutes: 30, base_price: 1000 }] } });
      else if (url.pathname.endsWith('/staff')) return reply({ json: { staff: [{ id: 's', display_name: 'Synthetic', price: 1000, duration_minutes: 30 }] } });
      else if (url.pathname.endsWith('/last-booking')) return reply({ json: { available: false } });
      else if (url.pathname.endsWith('/waitlist')) return reply({ json: { waitlist: [{ id: 'w', menu_id: 'm', staff_id: 's', menu_name: 'Synthetic', staff_name: 'Synthetic', status: 'invited', starts_at: '2099-10-11T01:00:00.000Z', hold_minutes: 30, hold_expires_at: '2099-10-11T00:30:00Z' }] } });
      else if (url.pathname.endsWith('/requests')) return reply({ json: { booking_id: 'b', status: 'confirmed' } });
      else data = {};
      return reply({ json: { success: true, data } });
    }
    if (url.origin === base || url.origin === strictBase || url.origin === parentBase) return route.continue();
    if (!external.has(url.hostname)) return route.abort();
    if (url.hostname === 'static.line-scdn.net') {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      return route.fulfill({ response, body: `${await response.text()}\n${fixtureSdk}` });
    }
    return route.continue();
  });
}

try {
  const context = await browser.newContext(); await setup(context);
  const page = await context.newPage(); const errors=[]; page.on('pageerror', () => errors.push('page_error'));
  if (target === 'web') {
    await page.goto(`${base}/login`);
    await page.getByRole('button', { name: 'パスワードを表示する' }).click();
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
    const handoffNonce = crypto.randomUUID();
    await page.evaluate(nonce => sessionStorage.setItem('lh_login_handoff', JSON.stringify({
      nonce, expires: Date.now() + 600000, kind: 'challenge', path: '/login/two-factor',
    })), handoffNonce);
    await page.goto(`${base}/login/two-factor#${new URLSearchParams({ lh_2fa: 'synthetic-challenge', lh_method: 'password', lh_nonce: handoffNonce })}`);
    await expect(page.getByRole('textbox')).toHaveCount(6);
    await page.getByRole('button', { name: '回復コードを使う' }).click();
    await expect(page.getByRole('textbox')).toHaveCount(8);
    for (const [index, character] of [...'ABCD2345'].entries()) await page.getByRole('textbox').nth(index).fill(character);
    await page.getByRole('button', { name: '確認してログイン', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'コードが違います。もう一度入れてください' })).toBeVisible();
    const violations = await page.evaluate(() => globalThis.__securityViolations);
    results.inlineReports = violations.filter(value => value.kind === 'inline').length;
    assert.equal(results.inlineReports, 0, 'externalized Next bootstrap must work under enforced CSP');
    assert.deepEqual(violations.filter(value => value.directive.startsWith('script-src')), []);
    const control = await context.newPage(); await control.goto(`${strictBase}/login`);
    await control.getByRole('button', { name: 'パスワードを表示する' }).click();
    await expect(control.locator('#login-password')).toHaveAttribute('type', 'text');
    await control.evaluate(() => {
      const inline = document.createElement('script');
      inline.textContent = 'globalThis.__badInlineExecuted = true';
      document.head.append(inline);
      const foreign = document.createElement('script');
      foreign.src = 'https://untrusted.invalid/hostile.js';
      document.head.append(foreign);
    });
    await expect.poll(() => control.evaluate(() => globalThis.__securityViolations.filter(value =>
      value.disposition === 'enforce' && value.directive.startsWith('script-src')).length)).toBe(2);
    assert.equal(await control.evaluate(() => globalThis.__badInlineExecuted === true), false);
    results.strictScriptControl = 'inline_and_untrusted_blocked'; await control.close();
  } else {
    await page.clock.install({ time: new Date('2026-10-11T00:00:00Z') });
    await page.goto(`${base}/booking?liffId=synthetic&waitlist=w`);
    await page.getByRole('timer').waitFor();
    results.sdkLoaded = await page.evaluate(() => globalThis.__realSdkLoaded);
    assert.equal(results.sdkLoaded, true);
    await page.getByRole('button', { name: /この(?:時間|枠)で予約する/ }).click();
    await expect(page.getByText('予約が確定しました。', { exact: true })).toBeVisible();
    const parent = await context.newPage(); await parent.goto(`${base}/__frame-parent`);
    await parent.frameLocator('#liff-frame').getByRole('timer').waitFor();
    results.sameOriginFrameWorks = true; await parent.close();
  }
  assert.deepEqual(errors, []); results.functional = true;
  results.fontsReady = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.status === 'loaded'; });
  assert.equal(results.fontsReady, true);
  results.imageVisible = await page.evaluate(async () => {
    const image=new Image();const loaded=new Promise(accept=>{image.onload=()=>accept(image.naturalWidth===1);image.onerror=()=>accept(false);});image.src='/__image-probe.png';return loaded;
  }); assert.equal(results.imageVisible, true);
  results.mimeBlocked = await page.evaluate(async () => {
    const script=document.createElement('script');const finished=new Promise(accept=>{script.onload=()=>accept(false);script.onerror=()=>accept(true);});script.src='/__mime-probe.js';document.head.append(script);return finished;
  }); assert.equal(results.mimeBlocked, true);
  const framePage = await context.newPage(); let blocked=false;
  framePage.on('console', message => { if (/frame-ancestors|X-Frame-Options/.test(message.text()) && !/report-only/.test(message.text())) blocked=true; });
  framePage.on('framenavigated', frame=>{if(frame.parentFrame()&&frame.url().startsWith('chrome-error://'))blocked=true;});
  await framePage.goto(parentBase);
  await framePage.setContent(`<iframe src="${base}/${target==='web'?'login':'booking?liffId=synthetic&waitlist=w'}"></iframe>`);
  await expect.poll(()=>blocked).toBe(true); results.foreignFrameBlocked=true;
  await context.close();
} finally {
  await browser.close(); await Promise.all([new Promise(accept=>standard.close(accept)),new Promise(accept=>strict.close(accept)),new Promise(accept=>foreignParent.close(accept))]);
  const output=process.env.TRAIN32_BROWSER_OUTPUT ?? '/tmp/browser-headers';mkdirSync(output,{recursive:true});writeFileSync(join(output,`${target}.json`),JSON.stringify(results,null,2));
}
console.log(JSON.stringify(results));
