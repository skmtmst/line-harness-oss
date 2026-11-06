import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import scanState from './visual-state-browser.mjs'
import scanControls from './control-overlap-browser.mjs'

test('requested state is read from the visible modal instead of its background', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const expectedState = { name: '変更', requiredText: ['予約を変更', '保存する'] }
    await page.setContent('<main>予約一覧</main><section role="dialog" aria-modal="true">予約を変更<button>保存する</button></section>')
    assert.equal((await page.evaluate(scanState, { expectedState })).findings.length, 0)
    await page.locator('main').evaluate(el => { el.textContent = '予約を変更 保存する' })
    await page.locator('section').evaluate(el => { el.textContent = '別の窓' })
    assert.equal((await page.evaluate(scanState, { expectedState })).findings[0].kind, 'state-mismatch')
    await page.locator('section').evaluate(el => { el.hidden = true })
    assert.equal((await page.evaluate(scanState, { expectedState })).findings.length, 0)
    await page.locator('main').evaluate(el => { el.textContent = '予約一覧' })
    assert.equal((await page.evaluate(scanState, { expectedState })).findings[0].kind, 'state-mismatch')
  } finally { await browser.close() }
})

test('the top visible modal must have the requested state', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const expectedState = { name: '変更', requiredText: ['予約を変更'] }
    await page.setContent('<main>予約一覧</main><section role="dialog" aria-modal="true">予約を変更</section><section role="alertdialog" aria-modal="true">取り消しの確認</section>')
    assert.equal((await page.evaluate(scanState, { expectedState })).findings[0].kind, 'state-mismatch')
    await page.locator('[role="alertdialog"]').evaluate(el => { el.hidden = true })
    assert.equal((await page.evaluate(scanState, { expectedState })).findings.length, 0)
  } finally { await browser.close() }
})

test('a modal backdrop blocks the list intentionally but blocking a modal row is a defect', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><table><tr><td><button>行の操作</button></td></tr></table></main><div style="position:fixed;inset:0;background:#0008"><section role="dialog" aria-modal="true" style="position:absolute;top:100px;left:100px;background:white;padding:20px"><table><tr><td><button>窓の行の操作</button></td></tr></table><div id="block"></div></section></div>')
    assert.equal((await page.evaluate(scanControls)).length, 0)
    await page.locator('#block').evaluate(el => { el.style.cssText = 'position:absolute;inset:0;background:red' })
    assert.equal((await page.evaluate(scanControls))[0].kind, 'control-blocked')
    await page.locator('#block').evaluate(el => { el.hidden = true })
    assert.equal((await page.evaluate(scanControls)).length, 0)
  } finally { await browser.close() }
})

test('overlapping row controls inside a modal are still detected', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent('<main>一覧</main><section role="dialog" aria-modal="true"><table><tr><td><button style="position:relative;left:20px">変更</button><button>停止</button></td></tr></table></section>')
    assert.ok((await page.evaluate(scanControls)).some(item => item.kind === 'control-overlap'))
    await page.locator('button').first().evaluate(el => { el.style.left = '0' })
    assert.equal((await page.evaluate(scanControls)).length, 0)
  } finally { await browser.close() }
})

test('independent form inputs may use any column count but cannot overlap or block each other', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent('<main data-page-template="create"><input aria-label="名前" style="width:200px"><input aria-label="フォルダ" style="width:200px"></main>')
    assert.deepEqual(await page.evaluate(scanControls), [])
    await page.locator('input').last().evaluate(el=>{el.style.marginLeft='-100px'})
    assert.ok((await page.evaluate(scanControls)).some(f=>f.kind==='control-overlap'))
    await page.locator('input').last().evaluate(el=>{el.style.marginLeft=''})
    assert.deepEqual(await page.evaluate(scanControls), [])
  } finally { await browser.close() }
})
