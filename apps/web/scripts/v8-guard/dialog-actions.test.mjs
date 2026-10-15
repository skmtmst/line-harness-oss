import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { compileUiStyles } from './compile-ui-styles.mjs'
import { scanDialogActions } from './dialog-actions-browser.mjs'
import { scanDialogAudit } from './dialog-layout-browser.mjs'

const globals = await compileUiStyles(new URL('../../src/app/globals.css', import.meta.url).pathname)
const dialog = readFileSync(new URL('../../src/components/shared/dialog.module.css', import.meta.url), 'utf8')
for (const width of [1152, 1440, 1920]) {
  test(`inset forms and centered/split dialog actions at ${width}`, async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      await page.setContent(`<html data-theme="v8"><style>${globals}\n${dialog}</style><div class="overlay"><div class="panel standardPanel" role="dialog" data-m1-scope data-layout="inset" data-footer-align="center" data-design-width style="--dialog-design-width:560px" aria-describedby="description">
        <div class="headerRow"><div class="headerContent"><h2 class="title">プロジェクトを作る</h2><p class="description" id="description">案件ごとに作ります。</p></div><button class="close">閉じる</button></div>
        <div class="content" data-content-layout="form"><form style="width:100%"><input style="width:100%"><textarea style="width:100%"></textarea></form></div>
        <div class="footer"><div class="actions" data-dialog-actions><button>キャンセル</button><button>作って開く</button></div></div>
      </div></div>`)
      const options = { align: 'center', descriptionGap: true }
      const initial = await page.evaluate(scanDialogActions, options)
      assert.equal(initial.findings.length, 0, JSON.stringify(initial))
      const form = await page.evaluate(scanDialogAudit, { expectedWidth: 560, fullForm: true })
      assert.equal(form.findings.length, 0, JSON.stringify(form))
      assert.equal(form.inventory.filter(row => row.kind === 'input').length, 2)
      await page.locator('form').evaluate(el => { el.style.width = '180px'; el.style.maxWidth = '180px' })
      await page.waitForFunction(() => { const width = document.querySelector('input').getBoundingClientRect().width; return width > 0 && width <= 181 })
      const shrunk = await page.evaluate(scanDialogAudit, { fullForm: true })
      assert.equal(shrunk.findings.length, 2, JSON.stringify(shrunk))
      await page.locator('form').evaluate(el => { el.style.width = '100%'; el.style.maxWidth = '' })
      await page.locator('.actions').evaluate(el => el.style.justifyContent = 'flex-start')
      assert.equal((await page.evaluate(scanDialogActions, options)).findings.filter(x => x.kind === 'dialog-actions-center').length, 1)
      await page.locator('.actions').evaluate(el => el.style.justifyContent = '')
      await page.locator('.description').evaluate(el => el.style.marginTop = '24px')
      await page.waitForFunction(() => document.querySelector('.description').getBoundingClientRect().top - document.querySelector('h2').getBoundingClientRect().bottom > 16)
      const separated = await page.evaluate(scanDialogActions, options)
      assert.equal(separated.findings.filter(x => x.kind === 'dialog-title-description-gap').length, 1, JSON.stringify(separated))
      await page.locator('.description').evaluate(el => el.style.marginTop = '')
      await page.locator('.panel').evaluate(el => el.dataset.footerAlign = 'start')
      await page.locator('.actions').evaluate(el => el.insertAdjacentHTML('afterbegin', '<span class="actionLead"><button>一覧から外す</button></span>'))
      assert.equal((await page.evaluate(scanDialogActions, { leadingAction: '一覧から外す' })).findings.length, 0)
      await page.locator('.actionLead').evaluate(el => el.style.marginRight = '0')
      await page.waitForFunction(() => document.querySelector('.actions').getBoundingClientRect().right - [...document.querySelectorAll('.actions button')].at(-1).getBoundingClientRect().right > 10)
      assert.equal((await page.evaluate(scanDialogActions, { leadingAction: '一覧から外す' })).findings.length, 1)
      await page.locator('.actionLead').evaluate(el => el.remove())
      await page.locator('.panel').evaluate(el => { el.dataset.confirmPlacement = 'start' })
      const deletion = { naturalWidth: true, confirmPlacement: 'start' }
      const normalDelete = await page.evaluate(scanDialogActions, deletion)
      assert.equal(normalDelete.findings.length, 0, JSON.stringify(normalDelete))
      await page.locator('.actions > button').last().evaluate(el => { el.style.width = '300px' })
      const wide = await page.evaluate(scanDialogActions, deletion)
      assert.equal(wide.findings.filter(x => x.kind === 'dialog-action-width').length, 1)
      await page.locator('.actions > button').last().evaluate(el => { el.style.width = '' })
      await page.locator('.panel').evaluate(el => { delete el.dataset.confirmPlacement })
      assert.equal((await page.evaluate(scanDialogActions, deletion)).findings.filter(x => x.kind === 'dialog-delete-cancel-placement').length, 1)
      await page.locator('.panel').evaluate(el => { el.dataset.confirmPlacement = 'start' })
      assert.equal((await page.evaluate(scanDialogActions, deletion)).findings.length, 0)
      await page.setContent(`<html data-theme="v8"><style>${globals}\n${dialog}</style><div class="overlay" data-design-top style="--dialog-design-top:280px"><div class="panel standardPanel confirmationPanel" role="dialog" data-m1-scope data-design-layout="stacked" data-footer-align="start" data-design-width style="--dialog-design-width:480px">
        <div class="headerRow"><h2 class="title">リマインダを削除しますか？</h2><button class="close">閉じる</button></div>
        <p class="description">登録者と通知の予定が消えます。</p>
        <div class="content">削除は元に戻せません。</div>
        <div class="footer"><div class="actions" data-dialog-actions><button>削除する</button><button>キャンセル</button><button>代わりに一時停止</button></div></div>
      </div></div></html>`)
      await page.waitForFunction(() => { const r = document.querySelector('.panel').getBoundingClientRect(); return r.width === 480 && r.top === 280 })
      const compactDelete = { expectedWidth: 480, expectedTop: 280 }
      const compactNormal = await page.evaluate(scanDialogAudit, compactDelete)
      assert.equal(compactNormal.findings.length, 0, JSON.stringify(compactNormal))
      assert.equal((await page.evaluate(scanDialogActions, { align: 'start' })).findings.length, 0)
      await page.locator('.panel').evaluate(el => { el.style.setProperty('--dialog-design-width', '720px') })
      await page.waitForFunction(() => document.querySelector('.panel').getBoundingClientRect().width === 720)
      assert.equal((await page.evaluate(scanDialogAudit, compactDelete)).findings.filter(x => x.kind === 'dialog-width').length, 1)
      await page.locator('.panel').evaluate(el => { el.style.setProperty('--dialog-design-width', '480px'); el.dataset.footerAlign = 'center' })
      await page.waitForFunction(() => document.querySelector('.panel').getBoundingClientRect().width === 480)
      assert.equal((await page.evaluate(scanDialogActions, { align: 'start' })).findings.filter(x => x.kind === 'dialog-actions-start').length, 1)
      await page.locator('.panel').evaluate(el => { el.dataset.footerAlign = 'start' })
      await page.locator('.overlay').evaluate(el => { el.style.setProperty('--dialog-design-top', '320px') })
      await page.waitForFunction(() => document.querySelector('.panel').getBoundingClientRect().top === 320)
      assert.equal((await page.evaluate(scanDialogAudit, compactDelete)).findings.filter(x => x.kind === 'dialog-top').length, 1)
      await page.locator('.overlay').evaluate(el => { el.style.setProperty('--dialog-design-top', '280px') })
      await page.waitForFunction(() => document.querySelector('.panel').getBoundingClientRect().top === 280)
      assert.equal((await page.evaluate(scanDialogAudit, compactDelete)).findings.length, 0)
      await page.setContent(`<html data-theme="v8"><style>${globals}\n${dialog}</style><footer style="padding:16px 24px"><div class="actions" data-dialog-actions data-padding="none"><button>閉じる</button><button>決める</button></div></footer></html>`)
      const actionEdge = () => page.locator('[data-dialog-actions]').evaluate(el => ({ padding: getComputedStyle(el).paddingRight, gap: el.getBoundingClientRect().right - el.lastElementChild.getBoundingClientRect().right, border: getComputedStyle(el).borderTopWidth }))
      assert.deepEqual(await actionEdge(), { padding: '0px', gap: 0, border: '0px' })
      await page.locator('[data-dialog-actions]').evaluate(el => { delete el.dataset.padding })
      assert.equal((await actionEdge()).gap, 24)
      await page.locator('[data-dialog-actions]').evaluate(el => { el.dataset.padding = 'none' })
      assert.equal((await actionEdge()).gap, 0)
    } finally { await browser.close() }
  })
}
