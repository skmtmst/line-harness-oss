import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'
import scanInsertTokenFit from './insert-token-fit-browser.mjs'
import { measurePage } from './layout-defects.mjs'

test('long insert labels keep their full explanation and fit narrow editors and previews', async () => {
  const css = readFileSync(new URL('../../src/components/shared/insert-text-field.module.css', import.meta.url), 'utf8')
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const label = '予約と事前の確認が必要なお客さまのための専用予約ページ'
    await page.setContent(`<style>${css}:root{--polish-icon-control:16px}*{box-sizing:border-box} .host{display:block;width:120px;font:13px sans-serif}</style><main><div class="host" contenteditable="true"><span class="chip" contenteditable="false" data-token="{{var.reservation_url}}" title="共通情報「${label}」の値"><svg class="chipIcon"></svg><span class="chipLabel">${label}</span></span></div><div class="host" style="width:80px"><span class="chip" data-token="{{var.reservation_url}}" title="${label}"><svg class="chipIcon"></svg><span class="chipLabel">${label}</span></span></div></main>`)
    assert.deepEqual(await page.evaluate(scanInsertTokenFit), [])
    const labels = await page.locator('.chipLabel').evaluateAll(nodes => nodes.map(node => ({ truncated: node.scrollWidth > node.clientWidth, overflow: getComputedStyle(node).overflowX, ellipsis: getComputedStyle(node).textOverflow, full: node.parentElement.title.includes(node.textContent) })))
    assert.ok(labels.every(label => label.truncated && label.overflow === 'hidden' && label.ellipsis === 'ellipsis' && label.full))
    const broken = await page.addStyleTag({ content: '.chip{max-width:none}.chipLabel{overflow:visible;text-overflow:clip}' })
    assert.equal((await page.evaluate(scanInsertTokenFit)).length, 2)
    await broken.evaluate(node => node.remove())
    assert.deepEqual(await page.evaluate(scanInsertTokenFit), [])
  } finally { await browser.close() }
})

test('the full-page entry keeps the insert label detector connected and omission fails', async () => {
  const verify = async measure => {
    const marker = { kind: 'insert-token-overflow', target: '[data-token]', text: '確認用' }
    const page = { evaluate: async (fn, argument) => argument ?? (fn === scanInsertTokenFit ? [marker] : []) }
    assert.ok((await measure(page)).some(finding => finding.kind === marker.kind))
  }
  await verify(measurePage)
  await assert.rejects(verify(async () => []), assert.AssertionError)
})
