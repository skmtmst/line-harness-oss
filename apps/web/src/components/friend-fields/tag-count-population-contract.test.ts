import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const PAGE = readFileSync(resolve(process.cwd(), 'src/v8/tags/tags-tab.tsx'), 'utf8')

describe('V8タグ一覧の件数の母集団', () => {
  it('KPIは未使用などの指標で、一覧の総数を繰り返さない', () => {
    expect(PAGE).not.toContain('value: ready ? items.length : null')
    expect(PAGE).not.toContain('value: stats.tags.total')
    expect(PAGE).toContain("title: '未使用',")
  })
  it('KPIは一覧と同じアカウント範囲で数える', () => {
    expect(PAGE).toContain('api.listStats.get(accountId)')
  })
  it('フォルダ欄は全体と各フォルダの内訳を同じ取得済みデータから数える', () => {
    expect(PAGE).toContain("label: 'すべて', count: ready ? items.length : null")
    expect(PAGE).toContain('count: ready ? items.filter((tag) => tag.groupId === group.id).length : null')
    expect(PAGE).toContain('count: ready ? items.filter((tag) => !tag.groupId).length : null')
  })
  it('畳まれたフォルダ選択には件数を重ねない', () => {
    expect(PAGE).toContain("label: 'フォルダ：すべて'")
    expect(PAGE).not.toMatch(/フォルダ：すべて（\$\{.*\}件）/)
  })
  it('保管の絞り込みとページの件数は同じ母集団を使う', () => {
    expect(PAGE).toContain("if ((tag.status === 'archived') !== onlyArchived) return false")
    expect(PAGE).toContain('${filtered.length} 件中')
    expect(PAGE).toContain("const archiveChip = <FilterChip selected={onlyArchived}")
  })
  it('アカウント切替で前のフォルダ・行・件数を残さない', () => {
    expect(PAGE).toContain("useOnAccountSwitch(accountId, () => setView({ folder: '', page: '1' }))")
    expect(PAGE).toContain('setItems([])')
    expect(PAGE).toContain('setGroups([])')
    expect(PAGE).toContain('loadRequestRef.current.accountId !== accountId')
  })
})
