import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.LIFF_QA_URL ?? 'http://127.0.0.1:3670';
const api = process.env.LIFF_QA_API ?? 'http://127.0.0.1:8798';
for (const url of [base, api]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), '試験用のローカル環境だけを使います');
const output = process.env.LIFF_QA_OUT ?? '/tmp/liff-layout-check';
const capture = process.env.LIFF_QA_CAPTURE !== '0';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const results = [];

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined)));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

function measure(viewport) {
  const r = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
  const textFits = el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const b = el.getBoundingClientRect();
    let fits = true;
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      const boxes = [...range.getClientRects()];
      if (boxes.some(t => t.left < b.left - 1 || t.right > b.right + 1 || t.top < b.top - 1 || t.bottom > b.bottom + 1)) fits = false;
      if (new Set(boxes.map(t => Math.round(t.y))).size > 1) fits = false;
    }
    return fits;
  };
  const slots = [...document.querySelectorAll('[aria-label*="個中"] [role=listitem]')];
  const bar = document.querySelector('[data-liff-bottom-bar]');
  const conditions = document.querySelector('section[aria-label="スタンプがたまる条件"]');
  const rewards = document.querySelector('[aria-label="特典の一覧"]');
  const controls = [...document.querySelectorAll('button')].filter(el => /空いたら知らせる|時間を変える|キャンセルする/.test(el.textContent) && el.getBoundingClientRect().height > 0);
  return {
    overflow: Math.max(0, document.documentElement.scrollWidth - viewport.width),
    slots: slots.map(el => ({ ...r(el), radius: parseFloat(getComputedStyle(el).borderRadius), round: getComputedStyle(el).borderRadius.includes('%') ? parseFloat(getComputedStyle(el).borderRadius) >= 50 : parseFloat(getComputedStyle(el).borderRadius) >= el.getBoundingClientRect().width / 2 })),
    bar: bar ? { ...r(bar), width: viewport.width, height: viewport.height, position: getComputedStyle(bar).position, shadow: getComputedStyle(bar).boxShadow } : null,
    conditionsAfterRewards: conditions && rewards ? conditions.compareDocumentPosition(rewards) & Node.DOCUMENT_POSITION_PRECEDING : null,
    controls: controls.map(el => ({ text: el.textContent.trim(), fits: textFits(el) })),
  };
}
function stampOK(m) {
  return m.slots.length === 10 && m.slots.every(s => s.round && Math.abs(s.w - s.h) < 1) && m.slots.slice(0, 5).every(s => s.y === m.slots[0].y) && m.slots[5].y > m.slots[0].y && Boolean(m.conditionsAfterRewards);
}
function barOK(m) { return m.bar && m.bar.position === 'fixed' && m.bar.x === 0 && Math.abs(m.bar.w - m.bar.width) < 1 && Math.abs(m.bar.bottom - m.bar.height) < 1 && (m.bar.shadow === 'none' || m.bar.shadow.split(/,(?![^()]*\))/).every(s => /\binset\b/.test(s))); }
try {
  for (const width of [375, 414, 310, 1152, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 768 }, isMobile: true, hasTouch: true, locale: 'ja-JP' });
    await context.addInitScript(() => { const D = Date; const epoch = new D('2026-10-07T09:00:00+09:00').getTime(); window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [epoch])); } static now() { return epoch; } }; });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/liff/webinars/qa-webinar') {
        const response = await route.fetch();
        return route.fulfill({ response, json: { ...await response.json(), registeredForThisSession: true } });
      }
      const host = new URL(route.request().url()).hostname;
      return ['localhost', '127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(host) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await fetch(`${api}/__qa/reset`, { method: 'POST' });
    await page.goto(`${base}/visit-stamps?liffId=qa`);
    await page.getByRole('button', { name: '店員に見せる', exact: true }).waitFor();
    await settle(page);
    let m = await page.evaluate(measure, page.viewportSize());
    assert.equal(m.overflow, 0); assert.ok(stampOK(m), '丸5列・条件は特典一覧の下'); assert.ok(barOK(m), '下の帯は全幅で下端に固定');
    results.push({ page: 'stamp', width, measured: m });
    if (capture) await page.screenshot({ path: `${output}/stamp-${width}.png` });
    await page.locator('[aria-label*="個中"] [role=listitem]').evaluateAll(els => els.forEach(el => el.style.borderRadius = '0'));
    assert.equal(stampOK(await page.evaluate(measure, page.viewportSize())), false, '四角へ戻す故障を検出');
    await page.reload(); await page.getByRole('button', { name: '店員に見せる', exact: true }).waitFor();
    await page.locator('[data-liff-bottom-bar]').evaluate(el => { el.style.left = '16px'; el.style.right = '16px'; });
    assert.equal(barOK(await page.evaluate(measure, page.viewportSize())), false, '浮いた狭い帯へ戻す故障を検出');
    await page.goto(`${base}/restaurant/reserve/qa-seat?liffId=qa`);
    await page.getByRole('radio', { name: '19:00 残りわずか', exact: true }).click({ timeout: 5000 }).catch(async e => { if (capture) await page.screenshot({ path: `${output}/seat-opening-failed-${width}.png` }); console.log(await page.locator('body').innerText()); throw e; });
    await page.getByRole('button', { name: /空いたら知らせる/ }).first().waitFor();
    await settle(page);
    const info = page.locator('[data-liff-icon-tone="info"]').first();
    assert.equal(await info.evaluate(el => getComputedStyle(el).color), 'rgb(37, 99, 235)', '満席の案内印は青');
    m = await page.evaluate(measure, page.viewportSize());
    assert.ok(m.controls.length >= 2 && m.controls.every(c => c.fits), '通知の短文が枠内の1行に収まる');
    assert.equal(m.overflow, 0); results.push({ page: 'seat', width, measured: m });
    if (capture) await page.screenshot({ path: `${output}/seat-${width}.png` });
    await page.getByRole('button', { name: /空いたら知らせる/ }).first().evaluate(el => { el.style.width = '24px'; el.style.height = '24px'; el.style.whiteSpace = 'normal'; });
    assert.ok((await page.evaluate(measure, page.viewportSize())).controls.some(c => !c.fits), '24pxへ長い文を入れる故障を検出');
    await page.goto(`${base}/events/me?liffId=qa`);
    await page.getByRole('button', { name: '時間を変える', exact: true }).waitFor();
    await settle(page);
    m = await page.evaluate(measure, page.viewportSize());
    assert.ok(m.controls.length >= 2 && m.controls.every(c => c.fits), 'イベントの操作が1行');
    assert.equal(m.overflow, 0); results.push({ page: 'event', width, measured: m });
    if (capture) await page.screenshot({ path: `${output}/event-${width}.png` });
    await page.getByRole('button', { name: '時間を変える', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: /今の時間/, exact: false }).waitFor();
    assert.ok(await page.getByRole('dialog').getByRole('button', { name: /今の時間/, exact: false }).isDisabled(), '今の時間を変更先として選ばせない');
    assert.ok(await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).isVisible(), '変更先の選択を閉じられる');
    await page.goto(`${base}/forms/qa-form-1?liffId=qa`);
    const chosen = page.getByRole('radio', { name: 'トリミング', exact: true });
    await chosen.waitFor();
    await settle(page);
    const choiceLook = () => chosen.evaluate(el => {
      const css = getComputedStyle(el), core = getComputedStyle(el, '::after'), probe = document.createElement('span');
      el.parentElement.append(probe);
      probe.style.color = 'var(--color-canvas)'; const canvas = getComputedStyle(probe).color;
      probe.style.color = 'var(--color-liff-primary)'; const primary = getComputedStyle(probe).color; probe.remove();
      return { background: css.backgroundColor, image: css.backgroundImage, canvas, primary, core: { background: core.backgroundColor, width: parseFloat(core.width), height: parseFloat(core.height), radius: core.borderRadius }, rowHeight: el.closest('label').getBoundingClientRect().height };
    });
    const formLook = await choiceLook();
    const correctChoice = c => c.background === c.primary && c.image === 'none' && c.core.background === c.canvas && c.core.width === 12 && c.core.height === 12 && (c.core.radius === '50%' || parseFloat(c.core.radius) >= c.core.width / 2);
    assert.ok(correctChoice(formLook), '選択の丸は白い芯と緑の輪');
    if (capture) await page.screenshot({ path: `${output}/form-${width}.png` });
    await chosen.evaluate(el => { const css = getComputedStyle(el); el.style.background = `radial-gradient(circle, ${css.getPropertyValue('--color-liff-primary')} 4px, ${css.getPropertyValue('--color-canvas')} 4px)`; });
    assert.equal(correctChoice(await choiceLook()), false, '古い緑の点へ戻す故障を検出');
    await chosen.evaluate(el => el.style.removeProperty('background'));
    const squareCore = await page.addStyleTag({ content: 'input[type="radio"]:checked::after { border-radius: 0 !important; }' });
    assert.equal(correctChoice(await choiceLook()), false, '白い芯が四角になる故障を検出');
    await squareCore.evaluate(el => el.remove());
    const smallCore = await page.addStyleTag({ content: 'input[type="radio"]:checked::after { width: 9px !important; height: 9px !important; }' });
    assert.equal(correctChoice(await choiceLook()), false, '白い芯が絵より小さい故障を検出');
    await smallCore.evaluate(el => el.remove());
    await page.getByRole('radio', { name: 'シャンプーのみ', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('input[type=radio]')].some(el => el.checked && el.closest('label').textContent.includes('シャンプーのみ')));
    const unselected = await choiceLook();
    assert.ok(Math.abs(formLook.rowHeight - unselected.rowHeight) < 1, '選択を変えても行の高さが跳ねない');
    results.push({ page: 'form', width, formLook, unselected });
    await page.goto(`${base}/webinar/qa-webinar?liffId=qa`);
    const cta = page.getByRole('button', { name: '個別相談を申し込む', exact: true });
    await cta.waitFor(); await page.evaluate(() => document.fonts.ready);
    const ctaLook = () => cta.evaluate((el, viewport) => {
      const b = el.getBoundingClientRect();
      const frame = el.parentElement.getBoundingClientRect();
      return { x: b.x, right: b.right, width: b.width, frameLeft: frame.left, frameRight: frame.right, viewport, overflow: Math.max(0, document.documentElement.scrollWidth - viewport) };
    }, width);
    const fitsCta = c => c.x >= 15 && c.right <= c.viewport - 15
      && c.x >= c.frameLeft + 15 && c.right <= c.frameRight - 15 && c.overflow === 0;
    const initialWebinar = await ctaLook();
    await settle(page);
    const webinar = await ctaLook();
    console.log(JSON.stringify({ page: 'webinar', width, initial: initialWebinar, stable: webinar }));
    if (capture && !fitsCta(webinar)) await page.screenshot({ path: `${output}/webinar-failed-${width}.png` });
    assert.ok(fitsCta(webinar), `相談ボタンの左右16pxを指定幅で確かめる: ${JSON.stringify(webinar)}`);
    const liveLook = () => page.locator('[data-liff-player-status]').evaluate(el => {
      const b = el.getBoundingClientRect(), p = el.closest('[data-liff-player-controls]').getBoundingClientRect(), css = getComputedStyle(el);
      return { centered: Math.abs((b.left + b.right) / 2 - (p.left + p.right) / 2) < 1, radius: css.borderRadius, color: css.backgroundColor };
    });
    const liveOK = x => x.centered && parseFloat(x.radius) >= 20 && x.color === 'rgb(229, 72, 77)';
    assert.ok(liveOK(await liveLook()), '配信中の札は中央の赤い丸札');
    await page.locator('[data-liff-player-status]').evaluate(el => { el.style.borderRadius = '0'; });
    assert.equal(liveOK(await liveLook()), false, '四角い札へ戻す故障を検出');
    await page.locator('[data-liff-player-status]').evaluate(el => el.style.removeProperty('border-radius'));
    for (const author of await page.locator('[data-liff-comment-author]').all()) assert.equal(await author.evaluate(el => getComputedStyle(el).color), 'rgb(230, 232, 235)', '投稿者は本文と同じ色');
    await page.getByRole('button', { name: '音声をオンにする', exact: true }).click();
    await page.getByRole('button', { name: '音声をオフにする', exact: true }).waitFor();
    results.push({ page: 'webinar', width, measured: webinar });
    if (capture) await page.screenshot({ path: `${output}/webinar-${width}.png` });
    await cta.evaluate(el => el.style.width = '100%');
    assert.equal(fitsCta(await ctaLook()), false, '全幅に左右の余白を足して切れる故障を検出');
    assert.deepEqual(errors, []);
    await context.close();
  }
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(`LIFF layout: ${results.length}場面・${new Set(results.map(result => result.width)).size}幅の表示と故障検知が成功`);
} finally { await browser.close(); await fetch(`${api}/__qa/reset`, { method: 'POST' }); }
