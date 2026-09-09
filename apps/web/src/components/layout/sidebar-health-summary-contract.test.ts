import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sidebar = readFileSync(new URL('./sidebar.tsx', import.meta.url), 'utf8')

describe('サイドバーの運用警告は要約1回だけ (#630)', () => {
  it('件数分の getHealth を呼ばず、要約APIを1回だけ呼ぶ', () => {
    expect(sidebar).toContain('api.health.summary()')
    expect(sidebar).not.toContain('getHealth')
    expect(sidebar).not.toContain('api.health.accounts()')
  })

  it('警告数と危険数を足してバッジに出す', () => {
    expect(sidebar).toContain('warningCount + summary.value.data.dangerCount')
  })

  it('5分間隔・手動更新イベント・並走ガードはそのまま(見た目と構造は変えない)', () => {
    expect(sidebar).toContain('5 * 60_000')
    expect(sidebar).toContain('UNANSWERED_REFRESH_EVENT')
    expect(sidebar).toContain('mySeq !== seq')
  })
})
