import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGuardBrowser } from './browser-session.mjs'
import scan from './rules-browser.mjs'
const shell = body => `<style>body{margin:0}*{box-sizing:border-box}main{width:900px}input,button{height:36px}svg{width:16px;height:16px}</style><main data-page-template="list">${body}</main>`
const icon = '<svg aria-hidden="true"><path d="M1 1h10"/></svg>'
const item = (group, text, withIcon = true) => `<div data-menu-group="${group}"><button role="menuitem">${withIcon ? icon : ''}${text}</button></div>`
const cases = {
  'requirement-conflict': '<div data-form-requirement="required"><span><label>名前</label>任意</span><input required></div>',
  'field-error-missing': '<div data-form-requirement="required"><span><label>名前</label>必須</span><input aria-invalid="true"></div>',
  'menu-group-order': `<div role="menu">${item('destructive','止める')}${item('view','記録を見る')}</div>`,
}
const repairs = {
  'requirement-conflict': cases['requirement-conflict'].replace('任意','必須'),
  'field-error-missing': cases['field-error-missing'].replace('aria-invalid="true"','aria-invalid="true" aria-describedby="reason"') + '<p id="reason" role="alert">名前を入れてください</p>',
  'menu-group-order': `<div role="menu">${item('view','記録を見る')}${item('destructive','止める')}</div>`,
}
test('入力の必須/任意・エラー理由・危険操作の分離を故障注入し、復旧後0を確認する', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 1152, height: 900 } })
    for (const [kind, html] of Object.entries(cases)) {
      await page.setContent(shell(html))
      assert.ok((await page.evaluate(scan)).some(f => f.kind === kind), kind)
      await page.setContent(shell(repairs[kind]))
      assert.deepEqual(await page.evaluate(scan), [], kind)
    }
  } finally { await browser.close() }
})
