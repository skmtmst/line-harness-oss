import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * #975 U065: 未入力でも「/r/summer-ig」のURLとQRが出て発行済みに見えた。
 * 未入力は例示、入力中は未発行の見本、と分ける。
 */
describe('流入URLの保存前表示（#975 U065）', () => {
  it('REFが未入力のときは例のURLだけを出し、見本URLは作らない', () => {
    expect(PAGE).toContain("const previewUrl = validRef ? `${workerBase}/r/${refCode}` : ''")
    expect(PAGE).not.toContain("refCode || 'summer-ig'")
    expect(PAGE).toContain('例: {workerBase}/r/summer-ig')
    expect(PAGE).toContain('まだ発行されていません')
  })

  it('見本URLには「保存前の見本」の印を付け、QRも見本と分かる', () => {
    expect(PAGE).toContain('保存前の見本 — まだ発行されていません')
    expect(PAGE).toContain('見本のQR — 保存後に画像で保存できます')
    // 未入力のQRは生成しない。
    expect(PAGE).toContain('if (!previewUrl)')
  })
})
