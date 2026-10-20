import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'
import { compileUiStyles } from './compile-ui-styles.mjs'
import { scanDrawerLayout } from './drawer-layout-browser.mjs'

const globals = await compileUiStyles(new URL('../../src/app/globals.css', import.meta.url).pathname)
const drawer = readFileSync(new URL('../../src/components/shared/drawer.module.css', import.meta.url), 'utf8')
for (const width of [1152, 1440, 1920]) {
  test(`full-height drawer keeps footer visible for short and long content at ${width}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      await page.setContent(`<html data-theme="v8"><style>${globals}\n${drawer}</style>
        <div class="overlay"><aside class="panel" data-m1-scope data-design-width data-height-mode="viewport" style="--drawer-design-width:480px">
          <header class="header">変更する</header><div class="body"><p>本文</p></div>
          <footer class="footer"><button>キャンセル</button><button><svg class="lucide-check" width="16" height="16"></svg>保存する</button></footer>
        </aside></div></html>`)
      const scan = () => page.evaluate(scanDrawerLayout, { fixedActions: ['キャンセル', '保存する'] })
      assert.equal((await scan()).findings.length, 0)
      await page.locator('footer').evaluate(el => el.parentElement.querySelector('.body').append(el))
      assert.equal((await scan()).findings.filter(row => row.kind === 'drawer-footer-missing').length, 1)
      await page.locator('footer').evaluate(el => el.closest('aside').append(el))
      await page.locator('.body').evaluate(el => el.insertAdjacentHTML('afterbegin', '<div style="height:1600px">長い本文</div>'))
      assert.equal((await scan()).findings.length, 0)
      await page.locator('.body').evaluate(el => el.scrollTop = el.scrollHeight)
      assert.equal((await scan()).findings.length, 0)
      await page.locator('footer').evaluate(el => el.style.transform = 'translateX(2000px)')
      await page.waitForFunction(() => document.querySelector('footer').getBoundingClientRect().left > innerWidth)
      assert.ok((await scan()).findings.some(row => row.kind === 'drawer-footer-action-hidden'))
      await page.locator('footer').evaluate(el => el.style.transform = '')
      await page.waitForFunction(() => {
        const rect = document.querySelector('footer').getBoundingClientRect()
        return rect.right <= innerWidth
      })
      assert.equal((await scan()).findings.length, 0)
    } finally { await browser.close() }
  })
}
