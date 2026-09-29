import { describe, expect, it } from 'vitest'
import { validateSupportAttachment, validateSupportInput } from './hq-support'

describe('お問い合わせの手元の検査', () => {
  const ok = { kind: 'bug' as const, subject: '文字が崩れる', body: '2枚に1枚は誤字になります', lineAccountId: '' }

  it('種類・件名・本文がそろえば通る', () => {
    expect(validateSupportInput(ok)).toBeNull()
  })

  it.each([
    [{ ...ok, kind: '' as const }, '種類'],
    [{ ...ok, subject: ' ' }, '件名'],
    [{ ...ok, subject: 'あ'.repeat(101) }, '100文字'],
    [{ ...ok, body: '' }, '本文'],
  ])('だめなときは理由（API と同じ言い方）: %o', (input, fragment) => {
    expect(validateSupportInput(input)).toContain(fragment)
  })

  it('添付は PNG・JPEG、5MB、3枚まで', () => {
    expect(validateSupportAttachment({ type: 'image/png', size: 1000 }, 0)).toBeNull()
    expect(validateSupportAttachment({ type: 'image/gif', size: 1000 }, 0)).toContain('PNG')
    expect(validateSupportAttachment({ type: 'image/jpeg', size: 6 * 1024 * 1024 }, 0)).toContain('5MB')
    expect(validateSupportAttachment({ type: 'image/jpeg', size: 1000 }, 3)).toContain('3枚')
  })
})
