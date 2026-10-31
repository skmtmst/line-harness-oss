import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import { scanListRows } from './list-row-scan.mjs'

for (const width of [1152, 1440]) test(`a missing first tag fails at ${width}; truncation and an explicit zero limit stay valid`, async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const samples = '<span data-tag-overflow-measure aria-hidden="true" style="display:none"><span>長い先頭のタグ</span><span>常連</span></span>'
    await page.setContent(`<div data-tag-overflow style="width:120px;height:24px"><button>+2</button>${samples}</div>`)
    assert.ok((await page.evaluate(scanListRows)).failures.includes('B-190 タグ名なし'))
    await page.locator('[data-tag-overflow]').evaluate(element => {
      element.setAttribute('data-tag-overflow-max', '0')
    })
    assert.deepEqual((await page.evaluate(scanListRows)).failures, [])
    await page.locator('[data-tag-overflow]').evaluate(element => {
      element.removeAttribute('data-tag-overflow-max')
      element.insertAdjacentHTML('afterbegin', '<span title="長い先頭のタグ" style="display:inline-block;max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">長い先頭のタグ</span>')
      element.querySelector('button').textContent = '+1'
    })
    assert.deepEqual((await page.evaluate(scanListRows)).failures, [])
  } finally { await browser.close() }
})
