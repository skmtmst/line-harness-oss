import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scan from './form-rules-browser.mjs'

test('disabled actions require a visible reason and colour choices have one selected value', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main data-page-template="create"><button disabled>保存する</button><div data-color-palette="inline"><button role="radio" aria-checked="true">青</button><button role="radio" aria-checked="true">赤</button></div></main>')
    const failures=await page.evaluate(scan)
    assert.ok(failures.some(f=>f.kind==='form-action-reason'))
    assert.ok(failures.some(f=>f.kind==='form-color'))
    await page.locator('button:disabled').evaluate(el=>{el.title='必須の項目を入れてください'})
    await page.getByRole('radio',{name:'赤'}).evaluate(el=>el.setAttribute('aria-checked','false'))
    assert.deepEqual(await page.evaluate(scan),[])
  } finally { await browser.close() }
})
