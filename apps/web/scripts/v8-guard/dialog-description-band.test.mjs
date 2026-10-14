import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const report = JSON.parse(readFileSync(process.env.DIALOG_DESCRIPTION_REPORT || '/tmp/v8-guard/dialog-description-band.json', 'utf8'))
for (const width of [1152, 1440, 1920]) {
  test(`dialog description bands keep their tone at ${width}`, () => {
    const row = report.find(row => row.width === width)
    assert.equal(row?.orders.length, 2, 'both CSS insertion orders must be measured')
    for (const order of row.orders) {
      assert.deepEqual(order, { normal: 0, inventory: 1, layered: 1, gray: 1, body: 1,
        plainFontSize: '13px', plainLineHeight: '20px', warningUnchanged: true })
    }
  })
}
