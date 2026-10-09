/** node scripts/visual-qa/list-boundaries-regression.mjs [--self-test]
 * VISUAL_QA_BASE=<自分の見本サーバー>。境目の実際のborder・影と、道具の重なりを測る。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

export function measureListBoundaries() {
  const errors = [], boundaries = []
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
  const rect = (el) => el.getBoundingClientRect()
  for (const band of document.querySelectorAll('[data-kpi-strip][data-kpi-presentation="band"]')) {
    if (!visible(band)) continue
    const r = rect(band), frame = band.closest('[data-page-template]') ?? document.body
    for (const [edge, y] of [['top', r.top], ['bottom', r.bottom]]) {
      const lines = []
      for (const el of [frame, ...frame.querySelectorAll('*')]) {
        if (!visible(el)) continue
        const b = rect(el), s = getComputedStyle(el)
        if (b.width < r.width / 2) continue // マスの縦線、選択中タブの印は段の線ではない。
        for (const side of ['Top', 'Bottom']) {
          const w = parseFloat(s[`border${side}Width`])
          const ly = side === 'Top' ? b.top + w / 2 : b.bottom - w / 2
          if (w && Math.abs(ly - y) <= 2 && s[`border${side}Color`] !== 'rgba(0, 0, 0, 0)') {
            lines.push({ owner: el.className || el.tagName, width: w, color: s[`border${side}Color`], y: ly })
          }
        }
        // 帯の外枠を影で二重に描いても検知する（ぼかしのないinsetだけ）。
        for (const shadow of s.boxShadow.split(/,(?![^()]*\))/)) {
          const numbers = shadow.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g)?.map(parseFloat) ?? []
          if (!shadow.includes('inset') || numbers.length < 3 || numbers[0] !== 0 || numbers[2] !== 0) continue
          const ly = numbers[1] > 0 ? b.top : b.bottom
          if (Math.abs(ly - y) <= 2) lines.push({ owner: el.className, width: Math.abs(numbers[1]), color: shadow.match(/rgba?\([^)]*\)/)?.[0], y: ly })
        }
      }
      const hairline = getComputedStyle(frame).getPropertyValue('--color-hairline').trim()
      const swatch = document.createElement('i'); swatch.style.color = hairline; frame.append(swatch)
      const color = getComputedStyle(swatch).color; swatch.remove()
      boundaries.push({ edge, y, lines })
      if (lines.length !== 1 || lines[0].width !== 1 || lines[0].color !== color) errors.push({ edge, y, lines })
    }
  }
  const overlaps = []
  for (const toolbar of document.querySelectorAll('[data-template-region="toolbar"], [data-list-toolbar]')) {
    if (!visible(toolbar)) continue
    const controls = [...toolbar.querySelectorAll('button, input:not([type="hidden"])')].filter(visible)
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = rect(controls[i]), b = rect(controls[j])
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)
        overlaps.push([controls[i].getAttribute('aria-label') || controls[i].textContent, controls[j].getAttribute('aria-label') || controls[j].textContent])
    }
  }
  const footnotes = [...document.querySelectorAll('[data-page-template] [class*="footNote"]')].filter(visible).map((el) => el.textContent)
  return { errors, boundaries, overlaps, footnotes }
}

const browser = await chromium.launch({ headless: true })
try {
  if (process.argv.includes('--self-test')) {
    const page = await browser.newPage()
    await page.setContent(`<main data-page-template="list" style="--color-hairline:#dadde2;width:600px"><div style="border-bottom:1px solid #dadde2"><div data-kpi-strip data-kpi-presentation="band" style="height:80px;border-block:1px solid #dadde2"></div></div><div data-template-region="toolbar" style="position:relative;height:40px"><button style="position:absolute;left:0;width:80px">A</button><button style="position:absolute;left:50px;width:80px">B</button></div></main>`)
    const broken = await page.evaluate(measureListBoundaries)
    assert.ok(broken.errors.some((e) => e.lines.length === 2), '二重の線を見逃さない')
    assert.equal(broken.overlaps.length, 1, '選択欄の重なりを見逃さない')
    await page.locator('[data-kpi-strip]').evaluate((el) => { el.parentElement.style.borderBottom = '0'; document.querySelectorAll('button')[1].style.left = '88px' })
    const fixed = await page.evaluate(measureListBoundaries)
    assert.deepEqual(fixed.errors, [])
    assert.deepEqual(fixed.overlaps, [])
    await page.locator('[data-kpi-strip]').evaluate((el) => { el.style.boxShadow = 'inset 0 -1px 0 #dadde2' })
    assert.ok((await page.evaluate(measureListBoundaries)).errors.length, 'borderと影の二重線も落とす')
    console.log('検知器: 二重線・影・重なりを故意に作って検知済み')
  } else {
    const base = process.env.VISUAL_QA_BASE ?? 'http://127.0.0.1:3101'
    const out = process.env.LIST_BOUNDARIES_OUT ?? '.measure/dline'; mkdirSync(out, { recursive: true })
    const results = []
    const init = { 'lh-admin-theme': 'v8', lh_csrf: 'visual-qa-csrf', lh_staff_role: 'owner', lh_staff_name: 'K', lh_staff_permissions: '[]', lh_staff_view_permissions: '[]', lh_selected_account: 'visual-qa-account', lh_auth_selection_cleared: '1' }
    const routes = process.env.LIST_BOUNDARIES_ROUTES?.split(',') ?? ['/auto-replies', '/tags', '/friends', '/broadcasts', '/reminders', '/templates', '/hq', '/hq/templates', '/scenarios', '/webinars', '/events', '/contents/vars', '/rich-menus', '/form-submissions', '/contents', '/automations', '/common-actions', '/automations/runs', '/nen-campaigns', '/inflow-links', '/conversions', '/mileage', '/affiliates', '/webhooks', '/tags?tab=fields', '/tags?tab=marks', '/tags?tab=searches', '/nen/pets', '/nen/health', '/nen-members', '/friend-add-settings', '/mileage?tab=rewards', '/mileage?tab=balances', '/mileage?tab=history', '/mileage?tab=score', '/affiliates?tab=offers', '/affiliates?tab=approvals', '/affiliates?tab=payment', '/affiliates?tab=report', '/webhooks?tab=interactions', '/webhooks?tab=api-tokens', '/webhooks?tab=notify']
    for (const width of [1440, 1152]) for (const route of routes) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 })
      await context.addInitScript((entries) => { for (const [key, value] of entries) localStorage.setItem(key, value) }, Object.entries(init))
      const page = await context.newPage(), pageErrors = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      await page.goto(new URL(route, base).href, { waitUntil: 'networkidle', timeout: 60000 })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(800)
      assert.equal(new URL(page.url()).pathname.replace(/\/$/, ''), new URL(route, base).pathname)
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'v8')
      assert.ok(await page.locator('[data-page-template]').count(), `${route}:空白ではない`)
      const result = { route, width, pageErrors, ...await page.evaluate(measureListBoundaries) }
      const name = `${route.replaceAll(/[^a-zA-Z0-9-]/g, '-').slice(1)}-${width}`
      await page.screenshot({ path: `${out}/${name}.png`, fullPage: true })
      for (const [i, boundary] of result.boundaries.entries()) if (boundary.y >= 4 && boundary.y + 4 < 1000)
        await page.screenshot({ path: `${out}/${name}-line-${i}.png`, clip: { x: 260, y: boundary.y - 4, width: width - 280, height: 8 } })
      results.push(result)
      writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2))
      console.log(`${route} ${width}: 境目${result.boundaries.length} 境目違反${result.errors.length} 重なり${result.overlaps.length} 表下説明${result.footnotes.length} 実行エラー${pageErrors.length}`)
      await context.close()
    }
    writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2))
    assert.deepEqual(results.filter((r) => r.errors.length || r.overlaps.length || r.pageErrors.length || r.footnotes.length), [], '一覧の境目・道具の重なり・実行エラー')
    if (routes.includes('/auto-replies')) {
      const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } })
      await context.addInitScript((entries) => { for (const [key, value] of entries) localStorage.setItem(key, value) }, Object.entries(init))
      const page = await context.newPage()
      await page.goto(new URL('/auto-replies', base).href, { waitUntil: 'networkidle' })
      const optional = page.locator('[data-toolbar-optional]')
      await page.locator('summary[aria-label="よく使う絞り込み"]').click()
      await page.locator('button[aria-label="よく使う絞り込み"]').click()
      await page.getByRole('option', { name: 'よく使う（今月1回以上当たった）', exact: true }).click()
      assert.ok((await page.locator('button[aria-label="よく使う絞り込み"]').innerText()).includes('今月1回以上'), '畳んでも絞り込みを選べる')
      await page.keyboard.press('Escape')
      assert.equal(await optional.getAttribute('open'), null, 'Escで閉じる')
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.waitForTimeout(300)
      // 長い選択値が入らない場合は畳んだままにする。値は消さない。
      assert.ok((await page.locator('button[aria-label="よく使う絞り込み"]').textContent()).includes('今月1回以上'))
      const help = page.locator('button[aria-label="画面の説明"]')
      await help.click()
      const tip = page.locator(`[id="${await help.getAttribute('aria-describedby')}"]`)
      assert.ok((await tip.innerText()).includes('まとめて止める'), '表下の説明は「？」から読める')
      await page.keyboard.press('Escape')
      assert.equal(await tip.count(), 0)
      console.log('操作確認: …から絞り込みを選択・Escで閉じる・幅変更で値を保つ・？で説明を読む')
      await context.close()
    }
  }
} finally { await browser.close() }
