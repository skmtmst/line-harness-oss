import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import scan from './b244-rules-browser.mjs'
const shell = body => `<style>body{margin:0}*{box-sizing:border-box}main{width:900px}input,button{height:36px}svg{width:16px;height:16px}</style><main data-page-template="list">${body}</main>`
const icon = '<svg aria-hidden="true"><path d="M1 1h10"/></svg>'
const item = (group, text, withIcon = true) => `<div data-menu-group="${group}"><button role="menuitem">${withIcon ? icon : ''}${text}</button></div>`
const cases = {
  'requirement-conflict': '<div data-form-requirement="required"><span><label>名前</label>任意</span><input required></div>',
  'field-error-missing': '<div data-form-requirement="required"><span><label>名前</label>必須</span><input aria-invalid="true"></div>',
  'menu-group-order': `<div role="menu">${item('destructive','止める')}${item('view','記録を見る')}</div>`,
  'menu-icon-missing': `<div role="menu">${item('view','記録を見る',false)}</div>`,
  'toolbar-count-position': '<div data-list-toolbar style="display:flex;width:900px"><input data-toolbar-search><select data-page-size><option>20 件</option></select></div>',
  'toolbar-unnamed-menu': '<div data-list-toolbar><button>…</button></div>',
}
const repairs = {
  'requirement-conflict': cases['requirement-conflict'].replace('任意','必須'),
  'field-error-missing': cases['field-error-missing'].replace('aria-invalid="true"','aria-invalid="true" aria-describedby="reason"') + '<p id="reason" role="alert">名前を入れてください</p>',
  'menu-group-order': `<div role="menu">${item('view','記録を見る')}${item('destructive','止める')}</div>`,
  'menu-icon-missing': `<div role="menu">${item('view','記録を見る')}</div>`,
  'toolbar-count-position': '<div data-list-toolbar style="width:900px"><input data-toolbar-search><div style="display:flex;justify-content:flex-end"><select data-page-size><option>20 件</option></select></div></div>',
  'toolbar-unnamed-menu': '<div data-list-toolbar><button>保存した条件を選ぶ</button></div>',
}
test('B-244の6種類を故障注入し、修正後は0。白い板の幅で2段を判定する', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1152, height: 900 } })
    for (const [kind, html] of Object.entries(cases)) {
      await page.setContent(shell(html))
      assert.ok((await page.evaluate(scan)).some(f => f.kind === kind), kind)
      await page.setContent(shell(repairs[kind]))
      assert.deepEqual(await page.evaluate(scan), [], kind)
    }
    const nested = '<div data-list-toolbar style="padding:24px"><div data-list-toolbar data-toolbar-layout="band" style="padding:24px"><input data-toolbar-search><div style="display:flex;justify-content:flex-end"><select data-page-size><option>20 件</option></select></div></div></div>'
    await page.setContent(shell(nested))
    assert.deepEqual(await page.evaluate(scan), [], '型と道具の内側余白を件数の左寄りと誤認しない')
    await page.setContent(shell(nested.replace('flex-end', 'flex-start')))
    assert.ok((await page.evaluate(scan)).some(f => f.kind === 'toolbar-count-position'), '内側余白があっても左へ回った件数は止める')
    await page.setContent(shell(cases['toolbar-count-position']).replace('main{width:900px}','main{width:1200px}'))
    assert.deepEqual(await page.evaluate(scan), [], '広い板の道具は1段を許す')
  } finally { await browser.close() }
})
