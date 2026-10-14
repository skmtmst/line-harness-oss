import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const measurements = JSON.parse(readFileSync(process.env.RICH_MENU_FONT_OUTPUT || '/tmp/v8-guard/rich-menu-fonts.json', 'utf8'))
test('記号の文字の大きさを3幅の実ブラウザで計算し、巨大な字に戻さない', () => {
  assert.deepEqual(measurements.map(result => result.width), [1152, 1440, 1920])
  for (const { sizes } of measurements) {
    assert.equal(sizes.length, 4)
    for (const size of sizes) {
      assert.ok(Number.isFinite(size))
      assert.ok(size >= 9)
      assert.ok(size <= 14)
    }
  }
})
