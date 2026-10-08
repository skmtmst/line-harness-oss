/**
 * 統括リッチメニューの実際の表示位置と、画像なしの面の操作をブラウザーで確かめる。
 * VISUAL_QA_BASE=<自分の撮影サーバー> node scripts/visual-qa/hq-rich-menu-position.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { PARITY_INIT } from './v8-parity.mjs'
import { RICH_MENU_GROUP_DETAILS } from './fixtures.mjs'

const output = 'scripts/visual-qa/v8-parity-out/hqrm-layout-picker'
mkdirSync(output, { recursive: true })
const browser = await chromium.launch()
try {
  for (const width of [1440, 1152, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 1300 } })
    await page.addInitScript((entries) => {
      for (const [key, value] of entries) localStorage.setItem(key, value)
    }, Object.entries(PARITY_INIT))
    const base = process.env.VISUAL_QA_BASE ?? 'http://127.0.0.1:3101'
    const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, `幅${width}の横はみ出し`)
    // 固定の見本APIは新規作成後を覚えないので、この試験だけ作成→再取得を本物と同じ形で返す。
    let createdGroup
    await page.route('**/api/rich-menu-groups', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const input = route.request().postDataJSON()
      const seed = RICH_MENU_GROUP_DETAILS['rmg-1']
      createdGroup = { ...seed, ...input, id: 'rmg-layout-picker', status: 'draft', version: 1, defaultPageId: 'picker-page-0', pages: input.pages.map((entry, index) => ({ ...seed.pages[0], ...entry, id: `picker-page-${index}`, imageR2Key: null, areas: entry.areas.map((area, areaIndex) => ({ ...area, id: `picker-area-${areaIndex}` })) })) }
      await route.fulfill({ status: 201, json: { success: true, data: { id: createdGroup.id, pages: createdGroup.pages } } })
    })
    await page.route('**/api/rich-menu-groups/rmg-layout-picker', async (route) => {
      await route.fulfill({ status: 200, json: { success: true, data: createdGroup } })
    })
    await page.goto(`${base}/rich-menus/new`)
    const storeLayouts = page.getByRole('radiogroup', { name: '面の分け方', exact: true })
    await storeLayouts.getByRole('radio', { name: '1面（面 A）', exact: true }).waitFor()
    assert.equal(await storeLayouts.getByRole('radio').count(), 7)
    await storeLayouts.getByRole('radio', { name: '1面（面 A）', exact: true }).click()
    await page.keyboard.press('ArrowRight')
    assert.ok(await storeLayouts.getByRole('radio', { name: '上下2面（面 A・B）', exact: true }).isChecked())
    await page.keyboard.press('End')
    assert.ok(await storeLayouts.getByRole('radio', { name: '6面（面 A・B・C・D・E・F）', exact: true }).isChecked())
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowDown')
    await noOverflow()
    await page.screenshot({ path: join(output, `store-${width}.png`), fullPage: true })
    await page.getByLabel('メニュー名（友だちには見えません）').fill('店の2面メニュー')
    await page.getByRole('button', { name: '次へ：ボタンの動き', exact: true }).click()
    await page.getByRole('button', { name: /^面 A、動きは/ }).waitFor()
    assert.equal(await page.getByRole('button', { name: /^面 [AB]、動きは/ }).count(), 2)
    assert.equal(await page.getByRole('button', { name: /^面 C、動きは/ }).count(), 0)

    await page.goto(`${base}/templates/edit?kind=rich_message`)
    const messageLayouts = page.getByRole('radiogroup', { name: '面の分け方', exact: true })
    await messageLayouts.getByRole('radio', { name: '1面（面 A）', exact: true }).waitFor()
    assert.equal(await messageLayouts.getByRole('radio').count(), 6)
    await messageLayouts.getByRole('radio', { name: '1面（面 A）', exact: true }).click()
    await page.keyboard.press('ArrowRight')
    assert.ok(await messageLayouts.getByRole('radio', { name: '上下2面（面 A・B）', exact: true }).isChecked())
    assert.equal(await page.getByRole('group', { name: /^面 [AB]$/ }).count(), 2)
    assert.equal(await page.getByRole('group', { name: '面 C', exact: true }).count(), 0)
    await noOverflow()
    await page.screenshot({ path: join(output, `message-${width}.png`), fullPage: true })

    await page.goto(`${base}/hq/rich-menus`)
    await page.getByRole('button', { name: 'メニューを作る', exact: true }).click()
    const hqLayouts = page.getByRole('radiogroup', { name: '面の分け方', exact: true })
    await hqLayouts.getByRole('radio', { name: '1面（面 A）', exact: true }).waitFor()
    assert.equal(await hqLayouts.getByRole('radio').count(), 7)
    await hqLayouts.getByRole('radio', { name: '1面（面 A）', exact: true }).click()
    await page.keyboard.press('ArrowRight')
    assert.ok(await hqLayouts.getByRole('radio', { name: '上下2面（面 A・B）', exact: true }).isChecked())
    await noOverflow()
    await page.screenshot({ path: join(output, `hq-${width}.png`), fullPage: true })
    await page.getByRole('radio', { name: /小さい 2500×843/ }).check()
    await page.getByRole('radio', { name: '横3面（面 A・B・C）', exact: true }).click()
    await page.getByLabel('メニュー名（友だちには見えません）').fill('表示位置の確認')
    await page.getByRole('button', { name: '次へ：ボタンの動き', exact: true }).click()
    const area = page.getByRole('button', { name: /^面 A、動きは/ })
    await area.focus()
    assert.equal(await page.getByRole('button', { name: /^面 [A-C]、動きは/ }).count(), 3)
    const bounds = await area.boundingBox()
    assert.ok(bounds?.width > 0 && bounds?.height > 0, '画像がない面も画面に置かれる')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    assert.ok(overflow <= 0, `幅${width}の横はみ出し: ${overflow}`)
    const previewToggle = page.getByRole('button', { name: 'LINEでの見え方を見る', exact: true })
    if (await previewToggle.isVisible()) await previewToggle.click()
    const preview = page.getByRole('region', { name: 'LINEでの見え方', exact: true }).filter({ visible: true })
    await preview.waitFor()
    const geometry = await preview.evaluate((root) => {
      const menu = root.querySelector('[data-line-preview-part="rich-menu"]')
      const talk = menu.previousElementSibling
      const bar = menu.nextElementSibling
      const home = bar.nextElementSibling
      const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height } }
      return { menu: box(menu), talk: box(talk), bar: box(bar), home: box(home), barText: bar.textContent, menuCount: root.querySelectorAll('[data-line-preview-part="rich-menu"]').length }
    })
    assert.equal(geometry.menuCount, 1)
    assert.equal(geometry.barText, 'メニュー')
    assert.ok(Math.abs(geometry.menu.top - geometry.talk.bottom) <= 1, 'メニューはトークの下に接する')
    assert.ok(Math.abs(geometry.menu.bottom - geometry.bar.top) <= 1, 'メニューの下にメニュー帯が接する')
    assert.ok(geometry.menu.height > 90, '小さいメニューの画像面にも高さがある')
    assert.ok(geometry.talk.height > geometry.menu.height, '日付の直下にメニューを置いていない')
    console.log(`幅${width}: 3画面の案A・キーボード・面数・横はみ出し0・トーク下のメニュー・帯1つ OK`)
    await page.close()
  }
} finally {
  await browser.close()
}
