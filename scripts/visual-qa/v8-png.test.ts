/*
 * 依存なし PNG 読み書きの試験。作った絵を自分で読んで比べるだけなので、
 * ブラウザも見本も要らない。
 */
import { describe, expect, it } from 'vitest'

// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { annotate, decodePng, diffImages, encodePng, sideBySide } from './v8-png.mjs'

function solid(width: number, height: number, r: number, g: number, b: number) {
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r
    rgba[i + 1] = g
    rgba[i + 2] = b
    rgba[i + 3] = 255
  }
  return { width, height, rgba }
}

describe('v8-png', () => {
  it('書いた絵をそのまま読める', () => {
    const img = solid(37, 23, 10, 200, 90)
    const back = decodePng(encodePng(img))
    expect(back.width).toBe(37)
    expect(back.height).toBe(23)
    expect(Buffer.from(back.rgba).equals(img.rgba)).toBe(true)
  })

  it('見本の PNG（実物）を読める', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const shot = join(dirname(fileURLToPath(import.meta.url)), 'v8-design-refs', 'ywJ5H.png')
    if (!existsSync(shot)) return
    const img = decodePng(readFileSync(shot))
    expect(img.width).toBeGreaterThan(100)
    expect(img.height).toBeGreaterThan(100)
    // 書き直しても大きさは同じ。
    const back = decodePng(encodePng(img))
    expect([back.width, back.height]).toEqual([img.width, img.height])
  })

  it('同じ絵の差はゼロ・違う所は箱になる', () => {
    const a = solid(64, 48, 250, 250, 250)
    const same = diffImages(a, solid(64, 48, 250, 250, 250))
    expect(same.fraction).toBe(0)
    expect(same.boxes).toEqual([])
    const b = solid(64, 48, 250, 250, 250)
    // 左上の 32x16 を赤く塗る。
    for (let y = 4; y < 20; y += 1) {
      for (let x = 4; x < 36; x += 1) {
        const o = (y * 64 + x) * 4
        b.rgba[o] = 230
        b.rgba[o + 1] = 20
        b.rgba[o + 2] = 20
      }
    }
    const diff = diffImages(a, b)
    expect(diff.fraction).toBeGreaterThan(0)
    expect(diff.boxes.length).toBeGreaterThan(0)
    const marked = annotate(a, diff.boxes)
    expect(marked.width).toBe(64)
    const side = sideBySide(a, b)
    expect(side.width).toBe(64 + 8 + 64)
    expect(side.height).toBe(48)
    // 並べた絵も PNG として読める（CRC つき）。
    const back = decodePng(encodePng(side))
    expect([back.width, back.height]).toEqual([side.width, side.height])
  })
})
