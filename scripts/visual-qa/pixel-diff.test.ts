import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

// @ts-expect-error 画面確認スクリプトは素のJSで型定義を持たない。
import { compareRgba } from './pixel-diff.mjs'

function image(width: number, height: number, pixels: number[][]) {
  return { width, height, data: Buffer.from(pixels.flat()) }
}

const WHITE = [255, 255, 255, 255]
const BLACK = [0, 0, 0, 255]

function writePng(path: string, rgba: number[], width = 2, height = 2) {
  const png = new PNG({ width, height })
  png.data = Buffer.from(Array.from({ length: width * height }, () => rgba).flat())
  writeFileSync(path, PNG.sync.write(png))
}

describe('Pencil設計との画素比較', () => {
  it('同じ画像は差分0%', () => {
    const source = image(2, 2, [WHITE, WHITE, WHITE, WHITE])
    const result = compareRgba(source, source)
    expect(result.pixelDiffPercent).toBe(0)
    expect(result.mismatchedPixels).toBe(0)
    expect(result.dominantRegion).toBe('差なし')
  })

  it('1/4画素の色違いを25%として位置も出す', () => {
    const design = image(2, 2, [WHITE, WHITE, WHITE, WHITE])
    const implementation = image(2, 2, [BLACK, WHITE, WHITE, WHITE])
    const result = compareRgba(design, implementation)
    expect(result.pixelDiffPercent).toBe(25)
    expect(result.boundingBox).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
    expect(result.dominantRegion).toBe('上部・左')
  })

  it('高さが違うときは上端から短い側を比べ、高さ差を別に出す', () => {
    const design = image(2, 3, [WHITE, WHITE, WHITE, WHITE, WHITE, WHITE])
    const implementation = image(2, 2, [WHITE, WHITE, WHITE, WHITE])
    const result = compareRgba(design, implementation)
    expect(result.comparedHeight).toBe(2)
    expect(result.heightDifferencePx).toBe(-1)
    expect(result.pixelDiffPercent).toBe(0)
  })

})
