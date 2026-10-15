import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.LIFF_QA_URL ?? 'http://127.0.0.1:3670';
const api = process.env.LIFF_QA_API ?? 'http://127.0.0.1:8798';
for (const url of [base, api]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const output = process.env.LIFF_QA_OUT ?? '/tmp/liff-seat-done-layout';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const results = [];

function measure(width) {
  const root = document.querySelector('[data-design-node="kxmnZ"]');
  const box = element => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  };
  const textLines = element => {
    const range = document.createRange(); range.selectNodeContents(element);
    return new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.y))).size;
  };
  const bar = document.querySelector('[data-liff-bottom-bar]');
  const rows = [...root.querySelectorAll('dl > div')].map(row => {
    const label = row.querySelector('dt'), value = row.querySelector('dd');
    return { label: label.textContent, value: value.textContent, fullValue: value.title,
      box: box(row), valueBox: box(value), lines: textLines(value), clipped: value.scrollWidth > value.clientWidth };
  });
  return { width, overflow: Math.max(0, document.documentElement.scrollWidth - width), rows, scrollY, scrollHeight: document.documentElement.scrollHeight, completionPadding: getComputedStyle(root).paddingBottom,
    summary: box(root.querySelector('dl')), status: box(root.firstElementChild), header: box(document.querySelector('header')), bar: box(bar), viewportHeight: innerHeight,
    buttons: [...bar.querySelectorAll('button')].map(button => ({ label: button.textContent.trim(), box: box(button), lines: textLines(button) })) };
}

function defects(m, course) {
  const faults = [];
  if (m.overflow) faults.push('横はみ出し');
  const labels = ['日時', '人数', ...(course ? ['コース'] : []), 'お店', '状態'];
  if (JSON.stringify(m.rows.map(row => row.label)) !== JSON.stringify(labels)) faults.push('予約内容の行');
  if (m.rows.some(row => row.valueBox.x < row.box.x || row.valueBox.right > row.box.right + 1)) faults.push('値が枠外');
  if (m.rows.some(row => row.lines !== 1)) faults.push('短い値の途中改行');
  if (m.rows.some(row => row.clipped && row.fullValue !== row.value)) faults.push('省略した値の全文なし');
  if (Math.abs(m.summary.x - 24) > 1 || Math.abs(m.width - m.summary.right - 24) > 1) faults.push('内容の左右の余白');
  if (m.rows.some(row => Math.abs(row.box.height - 42) > 1)) faults.push('内容の行の高さ');
  if (Math.abs((m.status.y + m.summary.bottom) / 2 - (m.header.bottom + m.bar.y) / 2) > 1) faults.push('完了の中央寄せ');
  if (m.summary.bottom > m.bar.y) faults.push('予約内容と下の帯が重なる');
  if (m.buttons.some(button => button.box.x < 0 || button.box.right > m.width || button.lines !== 1)) faults.push('操作の切れ・改行');
  if (Math.abs(m.bar.bottom - m.viewportHeight) > 1 || m.bar.x !== 0 || Math.abs(m.bar.width - m.width) > 1) faults.push('下の帯の位置');
  return faults;
}

try {
  for (const width of [375, 414, 310]) {
    const context = await browser.newContext({ viewport: { width, height: 812 }, isMobile: true, hasTouch: true, locale: 'ja-JP' });
    await context.addInitScript(() => {
      const OriginalDate = Date, epoch = new Date('2026-10-07T09:00:00+09:00').getTime();
      window.Date = class extends OriginalDate {
        constructor(...args) { super(...(args.length ? args : [epoch])); }
        static now() { return epoch; }
      };
    });
    await context.route('**/*', route => ['localhost', '127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const course of [false, true]) {
      assert.ok((await fetch(`${api}/__qa/reset`, { method: 'POST' })).ok);
      await page.goto(`${base}/restaurant/reserve/qa-seat`);
      await page.getByRole('radio', { name: '19:00 残りわずか', exact: true }).waitFor();
      if (course) {
        await page.getByRole('button', { name: 'コース：席のみ', exact: true }).click();
        await page.getByRole('radio', { name: /秋の鹿肉コース/ }).click();
        await page.getByRole('button', { name: 'コース：秋の鹿肉コース', exact: true }).waitFor();
      }
      await page.getByRole('radio', { name: '19:00 残りわずか', exact: true }).click();
      await page.getByRole('button', { name: 'この時刻で進む', exact: true }).click();
      await page.getByRole('button', { name: '予約を確定する', exact: true }).click();
      await page.getByText('ご予約を受け付けました', { exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.locator('[data-design-node="kxmnZ"]').evaluate(element => Promise.all(element.closest('.liff-step').getAnimations().map(animation => animation.finished)));
      const measured = await page.evaluate(measure, width);
      const faults = defects(measured, course);
      results.push({ board: 'kxmnZ', previousBoard: 'sAnyy', width, course, measured, defects: faults });
      assert.deepEqual(faults, []);
      assert.equal(measured.rows.find(row => row.label === '状態').value, '確定');
      assert.equal(measured.rows.find(row => row.label === 'お店').value, '然 - NEN - 本店');
      if (course) assert.equal(measured.rows.find(row => row.label === 'コース').value, '秋の鹿肉コース');
      const broken = await page.addStyleTag({ content: '[data-design-node="kxmnZ"] dd { min-width: 500px !important; }' });
      assert.ok(defects(await page.evaluate(measure, width), course).includes('値が枠外'));
      await broken.evaluate(element => element.remove());
      assert.deepEqual(defects(await page.evaluate(measure, width), course), []);
      await page.locator('[data-design-node="kxmnZ"]').evaluate(element => { element.style.justifyContent = 'flex-start'; });
      assert.ok(defects(await page.evaluate(measure, width), course).includes('完了の中央寄せ'));
      await page.locator('[data-design-node="kxmnZ"]').evaluate(element => element.style.removeProperty('justify-content'));
      assert.deepEqual(defects(await page.evaluate(measure, width), course), []);
      if (width === 375) {
        await page.setViewportSize({ width, height: 540 });
        await page.evaluate(async () => {
          await new Promise(requestAnimationFrame);
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
          await new Promise(requestAnimationFrame);
        });
        const small = await page.evaluate(measure, width);
        measured.smallScreen = small;
        assert.equal(small.overflow, 0);
        assert.ok(small.summary.bottom <= small.bar.y, '短い画面でも最後の行まで下の帯の上へ送れる');
        await page.locator('[data-design-node="kxmnZ"]').evaluate(element => { element.style.paddingBottom = '16px'; });
        await page.evaluate(async () => {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
          await new Promise(requestAnimationFrame);
        });
        const blocked = await page.evaluate(measure, width);
        assert.ok(blocked.summary.bottom > blocked.bar.y, '下の余白を消し、最後の行を隠す故障を検出');
        await page.locator('[data-design-node="kxmnZ"]').evaluate(element => element.style.removeProperty('padding-bottom'));
        await page.setViewportSize({ width, height: 812 });
        await page.evaluate(() => window.scrollTo(0, 0));
        assert.deepEqual(defects(await page.evaluate(measure, width), course), []);
      }
      await page.getByRole('button', { name: '予約を変える・取り消す', exact: true }).click();
      await page.getByText('ご予約の変更・取り消し', { exact: true }).waitFor();
      for (const label of ['日時・人数を変える', '取り消す']) {
        await page.getByRole('button', { name: label, exact: true }).first().waitFor();
        const buttons = await page.getByRole('button', { name: label, exact: true }).all();
        assert.ok(buttons.length > 0);
        for (const button of buttons) assert.ok(await button.isEnabled());
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`席予約の完了：${results.length}場面＋短い画面2場面・故障14件・変更/取消の入口 成功（画像保存なし）`);
} finally {
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
  await fetch(`${api}/__qa/reset`, { method: 'POST' });
}
