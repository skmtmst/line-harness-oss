/**
 * 統括リッチメニューの実際の表示位置と、画像なしの面の操作をブラウザーで確かめる。
 * VISUAL_QA_BASE=<自分の撮影サーバー> node scripts/visual-qa/hq-rich-menu-position.mjs
 */
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { PARITY_INIT } from './v8-parity.mjs'

const browser = await chromium.launch()
try {
  for (const width of [1440, 1152, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 1300 } })
    await page.addInitScript((entries) => {
      for (const [key, value] of entries) localStorage.setItem(key, value)
    }, Object.entries(PARITY_INIT))
    await page.goto(`${process.env.VISUAL_QA_BASE ?? 'http://127.0.0.1:3101'}/hq/rich-menus`)
    await page.getByRole('button', { name: 'メニューを作る', exact: true }).click()
    await page.getByRole('radio', { name: /小さい 2500×843/ }).check()
    await page.getByRole('radio', { name: '横3面', exact: true }).click()
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
    console.log(`幅${width}: 画像なしの3面・トーク下のメニュー・帯1つ OK`)
    await page.close()
  }
} finally {
  await browser.close()
}
