import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scan from './owner-rules-browser.mjs'

test('浮く面の透明・半透明・すりガラスを検出し、不透明な面への復元で通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const attr of ['data-menu-portal', 'role="tooltip"', 'data-design-part="notification-panel"']) {
      await page.setContent(`<main>後ろの文字</main><div ${attr} style="position:fixed;top:40px;padding:20px">通知の内容</div>`)
      const findings = () => page.evaluate(scan).then(items => items.filter(item => item.kind === 'floating-surface-transparency'))
      assert.equal((await findings()).length, 1)
      for (const style of ['background:rgba(255,255,255,.8)', 'background:white;opacity:.8', 'background:white;backdrop-filter:blur(8px)']) {
        await page.locator('body > div').evaluate((el, style) => { el.style.cssText += ';' + style }, style)
        assert.equal((await findings()).length, 1, style)
      }
      await page.locator('body > div').evaluate(el => { el.style.cssText = 'position:fixed;top:40px;padding:20px;background:white' })
      assert.deepEqual(await findings(), [])
    }
    await page.setContent('<main>背景</main><div data-menu-portal style="position:fixed"><section role="menu" style="background:white;padding:20px">選ぶ</section></div>')
    assert.deepEqual((await page.evaluate(scan)).filter(item => item.kind === 'floating-surface-transparency'), [])
  } finally { await browser.close() }
})
