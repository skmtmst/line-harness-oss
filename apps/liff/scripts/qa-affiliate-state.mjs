import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.LIFF_QA_URL ?? 'http://127.0.0.1:3670';
const api = process.env.LIFF_QA_API ?? 'http://127.0.0.1:8798';
for (const url of [base, api]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const out = process.env.LIFF_QA_OUT ?? '/tmp/liff-affiliate-state';
const capture = process.env.LIFF_QA_CAPTURE !== '0';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 375, height: 724 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  return ['127.0.0.1', 'localhost', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)
    || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
});
async function apiState(value) {
  const response = await fetch(`${api}/__qa/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.ok(response.ok);
}
async function visibleText(text) { await page.getByText(text, { exact: true }).waitFor(); }
try {
  assert.ok((await fetch(`${api}/__qa/reset`, { method: 'POST' })).ok);
  await page.goto(`${base}/affiliate?liffId=qa`);
  await page.getByRole('button', { name: '使い道を選ぶ' }).click();
  await visibleText('QA 割引券');
  await page.getByRole('button', { name: 'これを選ぶ' }).click();
  await page.getByRole('button', { name: '交換する', exact: true }).click();
  await visibleText('QA 割引券に交換しました');
  await page.getByRole('button', { name: '使い道を選ぶ' }).click();
  await visibleText('使えるマイル：1,150');
  await page.getByRole('dialog', { name: 'マイルの使い道を選ぶ' }).getByRole('button', { name: '閉じる', exact: true }).click();
  const edit = page.getByRole('button', { name: '振込先を登録する' });
  await edit.click();
  const values = { 銀行コード: '0001', 銀行名: 'QA 銀行', 支店コード: '001', 支店名: 'QA 支店', 口座番号: '1234567', 口座名義: 'テスト' };
  for (const [name, value] of Object.entries(values)) await page.getByLabel(name, { exact: true }).fill(value);
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await visibleText('振込先を保存しました');
  await page.getByRole('button', { name: '振込先を編集する' }).click();
  assert.equal(await page.getByLabel('口座番号', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFをダウンロードする' }).click();
  const download = await downloading;
  assert.equal(await download.failure(), null);
  await download.saveAs(`${out}/qa-statement.pdf`);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.ok(Buffer.concat(chunks).subarray(0, 8).toString().startsWith('%PDF-1.4'));
  if (capture) await page.screenshot({ path: `${out}/S3uBl-functions.png`, fullPage: true });
  await apiState({ fail: ['/api/liff/mileage/rewards', '/api/liff/affiliate/bank'] });
  await page.reload();
  await visibleText('使い道を読み込めませんでした');
  await visibleText('振込先と明細を読み込めませんでした');
  await apiState({ fail: null });
  await page.getByRole('region', { name: 'マイルを使う' }).getByRole('button', { name: 'もう一度読み込む' }).click();
  await page.getByRole('region', { name: '振込先と支払明細' }).getByRole('button', { name: 'もう一度読み込む' }).click();
  await page.getByRole('button', { name: '振込先を編集する' }).waitFor();
  await page.getByRole('button', { name: '使い道を選ぶ' }).click();
  await visibleText('QA 割引券');
  await page.getByRole('dialog', { name: 'マイルの使い道を選ぶ' }).getByRole('button', { name: '閉じる', exact: true }).click();
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/result.json`, JSON.stringify({ width: 375, checkedAt: new Date().toISOString(), checks: ['交換と残高更新', '振込先の保存と番号非復元', 'PDFダウンロード', '2つのAPI失敗と再読込'], errors }, null, 2));
  console.log('S3uBl：交換・振込先・明細・失敗後の再読込をローカルAPIで確認');
} finally {
  await context.close();
  await browser.close();
  await fetch(`${api}/__qa/reset`, { method: 'POST' });
}
