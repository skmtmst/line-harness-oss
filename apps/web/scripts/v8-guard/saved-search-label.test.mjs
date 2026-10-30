import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scanPolish from './polish-rules-browser.mjs'

test('保存した検索の印が文字へ交差すると落ち、離した印と文字なしのボタンは通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><div style="position:relative"><svg class="lucide-bookmark" style="position:absolute;left:8px;top:8px;width:16px;height:16px"></svg><button style="height:36px;padding:0 8px">よく使う絞り込み</button></div></main>')
    const kinds = async () => (await page.evaluate(scanPolish)).filter(f => f.kind === 'saved-search-icon-overlap')
    assert.equal((await kinds()).length, 1)
    await page.locator('button').evaluate(el => { el.style.paddingLeft = '32px' })
    assert.deepEqual(await kinds(), [])
    await page.locator('button').evaluate(el => { el.style.paddingLeft = '8px'; el.textContent = '' })
    assert.deepEqual(await kinds(), [])
  } finally { await browser.close() }
})

test('保存検索の既定名が省略されると落ち、内容幅へ戻すと通る', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><button style="display:flex;gap:8px;padding:8px"><svg class="lucide-bookmark" style="width:16px;height:16px;flex:none"></svg><span data-select-value style="width:20px;overflow:hidden;white-space:nowrap">よく使う絞り込み</span></button></main>')
    const kinds = async () => (await page.evaluate(scanPolish)).filter(f => f.kind === 'saved-search-label-clipped')
    assert.equal((await kinds()).length, 1)
    await page.locator('[data-select-value]').evaluate(el => { el.style.width = 'max-content' })
    assert.deepEqual(await kinds(), [])
  } finally { await browser.close() }
})
