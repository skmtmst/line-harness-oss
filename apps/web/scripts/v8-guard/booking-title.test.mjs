import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import { openPage } from './browser-env.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'
import { styleDashboardMock } from '../../../../scripts/visual-qa/style-dashboard-mock.mjs'

function clippedText() {
  return [...document.querySelector('[aria-label="台帳の盤"]').querySelectorAll('span,strong')]
    .filter(el => getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1)
    .map(el => ({ text: el.textContent, title: el.title || el.closest('[title]')?.title || '' }))
}

for (const width of [1440, 1152, 1024]) test(`サロンの予約盤は省略全文と休みの読み上げを保つ ${width}`, async () => {
  styleDashboardMock('PUT', '/api/dashboard/style', new URLSearchParams(), { style: 'salon' })
  const browser = await connectGuardBrowser()
  let page
  try {
    const adapter = { newPage: async options => { const page = await browser.newPage(options); await stubApi(page, mockFetch); return page } }
    page = await openPage(adapter, { baseUrl: process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310', route: '/', width, stable: true, requireSuccess: true })
    const board = page.getByRole('region', { name: '台帳の盤', exact: true })
    await board.waitFor()
    const rows = await page.evaluate(clippedText)
    assert.deepEqual(rows.filter(row => !row.title || !row.title.includes(row.text)), [])
    for (const menu of ['カット＋カラー', '縮毛矯正', 'ネイル', 'ジェルネイル', 'カット', 'パーマ', 'ヘッドスパ', 'カット＋ケア']) {
      const text = board.getByText(menu, { exact: true })
      assert.ok(await text.count(), `${menu}を消して違反0にしない`)
      assert.equal(await text.first().getAttribute('title'), menu, '入る幅でも元の全文を保持する')
    }
    const outside = await board.locator('button[data-booking-state]').evaluateAll(cards => cards.flatMap(card => {
      const b = card.getBoundingClientRect(), details = card.children[1], meta = details?.children[1]
      return [details?.firstElementChild, ...Array.from(meta?.children || [])].filter(Boolean).flatMap(el => { const r = el.getBoundingClientRect(); return r.width <= 0 || r.left < b.left - 1 || r.right > b.right + 1 ? [{ text: el.textContent, left: r.left, right: r.right, cardLeft: b.left, cardRight: b.right }] : [] })
    }))
    assert.deepEqual(outside, [], 'メニューと札を箱の外へ押し出さない')
    const rest = board.getByTitle(/予約は止めています/)
    assert.equal(await rest.count(), 1)
    const reading = await rest.ariaSnapshot()
    assert.ok(reading.includes('予約は止めています'), reading)
    const hidden = await rest.locator('.sr-only').evaluate(el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height, position: getComputedStyle(el).position } })
    assert.ok(hidden.width <= 1 && hidden.height <= 1 && hidden.position === 'absolute', '全文は読み上げに残し、休みの見た目を崩さない')
    assert.equal(await rest.evaluate(el => !!el.closest('button,a,[role="button"]')), false, '休みは予約操作にしない')
    const target = board.getByText('カット＋カラー', { exact: true }).first()
    const fault = await target.evaluate(el => {
      const original = { title: el.title, text: el.textContent, maxInlineSize: el.style.maxInlineSize }
      el.style.maxInlineSize = '8px'
      return original
    })
    assert.ok((await page.evaluate(clippedText)).some(row => row.text === fault.text && row.title === fault.title), '狭い幅でもtitleで全文を保つ')
    await target.evaluate(el => el.removeAttribute('title'))
    assert.ok((await page.evaluate(clippedText)).some(row => row.text === fault.text && !row.title), 'title不足の再発を検知する')
    await target.evaluate((el, original) => { el.title = original.title; if (original.maxInlineSize) el.style.maxInlineSize = original.maxInlineSize; else el.style.removeProperty('max-inline-size') }, fault)
    assert.deepEqual((await page.evaluate(clippedText)).filter(row => !row.title), [])
  } finally { await page?.close(); await browser.close(); styleDashboardMock('PUT', '/api/dashboard/style', new URLSearchParams(), { style: 'standard' }) }
})
