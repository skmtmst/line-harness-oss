import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shortTextFindings } from './short-text-browser.mjs'

test('short names, times, counts and dates fail if clipped, even when a title exists', () => {
  const records = ['09 : 00', '10月1日', '有効 5', '佐々木 亮太', '対象外 12 回'].map(text => ({text, clipped:true, lines:1, title:text}))
  assert.equal(shortTextFindings(records).length,records.length)
  assert.ok(shortTextFindings(records).every(item=>item.kind==='short-text-clipped'))
})
test('a short date split over two lines fails and restoration passes', () => {
  const record={text:'10月1日',clipped:false,lines:2}
  assert.equal(shortTextFindings([record])[0].kind,'short-text-wrapped')
  assert.deepEqual(shortTextFindings([{...record,lines:1}]),[])
})

test('rendered time, count and short-name clipping is detected and restoration clears it', async () => {
  const { connectGuardBrowser } = await import('./browser-session.mjs')
  const { collectShortText } = await import('./short-text-browser.mjs')
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><input inputmode="numeric" value="09:00" style="width:20px;font:16px monospace;padding:0;border:0"><div title="対象外 12 回" style="width:20px;overflow:hidden;white-space:nowrap">対象外 12 回</div><strong style="display:block;width:24px">10月1日</strong></main>')
    const broken = shortTextFindings(await page.evaluate(collectShortText))
    assert.ok(broken.some(item => item.text === '09:00' && item.clipped))
    assert.ok(broken.some(item => item.text === '対象外 12 回' && item.clipped))
    assert.ok(broken.some(item => item.text === '10月1日' && item.lines > 1))
    await page.locator('main').evaluate(main => { for (const el of main.children) el.style.width = '240px' })
    assert.deepEqual(shortTextFindings(await page.evaluate(collectShortText)), [])
    const time = (await page.evaluate(collectShortText)).find(item => item.text === '09:00')
    await page.locator('input').evaluate((input, width) => { input.style.width = `${width}px` }, time.required - 0.25)
    assert.ok(shortTextFindings(await page.evaluate(collectShortText)).some(item => item.text === '09:00'))
    await page.locator('input').evaluate((input, width) => { input.style.width = `${width}px` }, time.required + 1)
    assert.deepEqual(shortTextFindings(await page.evaluate(collectShortText)), [])
  } finally { await browser.close() }
})

test('booking table columns follow the page contract through a narrower shared table', async () => {
  const { readFileSync } = await import('node:fs')
  const { connectGuardBrowser } = await import('./browser-session.mjs')
  const css = ['../../src/app/globals.css', '../../src/components/shared/data-table.module.css'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/:global\(([^)]+)\)/g, '$1')).join('\n')
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(`<html data-theme="v8"><style>${css}*{box-sizing:border-box}.table{width:100%}</style><main style="width:1140px;container-type:inline-size;container-name:v8-page"><section style="width:700px"><div class="frame" data-shared-part="list-table" data-column-layout data-collapse-scope="page"><table class="table"><thead><tr data-table-layout="columns"><th>名前</th><th data-cell-collapse="narrow">担当</th><th data-cell-collapse="narrow">30日</th></tr></thead><tbody><tr data-table-layout="columns"><td>初回相談</td><td data-cell-collapse="narrow">佐々木</td><td data-cell-collapse="narrow">12件</td></tr></tbody></table></div></section></main></html>`)
    const columnsVisible = () => page.locator('[data-cell-collapse]').evaluateAll(cells => cells.every(cell => cell.getBoundingClientRect().width > 0))
    assert.equal(await columnsVisible(), true, 'a narrow table in a wide page keeps optional columns')
    await page.locator('.frame').evaluate(frame => frame.removeAttribute('data-collapse-scope'))
    assert.equal(await columnsVisible(), false, 'the former nearest-container fault hides columns at the wide page')
    await page.locator('.frame').evaluate(frame => frame.setAttribute('data-collapse-scope', 'page'))
    assert.equal(await columnsVisible(), true)
    await page.locator('main').evaluate(main => { main.style.width = '852px' })
    assert.equal(await columnsVisible(), false)
    await page.locator('[data-cell-collapse]').evaluateAll(cells => cells.forEach(cell => { cell.setAttribute('data-optional-column', ''); cell.removeAttribute('data-cell-collapse') }))
    assert.equal(await page.locator('[data-optional-column]').evaluateAll(cells => cells.every(cell => cell.getBoundingClientRect().width > 0)), true, 'missing collapse metadata restores the narrow-page defect')
    await page.locator('[data-optional-column]').evaluateAll(cells => cells.forEach(cell => cell.setAttribute('data-cell-collapse', 'narrow')))
    assert.equal(await columnsVisible(), false)
  } finally { await browser.close() }
})

test('the product layout entry reports short-text defects and restoration clears them', async () => {
  const { measurePage } = await import('./layout-defects.mjs')
  const { connectGuardBrowser } = await import('./browser-session.mjs')
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><strong style="display:block;width:20px;overflow:hidden;white-space:nowrap">対象外 12 回</strong></main>')
    assert.ok((await measurePage(page)).some(item => item.kind === 'short-text-clipped'))
    await page.locator('strong').evaluate(el => { el.style.width = '200px' })
    assert.equal((await measurePage(page)).some(item => item.kind.startsWith('short-text-')), false)
  } finally { await browser.close() }
})

test('narrow time fields preserve coarse touch targets and reserve space before the clock', async () => {
  const { readFileSync } = await import('node:fs')
  const { connectGuardBrowser } = await import('./browser-session.mjs')
  const css = ['choice-field', 'time-field-v8'].map(name => readFileSync(new URL(`../../src/components/shared/${name}.module.css`, import.meta.url), 'utf8')).join('\n')
  const browser = await connectGuardBrowser()
  try {
    for (const hasTouch of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1152, height: 900 }, hasTouch })
      await page.setContent(`<style>:root{--control-h:36px;--space-4:4px;--space-8:8px;--space-24:24px;--polish-space-field:12px;--polish-icon-control:16px;--tpl-toolbar-gap:8px;--choice-ring:1px;--font-sans:Arial;--polish-control-text:13px;--polish-control-weight:500;--text-body--line-height:20px}${css}</style><main style="width:84px"><div class="root"><div class="field frame" data-choice-field data-choice-time><input class="input" role="combobox" data-choice-trigger value="09 : 00"><button class="open" data-choice-action><svg></svg></button></div></div></main>`)
      const geometry = await page.evaluate(() => {
        const button = document.querySelector('button').getBoundingClientRect()
        return { coarse: matchMedia('(pointer:coarse)').matches, width: button.width, height: button.height, inputRight: document.querySelector('input').getBoundingClientRect().right, iconLeft: document.querySelector('svg').getBoundingClientRect().left }
      })
      assert.equal(geometry.coarse, hasTouch)
      assert.equal(geometry.width, hasTouch ? 44 : 24)
      assert.equal(geometry.height, hasTouch ? 44 : 24)
      assert.ok(geometry.inputRight <= geometry.iconLeft)
      await page.close()
    }
  } finally { await browser.close() }
})

test('popup field values retain their title/ellipsis contract while ordinary action labels still fail', async () => {
  const { connectGuardBrowser } = await import('./browser-session.mjs')
  const { collectShortText } = await import('./short-text-browser.mjs')
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<main><button data-input-field aria-haspopup="dialog" title="2026年10月31日（土）" style="width:60px;overflow:hidden;white-space:nowrap">2026年10月31日（土）</button><button title="対象外 12 回" style="width:20px;overflow:hidden;white-space:nowrap">対象外 12 回</button></main>')
    const findings = shortTextFindings(await page.evaluate(collectShortText))
    assert.equal(findings.some(row => row.text.includes('2026')), false)
    assert.equal(findings.some(row => row.text === '対象外 12 回'), true)
  } finally { await browser.close() }
})

test('content tables reserve readable main names before long supplemental text without shrinking controls', async () => {
  const { readFileSync } = await import('node:fs')
  const { connectGuardBrowser } = await import('./browser-session.mjs')
  const { fitListColumns } = await import('../../src/components/shared/list-column-sizing.mjs')
  const css = readFileSync(new URL('../../src/components/shared/data-table.module.css', import.meta.url), 'utf8').replace(/:global\(([^)]+)\)/g, '$1')
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const nameTag of ['a', 'button']) {
      await page.setContent(`<style>${css}*{box-sizing:border-box}.frame{width:640px;--table-column-gap:12px;--table-column-padding:0;--table-head-padding:0;--table-head-height:40px;--table-row-height:56px;--table-head-text-size:13px;--table-body-text-size:13px;font:13px sans-serif}.table{width:100%}th,td{font:inherit}.text{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.name{padding:0;border:0;max-width:100%;font:inherit;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.action{width:36px;flex:none}.state{width:70px;flex:none}</style><main><div class="frame" data-column-layout data-column-sizing="content"><table class="table"><thead><tr data-table-layout="columns"><th data-cell-grow>流入元名</th><th>補足</th><th>次の操作</th><th>件数</th><th>状態</th><th>操作</th></tr></thead><tbody><tr data-table-layout="columns"><td data-cell-grow><${nameTag} class="name" ${nameTag === 'a' ? 'href="#" data-row-link' : 'data-part="row-name"'} title="Google広告 夏キャンペーン">Google広告 夏キャンペーン</${nameTag}></td><td><span class="text" title="友だちになっても何も起きない">友だちになっても何も起きない</span></td><td><span class="text" title="初回のご案内メッセージを配信する">初回のご案内メッセージを配信する</span></td><td data-list-number>1,284件</td><td><button class="state">受付中</button></td><td><button class="action">…</button></td></tr></tbody></table></div></main>`)
      await page.locator('.frame').evaluate(fitListColumns)
      const good = await page.locator('tbody').evaluate(body => {
        const name = body.querySelector('.name'), range = document.createRange(); range.selectNodeContents(name)
        return { nameWidth: name.getBoundingClientRect().width, textWidth: range.getBoundingClientRect().width, controls: [...body.querySelectorAll('.state,.action')].map(button => ({width:button.getBoundingClientRect().width,room:button.closest('td').getBoundingClientRect().width})), overflow: document.documentElement.scrollWidth > innerWidth }
      })
      assert.ok(good.textWidth <= good.nameWidth, JSON.stringify({nameTag,good}))
      assert.ok(good.controls.every(button => button.width <= button.room))
      assert.equal(good.overflow, false)
    }
  } finally { await browser.close() }
})
