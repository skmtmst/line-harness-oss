import { describe, expect, test } from 'vitest'
import { usageSummaryDetail } from './usage-summary'

const b = (consumerType: string) => ({ consumerType })

describe('usageSummaryDetail', () => {
  test('何機能から呼ばれているかを出す', () => {
    const out = usageSummaryDetail([b('scenario'), b('automation'), b('scenario')])
    expect(out).toContain('2機能から')
    expect(out).toContain('シナリオ')
    expect(out).toContain('オートメーション')
  })

  test('同じ機能から何か所でも、機能数は1', () => {
    expect(usageSummaryDetail([b('scenario'), b('scenario'), b('scenario')])).toContain('1機能から')
  })

  test('利用先が無いときは機能数を出さず、無いことを書く', () => {
    const out = usageSummaryDetail([])
    expect(out).toBe('まだどこからも呼ばれていません')
    expect(out).not.toContain('0機能')
  })

  test('知らない種類が来ても件数は正しく、名前は出さない', () => {
    const out = usageSummaryDetail([b('scenario'), b('未知の種類')])
    expect(out).toContain('2機能から')
    expect(out).not.toContain('（')
  })

  test('種類が空文字だけのときは機能数を出さない', () => {
    expect(usageSummaryDetail([b('')])).toBe('版を固定した利用先')
  })
})
