import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * #975 U065: 未入力でも「/r/summer-ig」のURLとQRが出て発行済みに見えた。
 * 未入力は例示、入力中は未発行の見本、と分ける。
 * 板 KMaMk の URL カードに QR は無い。見本の QR を出さないことで、
 * 保存前の QR を配る事故自体を無くす。
 */
describe('流入URLの保存前表示（#975 U065）', () => {
  it('REFが未入力のときは例のURLだけを出し、見本URLは作らない', () => {
    expect(PAGE).toContain("const previewUrl = validRef ? `${workerBase}/r/${refCode}` : ''")
    expect(PAGE).not.toContain("refCode || 'summer-ig'")
    expect(PAGE).toContain('例: {workerBase}/r/summer-ig')
    expect(PAGE).toContain('まだ発行されていません')
  })

  it('見本URLには発行の案内を付け、見本のQRは出さない', () => {
    expect(PAGE).toContain('発行するとできます')
    expect(PAGE).not.toContain('見本のQR')
    // 未入力のときは例のURLだけ。
    expect(PAGE).toContain('まだ発行されていません')
  })
})
