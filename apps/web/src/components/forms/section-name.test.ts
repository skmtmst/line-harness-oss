import { describe, expect, it } from 'vitest'
import { normalizeSectionName } from './section-name'

describe('ページ名の変更（#503 L3）', () => {
  it('取り消し・空・空白だけは受け付けない', () => {
    expect(normalizeSectionName(null)).toBeNull()
    expect(normalizeSectionName('')).toBeNull()
    expect(normalizeSectionName('   ')).toBeNull()
  })

  it('前後の空白を取って返す', () => {
    expect(normalizeSectionName('  第2部  ')).toBe('第2部')
  })
})
