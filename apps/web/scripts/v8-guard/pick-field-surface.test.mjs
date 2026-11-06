import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import { openPage } from './browser-env.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'
import { styleDashboardMock } from '../../../../scripts/visual-qa/style-dashboard-mock.mjs'

// 道具の段の日付の欄と選ぶ欄の、計算後の地・枠・影を比べる。
// 文字を打つ日付は平ら、押して選ぶ欄は共通の白い薄い勾配。枠・影はそろえる。
function toolbarSurfaces() {
  const date = [...document.querySelectorAll('button')].find((b) => /月\d+日/.test(b.innerText || ''))
  const pick = document.querySelector('[data-entity-picker-field] [data-choice-field]')
  if (!date || !pick) return { date: null, pick: null }
  // 勾配の中の、透明でも白でもない色（見える筋）だけ抜く。
  const visibleInk = (bgImage) => {
    if (!bgImage || bgImage === 'none') return []
    const inks = []
    const pattern = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)|color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/g
    for (const m of bgImage.matchAll(pattern)) {
      const nums = m.slice(1).filter((v) => v !== undefined).map(Number)
      let r, g, b, a
      if (m[0].startsWith('color(')) { [r, g, b] = nums; a = nums[3] ?? 1; r *= 255; g *= 255; b *= 255 } else { [r, g, b] = nums; a = nums[3] ?? 1 }
      if (a > 0 && !(r === 255 && g === 255 && b === 255)) inks.push(m[0])
    }
    return inks
  }
  const surface = (el) => {
    const s = getComputedStyle(el)
    return {
      text: (el.innerText || '').slice(0, 16),
      ink: visibleInk(s.backgroundImage),
      image: s.backgroundImage,
      surface: el.getAttribute('data-choice-surface'),
      bgColor: s.backgroundColor,
      border: `${s.borderTopWidth} ${s.borderTopStyle}`,
      shadow: s.boxShadow,
    }
  }
  return { date: surface(date), pick: surface(pick) }
}

// 全画面の走査：押して選ぶ欄は指定の白い勾配、文字を打つ欄は平ら。
// 日付・選ぶ・探す・文字入力・絞り札。押下・hover・誤り・無効は別決まりなので数えない。
function sweepInk() {
  const els = [...document.querySelectorAll(
    '[data-choice-field], [class*="date-field_field"], [class*="select_trigger"], [class*="text-field_field"], [class*="search_search"], .v6-filter-chip'
  )]
  const visibleInk = (bgImage) => {
    if (!bgImage || bgImage === 'none') return []
    const inks = []
    const pattern = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)|color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/g
    for (const m of bgImage.matchAll(pattern)) {
      const nums = m.slice(1).filter((v) => v !== undefined).map(Number)
      let r, g, b, a
      if (m[0].startsWith('color(')) { [r, g, b] = nums; a = nums[3] ?? 1; r *= 255; g *= 255; b *= 255 } else { [r, g, b] = nums; a = nums[3] ?? 1 }
      if (a > 0 && !(r === 255 && g === 255 && b === 255)) inks.push(m[0])
    }
    return inks
  }
  const bad = []
  let count = 0
  for (const el of els.slice(0, 80)) {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    if (el.matches(':hover')) continue
    if (el.getAttribute('aria-pressed') === 'true') continue
    if (el.getAttribute('aria-invalid') === 'true' || el.hasAttribute('data-invalid') || el.disabled) continue
    count += 1
    const image = getComputedStyle(el).backgroundImage
    const ink = visibleInk(image)
    const isChoice = el.getAttribute('data-choice-surface') === 'select'
    if (isChoice ? image !== 'linear-gradient(rgb(255, 255, 255), rgb(250, 250, 252))' : ink.length > 0) {
      bad.push({
        label: ((el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ')).slice(0, 24),
        cls: String(el.className.baseVal !== undefined ? '' : el.className).split(' ').map((c) => c.split('__')[0]).join(' ').slice(0, 60),
        ink, image, surface: isChoice ? 'select' : 'input',
      })
    }
  }
  return { count, bad }
}

const SWEEP_ROUTES = [
  ['friends', '/friends'], ['broadcasts', '/broadcasts'], ['scenarios', '/scenarios'],
  ['templates', '/templates'], ['settings', '/settings'], ['hq', '/hq'], ['chats', '/chats'],
  ['booking', '/booking/bookings'], ['broadcast-new', '/broadcasts/new'], ['staff', '/staff'],
]

test('全画面の選ぶ欄は白い勾配、文字を打つ欄は平ら', async () => {
  const browser = await connectGuardBrowser()
  try {
    const adapter = { newPage: async (options) => { const p = await browser.newPage(options); await stubApi(p, mockFetch); return p } }
    let total = 0
    for (const [name, route] of SWEEP_ROUTES) {
      const page = await openPage(adapter, { baseUrl: process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310', route, width: 1440, stable: true, requireSuccess: true })
      try {
        const found = await page.evaluate(sweepInk)
        total += found.count
        assert.deepEqual(found.bad, [], `${name}の欄の地が役割と一致する`)
      } finally {
        await page.close().catch(() => {})
      }
    }
    assert.ok(total > 20, `欄を数えていない（${total}）`)
  } finally {
    await browser.close()
  }
})

for (const style of ['restaurant', 'salon', 'consult', 'lesson']) {
  test(`店の道具の段は日付と選ぶ欄が同じ白い地・枠・影（${style}）`, async () => {
    styleDashboardMock('PUT', '/api/dashboard/style', new URLSearchParams(), { style })
    const browser = await connectGuardBrowser()
    let page
    try {
      const adapter = { newPage: async (options) => { const p = await browser.newPage(options); await stubApi(p, mockFetch); return p } }
      page = await openPage(adapter, { baseUrl: process.env.V8_GUARD_BASE || 'http://127.0.0.1:4310', route: '/', width: 1440, stable: true, requireSuccess: true })
      const found = await page.evaluate(toolbarSurfaces)
      assert.ok(found.date, '日付の欄がある（消して違反0にしない）')
      assert.ok(found.pick, '選ぶ欄がある（消して違反0にしない）')
      assert.equal(found.pick.surface, 'select', '選ぶ欄の役割が付いている')
      assert.equal(found.pick.image, 'linear-gradient(rgb(255, 255, 255), rgb(250, 250, 252))', `選ぶ欄は白い薄い勾配（${found.pick.text}）`)
      assert.deepEqual(found.date.ink, [], `日付の欄の地に筋が無い（${found.date.text}）`)
      assert.equal(found.pick.bgColor, found.date.bgColor, '地の色が同じ')
      assert.equal(found.pick.border, found.date.border, '枠が同じ')
      assert.equal(found.pick.shadow, found.date.shadow, '影が同じ')
    } finally {
      await page?.close().catch(() => {})
      await browser.close()
    }
  })
}
