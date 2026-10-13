import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import collectFormLayouts, { formColumnFindings } from './form-columns-browser.mjs'

test('all independent inputs remain in the inventory after the shared layout collapses', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>section{width:900px}.inputs{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}</style><main><section data-page-template="create"><div class="inputs">${['名前','件数','開始','終了'].map(label=>`<div data-form-requirement><label>${label}<input aria-label="${label}"></label></div>`).join('')}</div></section></main>`)
    const before = await page.evaluate(collectFormLayouts)
    assert.equal(before.length, 1)
    assert.equal(before[0].children, 4)
    assert.equal(formColumnFindings(before).length, 1)
    await page.addStyleTag({ content: '.inputs{grid-template-columns:1fr}' })
    const after = await page.evaluate(collectFormLayouts)
    assert.equal(after.length, 1)
    assert.deepEqual(after[0].labels, before[0].labels)
    assert.equal(formColumnFindings(after).length, 0)
    await page.addStyleTag({ content: '.inputs{grid-template-columns:repeat(2,1fr)}' })
    assert.equal(formColumnFindings(await page.evaluate(collectFormLayouts)).length, 1)
  } finally { await browser.close() }
})

test('compound input internals and separate content regions are distinct from independent fields', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent('<style>section{width:900px}div{display:flex;gap:12px}</style><main><section data-page-template="create"><div><div data-form-requirement><label>日時</label><div><input aria-label="日付"><input aria-label="時刻"></div></div><div data-form-requirement><label>金額</label><div><input aria-label="金額"><span>円</span></div></div></div></section></main>')
    const rows = await page.evaluate(collectFormLayouts)
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0].labels, ['日時', '金額'])
    assert.equal(formColumnFindings(rows).length, 1)
    await page.locator('[data-page-template]').evaluate(el => el.style.width = '1200px')
    assert.equal(formColumnFindings(await page.evaluate(collectFormLayouts)).length, 0)
    await page.locator('[data-page-template]').evaluate(el => el.dataset.pageTemplate = 'settings')
    assert.equal(formColumnFindings(await page.evaluate(collectFormLayouts)).length, 0)
  } finally { await browser.close() }
})
