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
const search = readFileSync(new URL('../../src/components/shared/search-field.module.css', import.meta.url), 'utf8')

for (const width of [1152, 1440, 1920]) {
  test(`picker actions stay visible with long content at ${width}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 700 }, reducedMotion: 'reduce' })
      await page.setContent(`<html><head><style>${globals}</style><style>${dialog}\n${picker}\n${search}\n${shell.replace(/\.(panel|overlay|header|footer|heading)(?=[^\w-]|$)/g, '.source$1')}</style></head><body>
        <div class="overlay"><div class="panel standardPanel" data-m1-scope data-design-width data-design-content-padding style="--dialog-design-width:640px;--dialog-design-content-padding:0">
          <div class="headerRow"><h2>テンプレートを選ぶ</h2></div>
          <div class="content" data-content-layout="form"><div class="body tpBody"><section class="tpList"><div class="search"><input class="input" type="search" aria-label="名前で探す" /></div><div style="height:1600px;flex-shrink:0">候補と見え方</div></section></div></div>
          <div class="footer"><div class="tpFoot"><button>キャンセル</button><button>このテンプレートを使う</button></div></div>
        </div></div></body></html>`)
      const options = { fixedActions: ['キャンセル', 'このテンプレートを使う'], pickerControls: true }
      const normal = await page.evaluate(scanDialogAudit, options)
      assert.equal(normal.findings.length, 0)
      assert.equal(await page.locator('.tpBody').evaluate(el => el.getBoundingClientRect().height), 340)
      assert.equal(normal.inventory.filter(row => row.kind === 'fixed-action').length, 2)
      await page.locator('.search').evaluate(el => { el.style.flexShrink = '1' })
      await page.waitForFunction(() => document.querySelector('.search').getBoundingClientRect().height < 35)
      assert.equal(await page.locator('.search').evaluate(el => getComputedStyle(el).flexShrink), '1')
      assert.equal((await page.evaluate(scanDialogAudit, options)).findings.filter(row => row.kind === 'dialog-search-height').length, 1)
      await page.locator('.search').evaluate(el => { el.style.flexShrink = '' })
      await page.waitForFunction(() => document.querySelector('.search').getBoundingClientRect().height === 36)
      await page.locator('.tpList').evaluate(el => { el.scrollTop = el.scrollHeight })
      assert.equal((await page.evaluate(scanDialogAudit, options)).findings.length, 0)
      await page.locator('.footer').evaluate(el => {
        const content = document.querySelector('.content')
        el.prepend(content.firstElementChild)
        content.remove()
        el.querySelector('.tpBody').style.height = '1600px'
        el.querySelector('.tpBody').style.maxHeight = 'none'
      })
      assert.equal(await page.locator('.tpBody').evaluate(el => el.getBoundingClientRect().height), 1600)
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
          return Math.abs(rect.top - 147) < 1 && rect.bottom <= innerHeight - 15
        })
        const normal = await page.evaluate(scanDialogAudit, options)
        assert.equal(normal.findings.length, 0, JSON.stringify(normal))
        assert.equal(await page.locator('.panel').evaluate(el => el.getBoundingClientRect().top), 147)
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
  test(`dialog widths and nested input widths at ${width}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      await page.setContent(`<style>*{box-sizing:border-box}#panel{width:560px}#content{padding:24px;width:100%}#field{width:100%;display:flex;flex-direction:column}input,textarea{width:100%}</style><div id="panel" data-m1-scope role="dialog"><div id="content" data-content-layout="form"><div data-form-requirement="required" id="field"><label>理由<textarea></textarea></label><input></div></div></div>`)
      const normal = await page.evaluate(scanDialogAudit, { expectedWidth: 560, fullForm: true })
      assert.equal(normal.findings.length, 0)
      assert.equal(normal.inventory.filter(x => x.kind === 'input').length, 2)
      const unspecified = await page.evaluate(scanDialogAudit, { expectedWidth: null })
      assert.equal(unspecified.findings.length, 0)
      await page.locator('#panel').evaluate(el => {
        const button = document.createElement('button')
        button.textContent = '理由を見る'
        el.append(button)
      })
      const explained = await page.evaluate(scanDialogAudit, { requiredAction: '理由を見る' })
      assert.equal(explained.findings.length, 0)
      await page.locator('button').evaluate(el => { el.textContent = '止める' })
      const mislabeled = await page.evaluate(scanDialogAudit, { requiredAction: '理由を見る' })
      assert.equal(mislabeled.findings.filter(x => x.kind === 'dialog-action-label').length, 1)
      await page.locator('#panel').evaluate(el => { el.style.width = '720px' })
      const wider = await page.evaluate(scanDialogAudit, { expectedWidth: 560 })
      assert.equal(wider.findings.filter(x => x.kind === 'dialog-width').length, 1)
      await page.locator('#panel').evaluate(el => { el.style.width = '480px' })
      const narrower = await page.evaluate(scanDialogAudit, { expectedWidth: 560 })
      assert.equal(narrower.findings.filter(x => x.kind === 'dialog-width').length, 1)
      await page.locator('#panel').evaluate(el => { el.style.width = '560px' })
      await page.locator('#field').evaluate(el => { el.style.width = '300px' })
      const shrunk = await page.evaluate(scanDialogAudit, { expectedWidth: 560, fullForm: true })
      assert.equal(shrunk.findings.filter(x => x.kind === 'dialog-input-width').length, 2)
      await page.locator('#panel').evaluate(el => {
        const header = document.createElement('div')
        header.innerHTML = '<h2 style="margin:0">止める</h2>'
        el.prepend(header)
        const description = document.createElement('p')
        description.id = 'dialog-description'
        description.style.margin = '0'
        description.textContent = '止めているあいだ配信されません。あとで再開できます。'
        header.after(description)
        el.setAttribute('aria-describedby', description.id)
      })
      const padded = await page.evaluate(scanDialogAudit, { compactBody: true })
      assert.equal(padded.findings.filter(x => x.kind === 'dialog-header-body-gap').length, 1)
      await page.locator('#content').evaluate(el => { el.style.paddingTop = '0'; el.style.marginTop = '14px' })
      const compact = await page.evaluate(scanDialogAudit, { compactBody: true })
      assert.equal(compact.findings.filter(x => x.kind === 'dialog-header-body-gap').length, 0)
    } finally {
      await browser.close()
    }
  })
}

for (const width of [1152, 1440, 1920]) {
  test(`dialog description occupies the full body below its heading at ${width}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      await page.setContent(`<style>${globals}</style><style>${dialog}</style><div class="panel" data-design-width style="--dialog-design-width:480px" data-m1-scope data-description-band="danger" aria-describedby="band-text">
        <div class="headerRow"><div class="headerContent"><h2 class="title">接続を解除しますか？</h2></div><button>×</button></div>
        <div class="descriptionBand"><div class="callout calloutDanger" data-qa-dialog-callout><p class="description" id="band-text">書き出しが止まります。シートの中身は消えません。この操作は取り消せません。</p></div></div></div>`)
      const normal = await page.evaluate(scanDialogAudit, { expectedWidth: 480 })
      assert.equal(normal.findings.length, 0, JSON.stringify(normal))
      assert.equal(await page.locator('#band-text').evaluate(el => el.getBoundingClientRect().height), 17)
      await page.locator('[data-qa-dialog-callout]').evaluate(el => document.querySelector('.headerContent').append(el))
      const broken = await page.evaluate(scanDialogAudit)
      assert.equal(broken.findings.filter(row => row.kind === 'dialog-description-band-width').length, 1)
      assert.equal(broken.findings.filter(row => row.kind === 'dialog-description-band-gap').length, 1)
    } finally { await browser.close() }
  })

  test(`dialog choice cards use three equal columns within the body at ${width}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const radio = readFileSync(new URL('../../src/components/shared/radio-card.module.css', import.meta.url), 'utf8')
      await page.setContent(`<style>${globals}</style><style>${radio}</style><div data-m1-scope style="width:480px;padding:24px"><fieldset class="group"><legend>座れる卓</legend><div class="items" data-choice-columns="3" style="--choice-columns:3">${Array.from({length:5}, (_, index) => `<label class="card" data-choice-card><span class="title">T${index+1}</span><p class="note">2名席</p></label>`).join('')}</div></fieldset></div>`)
      const normal = await page.evaluate(scanDialogAudit)
      assert.equal(normal.findings.length, 0, JSON.stringify(normal))
      await page.locator('[data-choice-columns]').evaluate(el => { el.style.gridTemplateColumns = 'repeat(3, 160px)' })
      const broken = await page.evaluate(scanDialogAudit)
      assert.equal(broken.findings.filter(row => row.kind === 'dialog-choice-card-overflow').length, 1)
    } finally { await browser.close() }
  })
}
