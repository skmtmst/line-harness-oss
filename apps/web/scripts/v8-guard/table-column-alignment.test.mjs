import { test } from 'node:test'
import assert from 'node:assert/strict'
import scan from './table-column-alignment-browser.mjs'

function measure(rects) {
  const originalDocument = globalThis.document, originalStyle = globalThis.getComputedStyle
  const cells = rects.map((rect, i) => ({
    textContent: ['今の値', '移したあと', '人数'][i], colSpan: 1, rowSpan: 1,
    closest: () => null, getBoundingClientRect: () => ({ width: 100, height: 40, ...rect }),
  }))
  const row = { children: cells, cells, textContent: '今の値 移したあと 人数' }
  const table = { rows: [row], getAttribute: () => '値の移り方の見本',
    querySelectorAll: () => [row], closest: () => null,
    getBoundingClientRect: () => ({ width: 400, height: 80 }),
  }
  globalThis.document = { querySelectorAll: () => [table] }
  globalThis.getComputedStyle = () => ({ visibility: 'visible' })
  try { return scan() } finally {
    globalThis.document = originalDocument; globalThis.getComputedStyle = originalStyle
  }
}

test('同じ行の横3列は通す', () => {
  const result = measure([0, 100, 200].map(left => ({ left, right: left + 100, top: 0, bottom: 40 })))
  assert.equal(result.findings.length, 0)
  assert.equal(result.coverage[0].rows, 1)
})

test('recordsのように縦に積まれた3列を検出する', () => {
  const result = measure([0, 40, 80].map(top => ({ left: 0, right: 100, top, bottom: top + 40 })))
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].kind, 'table-columns-stacked')
})

test('セルの文字が複数行でも同じ行の範囲が重なれば通す', () => {
  const result = measure([
    { left: 0, right: 100, top: 0, bottom: 60 },
    { left: 100, right: 200, top: 10, bottom: 50 },
    { left: 200, right: 300, top: 20, bottom: 40 },
  ])
  assert.equal(result.findings.length, 0)
})

test('同じ高さでも列が重なる場合は検出する', () => {
  const result = measure([0, 50, 200].map(left => ({ left, right: left + 100, top: 0, bottom: 40 })))
  assert.equal(result.findings.length, 1)
})
