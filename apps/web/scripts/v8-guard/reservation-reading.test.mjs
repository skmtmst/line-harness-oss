import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessReservationReading } from './reservation-reading-browser.mjs'

const normal = () => ({ panels: [{ width: 852, height: 636, cardWidth: 852, cardHeight: 636 }], names: [{
  text: '18:00 名前の長いお客さま', label: '18:00 名前の長いお客さま', title: '18:00 名前の長いお客さま',
  shared: true, singleLine: true, ellipsis: true, tooltip: true, width: 70, available: 70, contained: true,
}] })
test('詳細は型の幅を使い、予約名を省略しても全文を確認できる', () => {
  assert.equal(assessReservationReading(normal()).length, 0)
})
test('詳細の固定400pxが狭幅で残ると落ちる', () => {
  const measured = normal(); measured.panels[0].cardWidth = 400
  assert.equal(assessReservationReading(measured).length, 1)
})
test('図面に合わせて詳細の見えない欄が伸びると落ちる', () => {
  const measured = normal(); measured.panels[0].height = 900
  assert.equal(assessReservationReading(measured).length, 1)
})
test('予約名が内側の幅を越えると落ちる', () => {
  const measured = normal(); measured.names[0].width = 92
  assert.equal(assessReservationReading(measured).length, 1)
})
test('全文・共通の省略・一行のどれが欠けても落ちる', () => {
  for (const [key, value] of [['title', '18:00…'], ['label', '18:00…'], ['shared', false], ['singleLine', false], ['ellipsis', false], ['tooltip', false], ['contained', false]]) {
    const measured = normal(); measured.names[0][key] = value
    assert.equal(assessReservationReading(measured).length, 1, key)
  }
})
