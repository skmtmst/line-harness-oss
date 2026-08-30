import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('V6 イベント予約の件数状態', () => {
  it('読込中・失敗・成功を同じ補足にしない', () => {
    expect(PAGE).toContain("if (status === 'loading') return '読み込み中'")
    expect(PAGE).toContain("if (status === 'error') return '取得できませんでした'")
    expect(PAGE).toContain('return readyDetail')
  })

  it('失敗時は一覧件数を0件とせずページ送りを出さない', () => {
    expect(PAGE).toContain("!selectedAccountId || loadStatus === 'error'")
    expect(PAGE).toContain("? '—'")
    expect(PAGE).toContain('dataReady ? <Pagination')
  })

  it('取得成功後の実値0は0件として表示できる', () => {
    expect(PAGE).toContain("filtered.length === 0")
    expect(PAGE).toContain("? '0件'")
  })

  it('全体平均でなく、次に声をかける回を帯へ出す', () => {
    expect(PAGE).toContain("title=\"これからの回\"")
    expect(PAGE).toContain("title=\"あと少しで満席\"")
    expect(PAGE).toContain('声をかけると埋まります')
    expect(PAGE).toContain("title=\"申し込みが少ない\"")
    expect(PAGE).toContain('daysUntilEvent(nearestLow)')
    expect(PAGE).not.toContain('title="定員の充足"')
  })
})
