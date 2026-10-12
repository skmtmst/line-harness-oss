import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import scanFixPatterns from './fix-patterns-browser.mjs'

test('F1/F2/F3/F7/F9/F10 count defects, preserve presence and ignore truncated names', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}section{width:852px}button{height:36px}th{white-space:nowrap}table{width:100%}</style><section data-page-template="list" data-design-node="fixture" data-height-mode="content">
      <header data-template-region="heading"><h2>一覧</h2><button aria-label="一覧の説明">?</button></header>
      <div data-template-region="toolbar" style="display:flex;gap:8px"><button><span data-select-value style="display:block;white-space:nowrap;width:40px;overflow:hidden">フォルダ：すべての情報</span></button><input type="search" style="width:70px" placeholder="名前・本文から探す"><span data-list-sort><button>↓</button></span></div>
      <table><tbody><tr><td data-list-name-cell><span data-list-name style="display:block;width:50px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">省略してよい長い名前</span></td><td><span data-list-date-time style="display:block;width:55px">09/30 14:12</span></td><td><span data-unknown-value>種類を確認できません</span></td><td><button>直す</button></td></tr></tbody></table>
      <aside data-template-region="folders">フォルダ</aside><div data-kpi-strip><button data-row-menu>…</button></div></section>`)
    const before = await page.evaluate(scanFixPatterns)
    for (const pattern of ['F1','F2','F3','F4','F7','F8','F9','F10']) assert.ok(before.counts[pattern] > 0, pattern)
    assert.equal(before.inventory[0].help[0], '一覧の説明')
    assert.ok(!before.findings.some(f => ['F1','F2'].includes(f.pattern) && f.text.includes('省略してよい')))
    await page.evaluate(() => {
      document.querySelector('[data-page-template]').setAttribute('data-list-skeleton','templates')
      document.querySelector('[data-select-value]').style.width='200px'
      document.querySelector('input').style.width='240px'
      document.querySelector('[data-list-date-time]').style.width='120px'
      document.querySelector('[data-unknown-value]').textContent='—'
      document.querySelector('td button').textContent='編集する'
      document.querySelector('[data-list-sort]').innerHTML='<button><span data-select-value>並び：新しい順</span></button>'
      document.querySelector('aside').hidden=true
      document.querySelector('[data-row-menu]').remove()
    })
    const after = await page.evaluate(scanFixPatterns)
    assert.ok(Object.values(after.counts).every(n => n === 0), JSON.stringify(after.findings))
  } finally { await browser.close() }
})
