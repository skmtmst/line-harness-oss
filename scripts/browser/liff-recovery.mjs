// 現役Workerの本物のbundleを手元の人工APIだけで開く。外部ネットワークは遮断する。
// 先にworkerをbuildしてserve-out.mjsでdist/clientを配る。
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const base = process.argv[2] ?? 'http://127.0.0.1:4325';
const server = process.argv[2] ? null : spawn(process.execPath, ['apps/web/scripts/v8-guard/serve-out.mjs', 'apps/worker/dist/client', '4325'], { stdio: ['ignore', 'pipe', 'pipe'] });
if (server) {
  process.once('exit', () => server.kill());
  await new Promise((accept, reject) => {
    const timeout = setTimeout(() => reject(new Error('手元の配備用画面サーバーが起動しません')), 10000);
    server.stdout.once('data', () => { clearTimeout(timeout); accept(); });
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`画面サーバー終了 ${code}`)); });
  });
}
const out = process.argv[3] ?? '/tmp/liff-recovery';
mkdirSync(out, { recursive: true });
const index = readFileSync(resolve('apps/worker/dist/client/index.html'), 'utf8');
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [375, 414]) for (const theme of ['line', 'night']) for (const entryCase of ['direct', 'sdk-state']) {
    const page = await browser.newPage({ viewport: { width, height: 896 }, reducedMotion: 'reduce' });
    const errors = [], unexpected = [], posts = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: new Date('2026-10-11T00:00:00Z') });
    await page.addInitScript(() => {
      window.liff = { init: async () => {}, isLoggedIn: () => true, getProfile: async () => ({ userId: 'fixture', displayName: '人工会員' }), getIDToken: () => 'fixture-token', getAccessToken: () => 'fixture-access', getDecodedIDToken: () => ({ sub: 'fixture' }), getFriendship: async () => ({ friendFlag: true }), isInClient: () => true, closeWindow: () => {} };
    });
    const starts = '2099-10-11T01:00:00.000Z';
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/booking') return route.fulfill({ status: 200, contentType: 'text/html', body: index });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (req.method() !== 'GET') posts.push({ path: url.pathname, body: req.postData() });
      let data;
      if (url.pathname === '/api/liff/config') data = { success: true, data: { accountName: '人工店舗', botBasicId: '@fixture', customerLook: { preset: theme } } };
      else if (url.pathname === '/api/liff/customer-look') data = { success: true, data: { settings: { liff_theme: theme } } };
      else if (url.pathname === '/api/uuid') data = { success: true, data: { uuid: 'fixture-uuid' } };
      else if (url.pathname === '/api/liff/link') data = { success: true };
      else if (url.pathname.endsWith('/settings')) data = { liff_calendar_mode: 'week-first', booking_window_days: 60 };
      else if (req.method() === 'GET' && url.pathname === '/api/liff/booking/store-photos') data = { success: true, data: [] };
      else if (url.pathname.endsWith('/menus')) data = { menus: [{ id: 'm', name: '人工メニュー', duration_minutes: 30, base_price: 1000 }] };
      else if (url.pathname.endsWith('/staff')) data = { staff: [{ id: 's', display_name: '人工担当', price: 1000, duration_minutes: 30 }] };
      else if (url.pathname.endsWith('/last-booking')) data = { available: false };
      else if (url.pathname.endsWith('/waitlist')) data = { waitlist: [{ id: 'w', menu_id: 'm', staff_id: 's', menu_name: '人工メニュー', staff_name: '人工担当', status: 'invited', starts_at: starts, hold_minutes: 30, hold_expires_at: '2026-10-11T00:30:00Z' }] };
      else if (url.pathname.endsWith('/requests')) data = { booking_id: 'b', status: 'confirmed' };
      else { unexpected.push(url.pathname); return route.fulfill({ status: 500, json: { error: 'unexpected artificial API' } }); }
      return route.fulfill({ json: data });
    });
    await page.goto(entryCase === 'direct' ? `${base}/booking?liffId=fixture&waitlist=w` : `${base}/?liffId=fixture&liff.state=${encodeURIComponent('/booking?waitlist=w')}`);
    try { await page.getByRole('timer').waitFor({ timeout: 15000 }); } catch (cause) { await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }); console.error(JSON.stringify({ errors, unexpected, posts, body: await page.locator('body').innerText() })); throw cause; }
    await page.locator(`#app [data-liff-theme="${theme}"]`).first().waitFor();
    const button = page.getByRole('button', { name: /この(?:時間|枠)で予約する/ });
    const layout = await button.evaluate(el => {
      const rect = el.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(el);
      return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, button: { width: rect.width, height: rect.height }, lines: range.getClientRects().length };
    });
    if (layout.pageWidth > width) { await page.screenshot({ path: join(out, 'overflow.png'), fullPage: true }); console.error(JSON.stringify({ layout, hits: await page.locator('.liff-hit').evaluateAll(nodes => nodes.map(el => ({ text: el.textContent, rect: el.getBoundingClientRect().toJSON(), pseudo: { width: getComputedStyle(el, '::after').width, left: getComputedStyle(el, '::after').left } }))), over: await page.locator('*').evaluateAll(nodes => nodes.filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent?.slice(0, 80), width: el.getBoundingClientRect().width }))) })); throw new Error(`横はみ出し ${width}/${theme}`); }
    await page.screenshot({ path: join(out, `${width}-${theme}-${entryCase}-offer.png`), fullPage: true });
    if (layout.lines !== 1) throw new Error(`短い予約操作の折り返し ${width}/${theme}: ${layout.lines}行`);
    await button.click(); await page.getByText('予約が確定しました。', { exact: true }).waitFor();
    if (posts.filter(p => p.path.endsWith('/requests')).length !== 1 || unexpected.length || errors.length) throw new Error(JSON.stringify({ posts, unexpected, errors }));
    results.push({ width, theme, entryCase, layout, errors, unexpected });
    await page.close();
  }
} finally { await browser.close(); server?.kill(); writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2)); }
console.log(JSON.stringify(results));
