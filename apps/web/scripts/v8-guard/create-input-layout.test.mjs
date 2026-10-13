import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import scanFormRules from './form-rules-browser.mjs'
import collectFormLayouts, { formColumnFindings } from './form-columns-browser.mjs'
import scanOwnerRules from './owner-rules-browser.mjs'

test('名前とフォルダは板が狭い時だけ縦にし、横に戻す故障を検出する', async () => {
  const css = readFileSync(new URL('../../src/components/shared/settings-form-card.module.css', import.meta.url), 'utf8')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const [width, frameWidth] of [[1152, 900], [1440, 1200], [1920, 1600]]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<style>:root{--polish-space-field:12px}*{box-sizing:border-box}main{container:v8-page/inline-size;width:${frameWidth}px}input{width:100%}${css}</style>
        <main data-page-template="create"><div class="nameFolderRow" data-form-row="name-folder"><div data-form-requirement="required"><label>名前</label><input aria-label="名前" value="長い名前を保つ"></div><div data-form-requirement="optional"><label>フォルダ</label><input aria-label="フォルダ" value="未分類"></div></div></main>`)
      const rows = await page.evaluate(collectFormLayouts)
      assert.equal(rows.length, 1)
      assert.equal(rows[0].horizontal, frameWidth >= 1100)
      assert.deepEqual(formColumnFindings(rows), [])
      if (frameWidth < 1100) {
        await page.locator('[data-form-row]').evaluate(el => el.style.setProperty('grid-template-columns', '1fr 1fr', 'important'))
        assert.ok(formColumnFindings(await page.evaluate(collectFormLayouts)).length > 0)
      }
      assert.equal(await page.getByLabel('名前').inputValue(), '長い名前を保つ')
      assert.equal((await page.evaluate(scanFormRules)).filter(f => f.kind === 'form-row-end').length, 0)
    }
  } finally { await browser.close() }
})

test('開閉の段は題の空白を守り、内側を押し込む故障を検出する', async () => {
  const css = readFileSync(new URL('../../src/components/shared/disclosure.module.css', import.meta.url), 'utf8')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>:root{--card-edge:#ddd;--radius-card:12px;--color-canvas:#fff;--text-label:13px;--text-body:14px}*{box-sizing:border-box}details{width:400px}.body input{width:100%;height:36px}${css}</style>
      <main><details class="root compact" open><summary class="summary"><span class="title">タグ・記録などの詳しい設定</span></summary><div class="body"><label>返事</label><input aria-label="返事" value="入力を保つ"></div></details></main>`)
    assert.equal((await page.evaluate(scanOwnerRules)).filter(f => f.kind === 'tight').length, 0)
    await page.locator('.title').evaluate(el => { el.style.position = 'relative'; el.style.top = '-12px' })
    assert.ok((await page.evaluate(scanOwnerRules)).some(f => f.kind === 'tight'))
    assert.equal(await page.getByLabel('返事').inputValue(), '入力を保つ')
  } finally { await browser.close() }
})

test('行うことは欄が広くても白い板が狭ければ縦にし、横の故障を検出する', async () => {
  const css = readFileSync(new URL('../../src/components/shared/tap-action-field.module.css', import.meta.url), 'utf8')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const frameWidth of [900, 1200]) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.setContent(`<style>:root{--tap-action-gap:12px;--tap-action-kind-w:160px}main{container:v8-page/inline-size;width:${frameWidth}px}.withExtras{width:520px}input{width:100%}${css}</style>
        <main data-page-template="create"><div class="withExtras"><div class="root row"><div class="kind" data-form-requirement="optional"><label>動き</label><input aria-label="動き" value="URLを開く"></div><div class="body" data-form-requirement="optional"><label>値</label><input aria-label="値" value="https://example.com"></div></div></div></main>`)
      const rows = await page.evaluate(collectFormLayouts)
      assert.equal(rows.length, 1)
      assert.equal(rows[0].horizontal, frameWidth >= 1100)
      assert.deepEqual(formColumnFindings(rows), [])
      if (frameWidth < 1100) {
        await page.locator('.root').evaluate(el => el.style.setProperty('flex-direction', 'row', 'important'))
        assert.ok(formColumnFindings(await page.evaluate(collectFormLayouts)).length > 0)
      }
      assert.equal(await page.getByLabel('値').inputValue(), 'https://example.com')
    }
  } finally { await browser.close() }
})
