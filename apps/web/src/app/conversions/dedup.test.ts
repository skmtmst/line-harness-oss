import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'
import { deduplicationLabel } from '@/v8/conversions/dedup'

const PAGE = readUiSource(new URL('./page.tsx', import.meta.url), 'utf8')

describe('数え方の呼び名（CONVERSION-04）', () => {
  it('何回でも・1人1回・日数窓を別の呼び名にする', () => {
    expect(deduplicationLabel('every', null)).toBe('何回でも数える')
    expect(deduplicationLabel('once_per_friend', null)).toBe('1人1回だけ')
    // 日数窓は「1人1回」ではない。実際の日数を出す。
    expect(deduplicationLabel('window', 1)).toBe('1日に1回まで')
    expect(deduplicationLabel('window', 30)).toBe('30日に1回まで')
    expect(deduplicationLabel('window', 365)).toBe('365日に1回まで')
  })

  it('日数が取れていない窓は、日数を捏造しない', () => {
    expect(deduplicationLabel('window', null)).toBe('決めた日数に1回まで')
    expect(deduplicationLabel('window', undefined)).toBe('決めた日数に1回まで')
    expect(deduplicationLabel('window', 0)).toBe('決めた日数に1回まで')
  })

  /* 一覧の行・詳細・編集の選択肢・作成の札が同じ呼び名を使うことは v8/conversions/list.test.tsx・create.test.tsx が描画して確かめる。 */
  it('一覧と詳細は countRepeat の二択の言い方を使わない', () => {
    expect(PAGE).not.toContain("countRepeat === false ? '1人1回' : '毎回数える'")
    expect(PAGE).not.toContain("countRepeat ? '毎回数える' : '1人1回'")
  })
})
