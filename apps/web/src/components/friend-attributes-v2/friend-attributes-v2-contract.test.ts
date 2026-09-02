import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const COMPONENT = readFileSync(join(HERE, 'tag-list-v2.tsx'), 'utf8')
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'tags-v2', 'page.tsx'), 'utf8')

describe('友だち属性V2の移行契約', () => {
  it('現行の表示部品を読み込まず、独立した表示層を使う', () => {
    expect(PAGE).toContain('FriendAttributesV2TagList')
    expect(PAGE).not.toContain('TagsPageV4')
    expect(COMPONENT).not.toContain("@/components/friend-fields/tags-page-v4")
  })

  it('Pen.devの実ノードIDと画面骨格を記録する', () => {
    expect(COMPONENT).toContain('data-design-node="xn98K"')
    for (const section of ['Head', 'Tabs', 'KPIs', 'Actions', 'Folder', 'Toolbar', 'QuickFilters', 'Table', 'Pagination']) {
      expect(COMPONENT).toContain(`data-design="${section}"`)
    }
  })

  it('既存APIで取得・分類・並び替え・表示・削除を行う', () => {
    for (const call of [
      'api.tags.list({ withCounts: true })',
      'api.tags.create',
      'api.tagGroups.list()',
      'api.listStats.get()',
      'api.tags.setGroup',
      'api.tags.reorder',
      'api.tags.update',
      'api.tags.delete',
    ]) expect(COMPONENT).toContain(call)
  })

  it('20・30・40・50件と、検索・よく使う条件を選べる', () => {
    expect(COMPONENT).toContain('[20,30,40,50]')
    for (const label of ['タグ名・用途で検索', '未使用のタグ', '今月増えたタグ', '自動付与あり', '連動あり', '★一覧表示']) {
      expect(COMPONENT).toContain(label)
    }
  })
})
