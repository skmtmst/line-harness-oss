import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/** #975 U069: 保存した検索が見つからないときも行き止まりにしない。 */
describe('保存した検索の戻り道（#975 U069）', () => {
  it('見つからないときに一覧へ戻る入口がある', () => {
    expect(PAGE).toContain('保存した検索の一覧へ戻る')
    // 戻り先は ★V7 TargetMissing の backHref が持つ。
    expect(PAGE).toContain('backHref="/tags?tab=searches"')
    expect(PAGE).toContain('保存した検索が見つかりません')
  })
})
