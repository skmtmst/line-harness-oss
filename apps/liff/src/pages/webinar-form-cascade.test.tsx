import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('@line/liff', () => ({ default: {} }));

let browser: Browser;
let page: Page;
let styles: string[];
let FormSheet: typeof import('../../../worker/src/client/webinar/main')['FormSheet'];

beforeAll(async () => {
  // 初期URLの参照だけを用意し、描画・CSS評価は本物のブラウザで行う。
  vi.stubGlobal('window', { location: { search: '' } });
  try { ({ FormSheet } = await import('../../../worker/src/client/webinar/main')); }
  finally { vi.unstubAllGlobals(); }
  // 書き出しや認証をせず、通常の本番ビルドと同じCSSを実ブラウザへ渡す。
  const directory = dirname(fileURLToPath(import.meta.url));
  const result = await build({
    root: resolve(directory, '../..'),
    configFile: resolve(directory, '../../vite.config.ts'),
    logLevel: 'silent',
    build: { write: false },
  });
  if (Array.isArray(result) || !('output' in result)) throw new Error('CSS build unavailable');
  styles = ['index', 'webinar'].map(name => {
    const asset = result.output.find(item => item.type === 'asset'
      && item.fileName.startsWith(`assets/${name}-`) && item.fileName.endsWith('.css'));
    if (!asset || asset.type !== 'asset') throw new Error(`Missing ${name} CSS`);
    return typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source);
  });
  browser = await chromium.launch(existsSync(chromium.executablePath())
    ? { executablePath: chromium.executablePath(), headless: true }
    : { channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/*', route => route.abort());
}, 60000);

afterAll(async () => { await browser?.close(); });

async function showForm(required: boolean) {
  const content = renderToStaticMarkup(<FormSheet
    sheet={{
      cta: { id: 'questionnaire', atSeconds: 0, kind: 'form', title: 'アンケート', body: null,
        buttonLabel: '開く', autoOpen: false, formId: 'questionnaire', url: null },
      phase: 'form',
      def: { id: 'questionnaire', name: '見本のアンケート', description: null, isActive: true,
        fields: [{ name: 'name', label: 'お名前', type: 'text', required }] },
    }}
    ctx={{ liffId: 'example', lineUserId: 'example', idToken: 'example' }}
    onFunnelEvent={() => {}} onClose={() => {}} onSubmitted={() => {}}
  />);
  await page.setContent(`<html><head>${styles.map(css => `<style>${css}</style>`).join('')}</head><body class="wb-active">${content}</body></html>`);
  return page.getByRole('button', { name: required ? 'あと1項目を選択' : '回答を送信して相談日時を選ぶ', exact: true });
}

it('送信できるフォームの主操作は背景と文字を見分けられる', async () => {
  const button = await showForm(false);
  expect(await button.isDisabled()).toBe(false);
  expect(await button.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(6, 199, 85)');
  expect(await button.evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
});

it('必須入力が残る時は灰色の操作と不足理由を表示する', async () => {
  const button = await showForm(true);
  expect(await button.isDisabled()).toBe(true);
  const background = await button.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe('rgba(0, 0, 0, 0)');
  expect(background).not.toBe('rgb(6, 199, 85)');
});

it('文字入力欄は枠が描画され、ブラウザ既定の装飾へ戻らない', async () => {
  await showForm(true);
  const input = page.getByRole('textbox', { name: 'お名前', exact: false });
  expect(await input.evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('1px');
  expect(await input.evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('solid');
  expect(await input.evaluate(el => getComputedStyle(el).appearance)).toBe('none');
});
