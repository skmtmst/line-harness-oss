import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scan from './visual-state-browser.mjs'

test('capture proves the requested conflict instead of another validation error', async () => {
  const browser = await connectGuardBrowser()
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
