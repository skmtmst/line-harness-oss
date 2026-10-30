import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import { openPage } from './browser-env.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'
import { styleDashboardMock } from '../../../../scripts/visual-qa/style-dashboard-mock.mjs'

// 道具の段の日付の欄と選ぶ欄の、計算後の地・枠・影を比べる。
// 日付は button（全体の上塗りの透明勾配が乗る）、選ぶ欄は div（勾配なし）。
// 層の書き方は違うので、見える地（白＋影1本）が同じことを見る。
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
      bgColor: s.backgroundColor,
      border: `${s.borderTopWidth} ${s.borderTopStyle}`,
      shadow: s.boxShadow,
    }
  }
  return { date: surface(date), pick: surface(pick) }
}

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
      assert.deepEqual(found.pick.ink, [], `選ぶ欄の地に筋が無い（${found.pick.text}）`)
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
