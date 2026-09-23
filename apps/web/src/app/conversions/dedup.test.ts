import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deduplicationLabel } from './dedup'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const NEW_PAGE = readFileSync(new URL('./new/page.tsx', import.meta.url), 'utf8')

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

  it('一覧・詳細・編集の選択肢は同じ呼び名を使う', () => {
    // 一覧と詳細が countRepeat の二択に戻らない（窓を「1人1回」と言わない）
    expect(PAGE).toContain('deduplicationLabel(point.deduplicationMode, point.deduplicationWindowDays)')
    expect(PAGE).toContain('deduplicationLabel(detailTarget.deduplicationMode, detailTarget.deduplicationWindowDays)')
    expect(PAGE).not.toContain("countRepeat === false ? '1人1回' : '毎回数える'")
    expect(PAGE).not.toContain("countRepeat ? '毎回数える' : '1人1回'")
    // 編集の選択肢も同じ関数から作る
    expect(PAGE).toContain("deduplicationLabel('every', null)")
    expect(PAGE).toContain("deduplicationLabel('once_per_friend', null)")
    expect(PAGE).toContain("deduplicationLabel('window', null)")
  })

  it('作成の選択肢と同じ言葉で出す', () => {
    // 作成カードの呼び名と、一覧・詳細の呼び名がずれると同じものを
    // 別物に読み違える。
    expect(NEW_PAGE).toContain('title="何回でも数える"')
    expect(NEW_PAGE).toContain('title="1人1回だけ"')
    expect(NEW_PAGE).toContain('title="30日に1回まで"')
    expect(deduplicationLabel('every', null)).toBe('何回でも数える')
    expect(deduplicationLabel('once_per_friend', null)).toBe('1人1回だけ')
    expect(deduplicationLabel('window', 30)).toBe('30日に1回まで')
  })
})
