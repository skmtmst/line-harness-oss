/*
 * #625: 検索語の上限ガード clampSearchQuery の試験。
 * 2000文字級の入力がサーバーへ届かないようにする。
 */
import { describe, expect, it } from 'vitest'
import { clampSearchQuery, SEARCH_QUERY_MAX_LENGTH } from './search-query'

describe('clampSearchQuery', () => {
  it('上限ちょうど・上限未満・空文字はそのまま返す', () => {
    expect(clampSearchQuery('')).toBe('')
    expect(clampSearchQuery('解約')).toBe('解約')
    expect(clampSearchQuery('あ'.repeat(SEARCH_QUERY_MAX_LENGTH))).toHaveLength(SEARCH_QUERY_MAX_LENGTH)
  })

  it('監査で一覧を壊した 2000文字は上限へ切り詰める', () => {
    const long = 'と'.repeat(2000)
    expect(clampSearchQuery(long)).toHaveLength(SEARCH_QUERY_MAX_LENGTH)
    expect(clampSearchQuery(long)).toBe('と'.repeat(SEARCH_QUERY_MAX_LENGTH))
  })
})
