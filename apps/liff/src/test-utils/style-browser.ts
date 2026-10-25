import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { preprocessCSS, resolveConfig } from 'vite';

/** 本番と同じ PostCSS 処理でスタイルをコンパイルし、Chromium へ適用する。 */
export async function styleBrowser(): Promise<{ browser: Browser; page: Page; show: (html: string) => Promise<void> }> {
  const filename = fileURLToPath(new URL('../index.css', import.meta.url));
  const config = await resolveConfig({ root: fileURLToPath(new URL('../../', import.meta.url)) }, 'serve');
  const compile = async (source: string) => (await preprocessCSS(source, filename, config)).code;
  const css = await compile(readFileSync(filename, 'utf8'));
  const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { executablePath: chromium.executablePath(), headless: true } : { channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.route('**/*', route => route.abort());
  return { browser, page, show: async html => {
    await page.setContent(`<html lang="ja"><head><style>${css}</style></head><body>${html}</body></html>`);
  } };
}
