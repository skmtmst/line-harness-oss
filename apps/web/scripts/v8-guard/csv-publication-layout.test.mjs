import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { inspectCsvPublicationLayout } from './csv-publication-layout.mjs'
import { measurePage, assess } from './layout-defects.mjs'
const shell = body => `<style>body{font:13px/18px sans-serif}button{min-height:36px}.zoneTitle{font-weight:600}ul{list-style-type:'・'}</style><main>${body}</main>`
const csv = inner => `<section data-design-node="T9gblG"><div data-variant="upload" role="button" aria-label="CSVを追加" tabindex="0"><svg class="lucide-upload"></svg><p class="zoneTitle">CSVを追加</p><p class="zoneHint">ドラッグ＆ドロップ<br>クリックでも選べます<br>UTF-8のCSV</p>${inner}<input type="file" hidden></div></section>`
const publications = (marker='・', tips='') => `<section data-design-node="SyQA1"><p data-kpi-label>掲載枚数${tips}</p><aside data-part="create-summary"><h2>出すときの決めごと</h2><ul style="list-style-type:${marker === 'none' ? 'none' : "'・'"}">${['同意','名前','期限','マイル','原本'].map(x=>`<li>${x}</li>`).join('')}</ul></aside></section>`
test('CSVの内側ボタン、印の無い条件、数の題の説明が戻ると必須の測定で落ちる', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const [normal, fault] of [[csv(''), csv('<button>ファイルを選ぶ</button>')], [publications(),publications('none')], [publications(),publications('・','<button>?</button>')]]) {
      await page.setContent(shell(normal))
      assert.equal((await page.evaluate(inspectCsvPublicationLayout)).failures.length, 0)
      await page.setContent(shell(fault))
      assert.ok((await page.evaluate(inspectCsvPublicationLayout)).failures.length > 0)
      assert.ok(assess(await measurePage(page), '/fixture', 1440, []).failures.some(f => f.kind === 'csv-publication-layout'))
      await page.setContent(shell(normal))
      assert.equal((await page.evaluate(inspectCsvPublicationLayout)).failures.length, 0)
    }
  } finally { await browser.close() }
})
