import './shared-surface-layout.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import { scanDialogAudit } from './dialog-layout-browser.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileUiStyles } from './compile-ui-styles.mjs'

const cssPath = fileURLToPath(new URL('../../src/app/globals.css', import.meta.url))
const globals = await compileUiStyles(cssPath)
const dialog = readFileSync(new URL('../../src/components/shared/dialog.module.css', import.meta.url), 'utf8')
const picker = readFileSync(new URL('../../src/components/shared/entity-picker.module.css', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../../src/components/shared/source-picker-dialog.module.css', import.meta.url), 'utf8')
const displayItems = readFileSync(new URL('../../src/components/shared/display-items-dialog.module.css', import.meta.url), 'utf8')
const search = readFileSync(new URL('../../src/components/shared/search-field.module.css', import.meta.url), 'utf8')

for (const width of [1152, 1440, 1920]) {
  test(`picker actions stay visible with long content at ${width}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 700 }, reducedMotion: 'reduce' })
      // 狭い窓の故障対照は340pxに固定。製品の窓の既定の高さに左右されない見本にする。
      await page.setContent(`<html><head><style>${globals}</style><style>${dialog}\n${picker}\n${search}\n${shell.replace(/\.(panel|overlay|header|footer|heading)(?=[^\w-]|$)/g, '.source$1')}</style></head><body>
        <div class="overlay"><div class="panel standardPanel" data-m1-scope data-design-width data-design-content-padding style="--dialog-design-width:640px;--dialog-design-content-padding:0">
          <div class="headerRow"><h2>テンプレートを選ぶ</h2></div>
          <div class="content" data-content-layout="form"><div class="body tpBody" style="--tpl-source-picker-body-h:340px"><section class="tpList"><div class="search"><input class="input" type="search" aria-label="名前で探す" /></div><div style="height:1600px;flex-shrink:0">候補と見え方</div></section></div></div>
          <div class="footer"><div class="tpFoot"><button>キャンセル</button><button>このテンプレートを使う</button></div></div>
        </div></div></body></html>`)
      const options = { fixedActions: ['キャンセル', 'このテンプレートを使う'], pickerControls: true }
      const normal = await page.evaluate(scanDialogAudit, options)
      assert.equal(normal.findings.length, 0)
      await page.locator('.tpList').evaluate(el => { el.scrollTop = el.scrollHeight })
      assert.equal((await page.evaluate(scanDialogAudit, options)).findings.length, 0)
      await page.locator('.footer').evaluate(el => {
        const content = document.querySelector('.content')
        el.prepend(content.firstElementChild)
        content.remove()
        el.querySelector('.tpBody').style.height = '1600px'
        el.querySelector('.tpBody').style.maxHeight = 'none'
      })
      assert.equal((await page.evaluate(scanDialogAudit, options)).findings.filter(row => row.kind === 'dialog-fixed-action-hidden').length, 2)
      await page.locator('button').first().evaluate(el => { el.remove() })
      assert.equal((await page.evaluate(scanDialogAudit, options)).findings.filter(row => row.kind === 'dialog-fixed-action-missing').length, 1)
    } finally { await browser.close() }
  })
}

for (const width of [1152, 1440, 1920]) {
  test(`positioned dialog keeps its header and actions inside the viewport at ${width}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      await page.setContent(`<style>${globals}\n${dialog}</style><div class="overlay" data-design-top data-viewport-fit style="--dialog-design-top:147px"><div class="panel" data-m1-scope data-design-width style="--dialog-design-width:560px">
        <div class="headerRow"><h2 class="title">臨時休業・貸切を足す</h2><button class="close">閉じる</button></div>
        <div class="content"><div style="height:1600px">長い本文</div><label><input type="checkbox">Googleへ登録する</label></div>
        <div class="footer"><div class="actions"><button>キャンセル</button><button>この日を閉じる</button></div></div>
      </div></div>`)
      const options = { viewportFit: true, fixedActions: ['閉じる', 'キャンセル', 'この日を閉じる'] }
      for (const height of [900, 640, 360]) {
        await page.setViewportSize({ width, height })
        await page.waitForFunction(() => {
          const rect = document.querySelector('.panel').getBoundingClientRect()
          return rect.top >= 0 && rect.bottom <= innerHeight
        })
        const normal = await page.evaluate(scanDialogAudit, options)
        assert.equal(normal.findings.length, 0, JSON.stringify(normal))
        await page.locator('.content').evaluate(el => { el.scrollTop = el.scrollHeight })
        await page.getByRole('checkbox').check()
        await page.getByRole('button', { name: 'この日を閉じる' }).click()
        assert.equal((await page.evaluate(scanDialogAudit, options)).findings.length, 0)
      }
      await page.setViewportSize({ width, height: 360 })
      await page.locator('.overlay').evaluate(el => el.style.setProperty('--dialog-design-top', '380px'))
      await page.waitForFunction(() => Math.abs(document.querySelector('.panel').getBoundingClientRect().top - (innerHeight / 2 - 16)) < 1)
      assert.equal((await page.evaluate(scanDialogAudit, options)).findings.length, 0)
      const normalHeight = await page.locator('.panel').evaluate(el => el.getBoundingClientRect().height)
      await page.locator('.panel').evaluate(el => { el.style.maxHeight = 'calc(100dvh - 32px)' })
      await page.waitForFunction(() => document.querySelector('.panel').getBoundingClientRect().bottom > innerHeight)
      const broken = await page.evaluate(scanDialogAudit, options)
      assert.equal(broken.findings.filter(row => row.kind === 'dialog-viewport-bounds').length, 1)
      assert.ok(broken.findings.some(row => row.kind === 'dialog-fixed-action-hidden'))
      await page.locator('.panel').evaluate(el => { el.style.maxHeight = '' })
      await page.waitForFunction(height => Math.abs(document.querySelector('.panel').getBoundingClientRect().height - height) < 1, normalHeight)
      const restored = await page.evaluate(scanDialogAudit, options)
      assert.equal(restored.findings.length, 0, JSON.stringify(restored))
    } finally { await browser.close() }
  })
}

for (const width of [1152, 1440, 1920]) {
}

for (const width of [1152, 1440, 1920]) {
}

for (const width of [1152, 1440, 1920]) {
}

for (const width of [1152, 1440, 1920]) {
}
