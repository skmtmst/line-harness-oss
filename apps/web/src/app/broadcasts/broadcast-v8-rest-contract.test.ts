import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const FORM = readFileSync(
  join(HERE, '..', '..', 'components', 'broadcasts', 'broadcast-form.tsx'),
  'utf8',
)
const DETAIL_V8 = readFileSync(join(HERE, 'detail-v8.tsx'), 'utf8')
const DETAIL_PAGE = readFileSync(join(HERE, 'detail', 'page.tsx'), 'utf8')

/*
 * ★V8 一斉配信の残り2枚。
 * `FU2aU`（作る流れの5手順）はV8へ完全に切り替える。
 * `Q28Gb`（詳細の競合）は、ほかの人の更新に気づいたら帯で知らせ、
 * この画面は書き換えず「読み直す」だけ受け付ける。
 */
describe('一斉配信の残り2枚（FU2aU・Q28Gb）', () => {
  it('作る流れはV8の板FU2aUへ完全に切り替える', () => {
    expect(FORM).toContain('data-design-node="FU2aU"')
    expect(FORM).not.toContain("theme === 'v8'")
  })

  it('詳細の競合の帯は板 Q28Gb を持ち、読み直しだけ出す', () => {
    expect(DETAIL_V8).toContain('data-design-node="Q28Gb"')
    expect(DETAIL_V8).toContain('ほかの人がこの配信を更新しました')
    expect(DETAIL_V8).toContain('この画面では書き換えません')
    expect(DETAIL_V8).toContain('読み直す')
  })

  it('競合の帯は競合のときだけ出す（ふだんは出さない）', () => {
    expect(DETAIL_V8).toContain('{conflict && (')
  })

  it('版のずれは戻ってきたときに確かめ、v7 では確かめない', () => {
    expect(DETAIL_PAGE).toContain('shownVersionRef')
    expect(DETAIL_PAGE).toContain("adminTheme !== 'v8'")
    expect(DETAIL_PAGE).toContain('setConflict(true)')
  })
})
