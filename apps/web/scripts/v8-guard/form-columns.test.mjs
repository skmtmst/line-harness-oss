import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'
import collectFormLayouts, { formColumnFindings } from './form-columns-browser.mjs'

const css = readFileSync(new URL('../../src/components/shared/settings-form-card.module.css', import.meta.url), 'utf8')
const field = name => `<div data-form-requirement="optional"><label>${name}</label><input aria-label="${name}"></div>`
const pageHtml = (styles, content) => `<style>:root{--polish-space-field:12px;--tpl-hq-form-gap:12px}*{box-sizing:border-box}body{margin:0}.frame{container:v8-page/inline-size;width:calc(100vw - 248px)}input{width:100%;height:32px}${styles}</style><main><div class="frame" data-page-template="create">${content}</div></main>`
const check = async page => formColumnFindings(await page.evaluate(collectFormLayouts))

test('共通の2欄・4欄の2列・3欄の期間は広い時を保ち、1152では1列', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    const content = `<div class="row">${field('名前')}${field('紹介コード')}</div>
      <div class="columnsRow" data-form-columns="2">${field('間かく')}${field('曜日')}${field('時刻')}<div data-form-requirement="optional"><label>期間</label><button aria-pressed="true">30日</button><button aria-pressed="false">90日</button></div></div>
      <div class="columnsRow" data-form-columns="3">${field('始まり')}${field('終わり')}${field('期間外')}</div>`
    for (const width of [1440, 1152, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(pageHtml(css, content))
      const rows = await page.evaluate(collectFormLayouts)
      assert.deepEqual(rows.map(row => row.children), [2, 4, 3])
      assert.deepEqual(await check(page), [])
      assert.ok(rows.every(row => row.horizontal === (width !== 1152)))
    }
    await page.setViewportSize({ width: 1152, height: 900 })
    await page.setContent(pageHtml(css.replaceAll('width < 1100px', 'width < 1px'), content))
    assert.equal((await check(page)).length, 3)
  } finally { await browser.close() }
})

test('部品名の無い4欄の2列と、入れ子の数値欄も数える', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 1152, height: 900 } })
    const number = '<div data-form-requirement="required"><label>件数</label><div data-form-requirement="optional"><span><input type="number"><span>件</span></span></div></div>'
    await page.setContent(pageHtml('.arbitrary{display:grid;grid-template-columns:1fr 1fr;gap:12px}', `<div class="arbitrary">${number}${field('しきい値')}${field('日数')}${field('最低件数')}</div>`))
    const rows = await page.evaluate(collectFormLayouts)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].children, 4)
    assert.equal((await check(page)).length, 1)
  } finally { await browser.close() }
})

test('1欄の内部の時・分・単位と、ラジオの選択肢は独立した2欄に数えない', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 1152, height: 900 } })
    await page.setContent(pageHtml('.pair{display:grid;grid-template-columns:1fr 1fr}', `<div data-form-requirement="required"><label>開始時刻</label><div class="pair"><div><input aria-label="時"></div><div><input aria-label="分"></div></div></div><div class="pair" role="radiogroup"><label><input type="radio">定額</label><label><input type="radio">割合</label></div>`))
    assert.deepEqual(await page.evaluate(collectFormLayouts), [])
    assert.deepEqual(await check(page), [])
  } finally { await browser.close() }
})

test('all independent inputs remain in the inventory after the shared layout collapses', async () => {
  const browser = await connectGuardBrowser()
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
  const browser = await connectGuardBrowser()
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
