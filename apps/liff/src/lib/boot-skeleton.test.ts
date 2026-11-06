import { existsSync, readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, expect, it } from 'vitest';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? { executablePath: chromium.executablePath(), headless: true } : { channel: 'chrome', headless: true });
  page = await browser.newPage();
  await page.route('**/*', route => route.abort());
}, 30000);
afterAll(async () => { await browser?.close(); });

it('認証前にも読み込みを伝え、短時間なら骨組みを見せず、300ms後に表示する', async () => {
  await page.clock.install();
  await page.setContent(readFileSync(new URL('../../index.html', import.meta.url), 'utf8'));
  const status = page.getByRole('status');
  expect(await status.getAttribute('aria-busy')).toBe('true');
  expect(await status.getAttribute('aria-label')).toBe('読み込み中');
  await page.evaluate(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 299; } });
  expect(await status.evaluate(el => getComputedStyle(el).opacity)).toBe('0');
  await page.evaluate(() => { for (const a of document.getAnimations()) a.currentTime = 300; });
  expect(await status.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  expect(await status.locator('i').count()).toBeGreaterThan(0);
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toBe('noindex, nofollow');
  expect(await page.title()).toBe('musubo');
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toBe('width=device-width, initial-scale=1.0');
  const fonts = await page.locator('link[rel="stylesheet"]').getAttribute('href');
  for (const family of ['Shippori+Mincho', 'Zen+Maru+Gothic', 'Inter:wght@300', 'Noto+Sans+JP:wght@400;500;600;700;800']) expect(fonts).toContain(family);
});

it('動きを減らす設定では起動直後から骨組みを表示する', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent(readFileSync(new URL('../../index.html', import.meta.url), 'utf8'));
  expect(await page.getByRole('status').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
});
