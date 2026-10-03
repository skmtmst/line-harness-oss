/*
 * v8-parity の契約試験。ブラウザは要らない。
 *
 * 1. MEASURE_SCRIPT は関数式で、`page.evaluate(文字列)` は式を評価する
 *    だけで呼ばれない。呼ばないまま渡すと関数の値が返って `measured`
 *    が `undefined` になる。呼ぶ形（MEASURE_CALL）で渡す。
 * 2. compareAndWrite は `measured` が無いときも落とさない。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { MEASURE_CALL, MEASURE_SCRIPT, compareAndWrite } from './v8-parity.mjs'
// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { encodePng } from './v8-png.mjs'

function tinyPng(): Buffer {
  const rgba = Buffer.alloc(4 * 4 * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 200
    rgba[i + 1] = 210
    rgba[i + 2] = 220
    rgba[i + 3] = 255
  }
  return Buffer.from(encodePng({ width: 4, height: 4, rgba }))
}

function runCompare(measured: unknown) {
  const outDir = mkdtempSync(join(tmpdir(), 'v8-parity-'))
  const refPng = join(outDir, 'ref.png')
  const shot = tinyPng()
  writeFileSync(refPng, shot)
  const metrics = compareAndWrite({
    board: 'test',
    route: '/test',
    width: 1440,
    url: 'http://localhost:3101/test',
    refPng,
    refHtml: null,
    measured,
    shotBuffer: shot,
    outDir,
  })
  const saved = JSON.parse(readFileSync(join(outDir, 'metrics.json'), 'utf8'))
  return { metrics, saved }
}

describe('v8-parity の測り', () => {
  it('MEASURE_SCRIPT は関数式で、そのままでは測れない', () => {
    const bare = new Function(`return ${MEASURE_SCRIPT}`)()
    expect(typeof bare).toBe('function')
  })

  it('page.evaluate へは呼ぶ形で渡す', () => {
    expect(MEASURE_CALL).toBe(`(${MEASURE_SCRIPT})()`)
  })
})

describe('compareAndWrite は measured が無くても落ちない', () => {
  it.each([['undefined', undefined], ['null', null], ['空', {}]])('%s のとき空の配列で書く', (_label, measured) => {
    const { metrics, saved } = runCompare(measured)
    expect(metrics.overflows).toEqual([])
    expect(metrics.viewportOverflows).toEqual([])
    expect(metrics.midWordBreaks).toEqual([])
    expect(metrics.tableMisalignments).toEqual([])
    expect(metrics.fontIssues).toEqual([])
    expect(metrics.keyElements).toBe(0)
    expect(saved.keyElements).toBe(0)
  })

  it('ある分はそのまま数える', () => {
    const { metrics } = runCompare({
      overflows: [{ path: 'div.box', clientWidth: 100, scrollWidth: 120 }],
      viewportOverflows: [],
      midWordBreaks: [],
      tableMisalignments: [],
      fontIssues: [{ path: 'p', text: 'あ', font: 'sans' }],
      keys: [{ tag: 'h1', text: '保存', rect: { x: 0, y: 0, w: 10, h: 10 } }],
    })
    expect(metrics.overflows).toHaveLength(1)
    expect(metrics.fontIssues).toHaveLength(1)
    expect(metrics.keyElements).toBe(1)
    // 同じ絵同士で画素の差は 0。はみ出し10点＋書体2点だけ。
    expect(metrics.drift).toBe(12)
  })
})
