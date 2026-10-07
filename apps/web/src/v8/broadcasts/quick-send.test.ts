import { describe, expect, it } from 'vitest'
import { APPROVAL_THRESHOLD, estimateText } from './quick-send'

/* ★V8 一斉配信 かんたんに送る（P6vbxn）：見込みの1文と、承認の境目。 */
describe('かんたんに送る（V8）', () => {
  it('見込みは人数・ブロック中・今月の残り（読めたときだけ）', () => {
    expect(estimateText({ count: 1213, blocked: 12, remaining: 187 })).toBe('1,213人に届く見込み（ブロック中 12人を除く）・今月あと 187通 送れます')
    expect(estimateText({ count: 40, blocked: 0, remaining: null })).toBe('40人に届く見込み（ブロック中 0人を除く）')
  })

  it('承認が要るのは 1,000 人から', () => {
    expect(APPROVAL_THRESHOLD).toBe(1000)
  })
})
