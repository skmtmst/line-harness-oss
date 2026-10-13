import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import scan from './visual-state-browser.mjs'

test('painted preview ground is checked independently of its media card', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><aside data-template-region="preview" style="background:#f7f8fa;padding:24px"><article style="background:white">LINE見本</article></aside></main>')
    assert.equal((await page.evaluate(scan)).findings[0].kind, 'preview-background')
    await page.locator('aside').evaluate(el => { el.style.background = 'white'; el.querySelector('article').style.background = '#eef3f8' })
    assert.equal((await page.evaluate(scan)).findings.length, 0)
    await page.locator('aside').evaluate(el => { el.hidden = true })
    assert.equal((await page.evaluate(scan)).coverage.previews, 0)
  } finally { await browser.close() }
})

test('avatar and name share a line while a secondary description may sit below', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><table><tr><td><div id="person"><span data-avatar style="display:block;width:32px;height:32px">K</span><div><span>Kenta</span><p>説明の2行目</p></div></div></td></tr></table></main>')
    assert.equal((await page.evaluate(scan)).findings[0].kind, 'person-name-stacked')
    await page.locator('#person').evaluate(el => { el.style.display = 'flex'; el.style.alignItems = 'flex-start' })
    const after = await page.evaluate(scan)
    assert.equal(after.findings.length, 0)
    assert.equal(after.people[0].name, 'Kenta')
  } finally { await browser.close() }
})

test('capture proves the requested conflict instead of another validation error', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const expectedState = { name: '同時保存', requiredText: ['ほかの人が先に保存'], forbiddenText: ['紹介コードが使われています'] }
    await page.setContent('<main><p role="alert">紹介コードが使われています</p></main>')
    assert.equal((await page.evaluate(scan, { expectedState })).findings[0].kind, 'state-mismatch')
    await page.locator('p').evaluate(el => { el.textContent = 'ほかの人が先に保存しました' })
    const after = await page.evaluate(scan, { expectedState })
    assert.equal(after.findings.length, 0)
    assert.equal(after.state.requested, '同時保存')
    assert.equal((await page.evaluate(scan)).coverage.state, null, 'unspecified state is unmeasured')
    assert.equal((await page.evaluate(scan, { expectedState: { name: '同時保存' } })).findings[0].kind, 'state-mismatch')
  } finally { await browser.close() }
})
