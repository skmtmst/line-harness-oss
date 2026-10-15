import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'
import { compileUiStyles } from './compile-ui-styles.mjs'
import { scanDialogAudit } from './dialog-layout-browser.mjs'

const globals = await compileUiStyles(new URL('../../src/app/globals.css', import.meta.url).pathname)
const dialog = readFileSync(new URL('../../src/components/shared/dialog.module.css', import.meta.url), 'utf8')
const buttons = readFileSync(new URL('../../src/components/shared/button.module.css', import.meta.url), 'utf8')
for (const width of [1152, 1440, 1920]) {
  test(`confirmation defaults keep actions framed and the panel above center at ${width}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      await page.setContent(`<html data-theme="v8"><style>${globals}\n${buttons}\n${dialog}</style><div class="overlay confirmationOverlay"><div class="panel confirmationPanel" data-m1-scope data-design-width style="--dialog-design-width:480px">
        <div class="headerRow"><h2>一時停止する</h2><button class="close">閉じる</button></div>
        <div class="content">通知と履歴は残ります。</div><div class="footer"><div class="actions" data-dialog-actions><button class="button standard secondary designButton" data-dialog-action="secondary">キャンセル</button><button class="button standard primary designButton" data-dialog-action="primary">一時停止する</button></div></div>
        </div></div><button class="button standard secondary" id="outside">本文の副ボタン</button></html>`)
      const options = { expectedWidth: 480, expectedTop: 260, viewportFit: true, fixedActions: ['キャンセル', '一時停止する'] }
      assert.equal((await page.evaluate(scanDialogAudit, options)).findings.length, 0)
      const inspectActions = () => [...document.querySelectorAll('[data-dialog-actions] button')].map(button => {
        const css = getComputedStyle(button)
        return { radius: css.borderRadius, outline: css.outlineWidth, outlineStyle: css.outlineStyle, borderColor: css.outlineColor, height: button.getBoundingClientRect().height }
      })
      const values = await page.evaluate(inspectActions)
      assert.deepEqual(values.map(value => value.radius), ['8px', '8px'])
      assert.equal(values[0].outline, '1px')
      assert.equal(values[0].borderColor, await page.locator('#outside').evaluate(el => getComputedStyle(el).outlineColor))
      assert.equal(await page.locator('#outside').evaluate(el => getComputedStyle(el).borderRadius), '10px')
      await page.locator('.actions > button').first().evaluate(el => { el.style.borderRadius = '10px'; el.style.outline = 'none' })
      assert.equal((await page.evaluate(inspectActions))[0].radius, '10px')
      assert.equal((await page.evaluate(inspectActions))[0].outlineStyle, 'none')
      await page.locator('.overlay').evaluate(el => { el.style.alignItems = 'center'; el.style.paddingTop = '16px' })
      assert.ok((await page.evaluate(scanDialogAudit, options)).findings.some(row => row.kind === 'dialog-top'))
      await page.locator('.overlay').evaluate(el => { el.style.alignItems = ''; el.style.paddingTop = '' })
      for (const height of [640, 360]) {
        await page.setViewportSize({ width, height })
        await page.waitForFunction(() => {
          const rect = document.querySelector('.panel').getBoundingClientRect()
          return rect.top <= innerHeight / 2 && rect.bottom <= innerHeight - 15
        })
        const small = await page.evaluate(scanDialogAudit, { viewportFit: true, fixedActions: ['閉じる', 'キャンセル', '一時停止する'] })
        assert.equal(small.findings.length, 0, JSON.stringify(small))
      }
    } finally { await browser.close() }
  })
}
