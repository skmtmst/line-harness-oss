import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { uploadQaDocument } from './qa-document-state.mjs';

const base = process.env.LIFF_QA_URL ?? 'http://127.0.0.1:3670';
const api = process.env.LIFF_QA_API ?? 'http://127.0.0.1:8798';
for (const url of [base, api]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const output = process.env.LIFF_QA_OUT ?? '/tmp/liff-document-layout';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const results = [];

function measure() {
  const box = el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  };
  const sides = ['表', '裏'].map(name => {
    const group = document.querySelector(`[role="group"][aria-label="${name}"]`);
    const image = group.querySelector('img');
    const remove = group.querySelector('button[aria-label$="を外す"]');
    return { name, box: box(group), image: image ? box(image) : null, remove: remove ? box(remove) : null };
  });
  return { sides, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth) };
}

function defects(m, filled) {
  const faults = [];
  if (m.overflow) faults.push('横越え');
  const expected = filled ? 118 : 110;
  for (const side of m.sides) {
    if (Math.abs(side.box.height - expected) > 1) faults.push(`${side.name}の高さ`);
    if (filled && (!side.image || side.image.height < 80)) faults.push(`${side.name}の写真の高さ`);
    const r = side.remove, b = side.box;
    if (filled && (!r || r.x < b.x || r.y < b.y || r.right > b.right || r.bottom > b.bottom)) faults.push(`${side.name}の×が枠外`);
  }
  if (Math.abs(m.sides[0].box.y - m.sides[1].box.y) > 1) faults.push('表裏の上下ずれ');
  if (Math.abs(m.sides[1].box.x - m.sides[0].box.right - 10) > 1) faults.push('表裏の間隔');
  return faults;
}

try {
  for (const width of [375, 414, 310]) {
    const context = await browser.newContext({ viewport: { width, height: 768 }, isMobile: true, hasTouch: true, locale: 'ja-JP' });
    await context.route('**/*', route => ['localhost', '127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await fetch(`${api}/__qa/reset`, { method: 'POST' });
    await page.goto(`${base}/forms/qa-document`);
    await page.getByRole('button', { name: '写真を選ぶ', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const empty = await page.evaluate(measure);
    results.push({ width, state: 'empty', measured: empty, defects: defects(empty, false) });
    await page.screenshot({ path: `${output}/empty-${width}.png` });
    await uploadQaDocument(page);
    const filled = await page.evaluate(measure);
    results.push({ width, state: 'filled', measured: filled, defects: defects(filled, true) });
    await page.screenshot({ path: `${output}/filled-${width}.png` });
    if (!process.env.LIFF_DOCUMENT_BASELINE) {
      assert.deepEqual(defects(empty, false), []);
      assert.deepEqual(defects(filled, true), []);
      await page.evaluate(() => {
        for (const name of ['empty-height', 'preview-height', 'radius', 'gap', 'slot-gap', 'action-gap', 'remove-size']) document.documentElement.style.setProperty(`--liff-document-${name}`, 'initial');
      });
      assert.deepEqual(defects(await page.evaluate(measure), true), [], '管理画面の見本で専用値が無くても寸法を保つ');
      await page.evaluate(() => {
        for (const name of ['empty-height', 'preview-height', 'radius', 'gap', 'slot-gap', 'action-gap', 'remove-size']) document.documentElement.style.removeProperty(`--liff-document-${name}`);
      });
      await page.getByRole('button', { name: 'qa-front.pngを外す', exact: true }).evaluate(el => { el.style.top = '130px'; });
      assert.ok(defects(await page.evaluate(measure), true).includes('表の×が枠外'), '注意文へ出る×を検出');
      await page.getByRole('button', { name: 'qa-front.pngを外す', exact: true }).evaluate(el => el.style.removeProperty('top'));
      await page.getByRole('group', { name: '表', exact: true }).locator('img').evaluate(el => { el.style.height = '1px'; });
      assert.ok(defects(await page.evaluate(measure), true).includes('表の写真の高さ'), '画像の高さが潰れる故障を検出');
      await page.getByRole('group', { name: '表', exact: true }).locator('img').evaluate(el => el.style.removeProperty('height'));
      await page.getByRole('button', { name: '撮り直す・選び直す', exact: true }).click();
      assert.equal(await page.getByAltText('送った写真').count(), 2, '選び直しを開くだけで添付を失わない');
      await page.getByRole('button', { name: '表を外して選び直す', exact: true }).click();
      await page.getByRole('button', { name: '写真を選ぶ', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'qa-front.pngを外す', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'qa-back.pngを外す', exact: true }).count(), 1, '裏は保持');
      assert.deepEqual(errors, []);
    }
    await context.close();
  }
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ scenes: results.length, defects: results.reduce((n, r) => n + r.defects.length, 0), baseline: Boolean(process.env.LIFF_DOCUMENT_BASELINE) }));
} finally { await browser.close(); await fetch(`${api}/__qa/reset`, { method: 'POST' }); }
