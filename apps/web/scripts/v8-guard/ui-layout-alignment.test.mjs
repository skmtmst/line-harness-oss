import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'

/* 追加決まり1: 操作の段は左（店作りの底は右）。本物のCSSを実ブラウザで測る。 */
const web = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const globals = web('src/app/globals.css')
const sheets = {
  sns: web('src/v8/settings/sns/sns.module.css'),
  delivery: web('src/v8/settings/delivery/delivery.module.css'),
  storeNew: web('src/v8/restaurant/store-new/store-new.module.css'),
  identity: web('src/v8/settings/ec-commerce/identity.module.css'),
  participants: web('src/v8/webinar-edit/participants.module.css'),
}
const html = (sheet, cls, button) =>
  `<style>${globals}${sheets[sheet]}body{margin:0}</style><div data-theme="v8"><main style="width:640px"><div class="${cls}"><button>${button}</button></div></main></div>`
const gaps = (page) => page.evaluate(() => {
  const box = document.querySelector('main > div').getBoundingClientRect()
  const btn = document.querySelector('button').getBoundingClientRect()
  return { left: btn.left - box.left, right: box.right - btn.right, btnWidth: btn.width, boxWidth: box.width }
})

for (const [name, sheet, cls, button] of [
  ['SNSの操作は左', 'sns', 'actions', 'Instagramにログインして続ける'],
  ['配達接続の操作は左', 'delivery', 'actions', 'つなぐ'],
  ['名寄せの続き読み込みは左', 'identity', 'more', '続きを読む'],
  ['参加者の続き読み込みは左', 'participants', 'more', '続きを読む'],
]) {
  test(`${name}（中央に戻すと赤）`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
      await page.setContent(html(sheet, cls, button))
      const good = await gaps(page)
      assert.ok(good.btnWidth < good.boxWidth - 40, `ボタンが段いっぱいに広がっている: ${JSON.stringify(good)}`)
      assert.ok(good.left < good.right - 20, `左に寄っていない: ${JSON.stringify(good)}`)
      // 感度の証拠：中央に戻すと赤になる。
      const fault = await page.addStyleTag({ content: `main > div{justify-content:center!important;align-items:center!important}` })
      const broken = await gaps(page)
      assert.ok(!(broken.left < broken.right - 20), `中央でも通ってしまう: ${JSON.stringify(broken)}`)
      await fault.evaluate((el) => el.remove())
      assert.deepEqual(await gaps(page), good)
    } finally { await browser.close() }
  })
}

test('店作りの底は右（中央に戻すと赤）', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    await page.setContent(html('storeNew', 'footer', '店舗を作る'))
    const good = await gaps(page)
    assert.ok(good.btnWidth < good.boxWidth - 40, `ボタンが段いっぱいに広がっている: ${JSON.stringify(good)}`)
    assert.ok(good.right < good.left - 20, `右に寄っていない: ${JSON.stringify(good)}`)
    const fault = await page.addStyleTag({ content: `main > div{justify-content:center!important}` })
    const broken = await gaps(page)
    assert.ok(!(broken.right < broken.left - 20), `中央でも通ってしまう: ${JSON.stringify(broken)}`)
    await fault.evaluate((el) => el.remove())
    assert.deepEqual(await gaps(page), good)
  } finally { await browser.close() }
})
