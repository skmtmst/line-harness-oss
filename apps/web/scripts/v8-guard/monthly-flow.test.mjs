import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectGuardBrowser } from './browser-session.mjs'
import { mockFetch } from './mock-local.mjs'
import { stubApi } from './speed-budget.mjs'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'

function scanFlow() {
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) return ['窓が無い']
  const errors = [], bands = [...dialog.querySelectorAll('[data-kpi-strip]')]
  if (bands.length !== 2) return ['流れと報酬の2段が必要']
  for (const [index, band] of bands.entries()) {
    const cards = [...band.querySelectorAll('[data-design-version="v8"]')]
    if (cards.length !== (index === 0 ? 4 : 2)) errors.push('項目の数が違う')
    const first = cards[0]?.getBoundingClientRect()
    for (const card of cards) {
      const r = card.getBoundingClientRect(), label = card.querySelector('[data-kpi-label]'), text = label?.querySelector('span:last-child')
      if (first && Math.abs(first.top - r.top) > 1) errors.push('カードが横並びでない')
      if (!r.width || r.left < band.getBoundingClientRect().left - 1 || r.right > band.getBoundingClientRect().right + 1) errors.push('カードがはみ出す')
      if (!text || text.scrollWidth > text.clientWidth + 1) errors.push('項目名が切れる')
      const number = card.querySelector('[data-kpi-number]'), unit = card.querySelector('[data-kpi-unit]')
      if (number && unit && parseFloat(getComputedStyle(number).fontSize) <= parseFloat(getComputedStyle(unit).fontSize)) errors.push('数と単位の大きさが分かれない')
    }
    if (band.scrollWidth > band.clientWidth + 1) errors.push('数の帯が横にはみ出す')
  }
  const cards = [...bands[0].querySelectorAll('[data-design-version="v8"]')]
  const sizes = cards.map(card => parseFloat(getComputedStyle(card.querySelector('[data-kpi-number]')).fontSize))
  if (Math.max(...sizes) - Math.min(...sizes) > 0.1) errors.push('流れの数字の大きさがそろわない')
  const rects = cards.map(card => card.getBoundingClientRect())
  if (rects.some(r => Math.abs(r.width - rects[0].width) > 1 || Math.abs(r.height - rects[0].height) > 1)) errors.push('流れのカードの幅と高さがそろわない')
  const moneyCards = [...bands[1].querySelectorAll('[data-design-version="v8"]')]
  moneyCards.forEach((card, index) => {
    const r = card.getBoundingClientRect()
    if (Math.abs(r.left - rects[index * 2].left) > 1 || Math.abs(r.right - rects[index * 2 + 1].right) > 1) errors.push('報酬のカードが流れの2列にそろわない')
  })
  const moneyCard = moneyCards[0]
  for (const card of cards) {
    if (getComputedStyle(card).paddingLeft !== getComputedStyle(moneyCard).paddingLeft || getComputedStyle(card).paddingRight !== getComputedStyle(moneyCard).paddingRight) errors.push('流れの内側の余白が報酬と違う')
  }
  const body = dialog.querySelector('[data-window-body]'), headings = [...dialog.querySelectorAll('h3')]
  if (!body || headings.length !== 2) errors.push('2段の見出しが必要')
  else {
    const firstGap = headings[0].parentElement.getBoundingClientRect().top - body.getBoundingClientRect().top
    const nextGap = headings[1].parentElement.getBoundingClientRect().top - bands[0].getBoundingClientRect().bottom
    if (Math.abs(firstGap - nextGap) > 1) errors.push('報酬の見出しの上の間隔がそろわない')
  }
  const connections = [...bands[0].querySelectorAll('[data-kpi-connection]')]
  if (connections.length !== 3) errors.push('3つの矢印が必要')
  connections.forEach((node, index) => {
    const arrow = node.querySelector('svg')?.getBoundingClientRect(), before = cards[index]?.getBoundingClientRect(), after = cards[index + 1]?.getBoundingClientRect()
    if (!arrow || !before || !after || arrow.left < before.right - 1 || arrow.right > after.left + 1) errors.push('矢印がカードの間にない')
    const rate = node.querySelector('span')?.getBoundingClientRect()
    if (rate) {
      for (const card of cards) {
        const r = card.getBoundingClientRect()
        if (rate.left < r.right - 1 && rate.right > r.left + 1 && rate.top < r.bottom - 1 && rate.bottom > r.top + 1) errors.push('割合がカードに重なる')
      }
      const bounds = bandBounds(bands[0])
      if (rate.left < bounds.left - 1 || rate.right > bounds.right + 1 || rate.bottom > bounds.bottom + 1) errors.push('割合が流れの段からはみ出す')
    }
  })
  if (dialog.scrollWidth > dialog.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1) errors.push('窓がはみ出す')
  return errors

  function bandBounds(band) { return band.getBoundingClientRect() }
}

for (const width of [1152, 1440]) for (const partial of [false, true]) test(`monthly flow ${width} ${partial ? 'partial' : 'complete'}`, async () => {
  const base = process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310'
  const output = join(process.env.V8_GUARD_ARTIFACT_DIR || '/tmp/v8-guard', 'monthly-flow', `${width}-${partial ? 'partial' : 'complete'}`)
  mkdirSync(output, { recursive: true })
  const browser = await connectGuardBrowser(), context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ja-JP', reducedMotion: 'reduce' }), page = await context.newPage()
  const errors = [], writes = [], diagnostics = [], faultChecks = []; let failed = partial, highRates = false, failure = null, broken = [], restored = false, metrics = null
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(values => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value) }, PARITY_INIT)
  await stubApi(page, async (method, path) => {
    const url = new URL(path, base)
    if (method !== 'GET') {
      const request = { method, path: url.pathname }
      // 通信失敗の報告は既存transportの動き。業務の保存とは分け、失敗の周で報告されたことも検証する。
      if (method === 'POST' && url.pathname === '/api/client-errors') diagnostics.push(request)
      else writes.push(request)
    }
    const ok = data => ({ status: 200, body: JSON.stringify({ success: true, data }) })
    if (url.pathname === '/api/affiliates-report') return failed ? { status: 503, body: JSON.stringify({ success: false, error: '集計に接続できません' }) } : ok([highRates ? { totalClicks: 100, friendAdds: 125, totalConversions: 1563 } : { totalClicks: 1000, friendAdds: 210, totalConversions: 70 }])
    if (url.pathname === '/api/conversions/approvals' && url.searchParams.get('status') === 'approved') return ok(Array.from({ length: 20 }, (_, index) => ({ id: `approved-${index}`, createdAt: new Date().toISOString() })))
    if (url.pathname === '/api/affiliate-settlements/preview') return ok({ totalAmount: 123400 })
    if (url.pathname === '/api/affiliate-payments') return ok([{ heldReward: 2000 }, { heldReward: 500 }])
    return mockFetch(method, path)
  })
  // 撮影で有限の動きを終わらせ、写真と同じ完成した配置を測る。
  const scan = async () => {
    await page.screenshot({ animations: 'disabled' })
    return page.evaluate(scanFlow)
  }
  try {
    assert.ok((await page.goto(base + '/affiliates', { waitUntil: 'domcontentloaded' }))?.ok())
    await page.getByRole('button', { name: '今月の流れを確認', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '今月の成果の流れ', exact: true })
    await dialog.locator('[aria-label="成果までの流れ"][aria-busy="false"]').waitFor()
    await page.evaluate(() => document.fonts.ready)
    assert.deepEqual(await scan(), [])
    metrics = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]'), cards = [...dialog.querySelectorAll('[data-kpi-layout="flow"] > [data-design-version]')]
      return cards.map(card => ({ label: card.getAttribute('aria-label'), width: card.getBoundingClientRect().width, height: card.getBoundingClientRect().height, fontSize: getComputedStyle(card.querySelector('[data-kpi-number]')).fontSize, paddingLeft: getComputedStyle(card).paddingLeft, paddingRight: getComputedStyle(card).paddingRight }))
    })
    assert.deepEqual(await dialog.locator('[data-kpi-number]').allTextContents(), partial ? ['—', '—', '—', '20', '123,400', '2,500'] : ['1,000', '210', '70', '20', '123,400', '2,500'])
    assert.deepEqual(await dialog.locator('[data-kpi-connection]').allTextContents(), partial ? ['', '', ''] : ['21.0%', '33.3%', '28.6%'])
    await page.screenshot({ path: join(output, 'normal.png'), animations: 'disabled' })
    if (partial) {
      failed = false
      await dialog.getByRole('button', { name: 'もう一度読み込む', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[role="dialog"] [data-kpi-number]')?.textContent === '1,000')
      assert.deepEqual(await scan(), [])
      assert.deepEqual(await dialog.locator('[data-kpi-connection]').allTextContents(), ['21.0%', '33.3%', '28.6%'])
      assert.equal(await dialog.getByRole('button', { name: 'もう一度読み込む', exact: true }).count(), 0)
      await page.screenshot({ path: join(output, 'retry.png'), animations: 'disabled' })
    }
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
    highRates = true
    await page.getByRole('button', { name: '今月の流れを確認', exact: true }).click()
    await dialog.locator('[aria-label="成果までの流れ"][aria-busy="false"]').waitFor()
    assert.deepEqual(await dialog.locator('[data-kpi-connection]').allTextContents(), ['125.0%', '1250.4%', '1.3%'])
    assert.deepEqual(await scan(), [])
    await page.screenshot({ path: join(output, 'high-rates.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
    highRates = false
    await page.getByRole('button', { name: '今月の流れを確認', exact: true }).click()
    await dialog.locator('[aria-label="成果までの流れ"][aria-busy="false"]').waitFor()
    assert.deepEqual(await scan(), [])
    const fault = await page.addStyleTag({ content: '[data-kpi-layout="flow"] { flex-direction: column !important; }' })
    broken = await scan()
    assert.ok(broken.includes('カードが横並びでない'), '故障で赤になる')
    await page.screenshot({ path: join(output, 'fault.png'), animations: 'disabled' })
    await fault.evaluate(node => node.remove())
    assert.deepEqual(await scan(), [])
    for (const [name, css, reason] of [
      ['number-size', '[data-kpi-layout="flow"] > [data-design-version]:first-child [data-kpi-number] { font-size: 18px !important; }', '流れの数字の大きさがそろわない'],
      ['padding', '[data-kpi-layout="flow"] > [data-design-version]:first-child { padding-inline: 8px !important; }', '流れの内側の余白が報酬と違う'],
      ['summary-columns', '[data-kpi-layout="flow-summary"] { gap: 12px !important; }', '報酬のカードが流れの2列にそろわない'],
      ['section-gap', '[data-separation="section"] { margin-block-start: 0 !important; }', '報酬の見出しの上の間隔がそろわない'],
      ['connection-width', '[data-kpi-layout="flow"] > [data-kpi-connection] { flex-basis: 2px !important; }', '矢印がカードの間にない'],
      ['rate-position', '[data-kpi-connection] > span { position: relative !important; left: -30px !important; }', '割合がカードに重なる'],
    ]) {
      const injected = await page.addStyleTag({ content: css })
      const found = await scan()
      assert.ok(found.includes(reason), name)
      faultChecks.push({ name, found })
      await page.screenshot({ path: join(output, `fault-${name}.png`), animations: 'disabled' })
      await injected.evaluate(node => node.remove())
      assert.deepEqual(await scan(), [])
    }
    restored = true
    await page.screenshot({ path: join(output, 'restored.png'), animations: 'disabled' })
    assert.deepEqual(errors, [])
    assert.deepEqual(writes, [], '読むだけの窓から保存しない')
    assert.equal(diagnostics.length > 0, partial, '失敗した周だけ既存の通信エラー報告が動く')
  } catch (error) {
    failure = String(error?.stack || error)
    await page.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {})
    throw error
  } finally {
    writeFileSync(join(output, 'summary.json'), JSON.stringify({ width, partial, metrics, broken, faultChecks, errors, writes, diagnostics, restored, failure }, null, 2))
    await context.close()
    await browser.close()
  }
})
