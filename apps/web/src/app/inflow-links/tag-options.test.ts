import { describe, expect, test } from 'vitest'
import type { Tag, TagGroup } from '@line-crm/shared'
import { groupTagsByFolder } from './tag-options'

const tag = (id: string, name: string, groupId: string | null): Tag =>
  ({ id, name, groupId, color: null }) as unknown as Tag
const group = (id: string, name: string, sortOrder: number): TagGroup =>
  ({ id, name, sortOrder }) as unknown as TagGroup

describe('groupTagsByFolder', () => {
  test('フォルダごとに束ね、順番はsortOrder', () => {
    const out = groupTagsByFolder(
      [tag('t1', 'VIP 1', 'g-vip'), tag('t2', 'ペット 1', 'g-pet')],
      [group('g-pet', 'ペット', 1), group('g-vip', 'VIP', 0)],
    )
    expect(out.map((g) => g.label)).toEqual(['VIP', 'ペット'])
    expect(out[0].tags.map((t) => t.id)).toEqual(['t1'])
  })

  test('どのフォルダにも属さないタグは未分類へ入り、最後に来る', () => {
    const out = groupTagsByFolder(
      [tag('t1', 'VIP 1', 'g-vip'), tag('t2', 'ひとり', null), tag('t3', '消えたフォルダ', 'g-gone')],
      [group('g-vip', 'VIP', 0)],
    )
    expect(out.map((g) => g.label)).toEqual(['VIP', '未分類'])
    expect(out.at(-1)?.tags.map((t) => t.id)).toEqual(['t2', 't3'])
  })

  test('タグが入っていないフォルダは出さない', () => {
    const out = groupTagsByFolder([tag('t1', 'VIP 1', 'g-vip')], [
      group('g-vip', 'VIP', 0),
      group('g-empty', '空', 1),
    ])
    expect(out.map((g) => g.label)).toEqual(['VIP'])
  })

  test('フォルダが取れないときは束ねずにタグをそのまま返す', () => {
    const out = groupTagsByFolder([tag('t1', 'VIP 1', 'g-vip')], [])
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('')
    expect(out[0].tags.map((t) => t.id)).toEqual(['t1'])
  })

  test('タグが1つも無いときは空を返す', () => {
    expect(groupTagsByFolder([], [group('g-vip', 'VIP', 0)])).toEqual([])
    expect(groupTagsByFolder([], [])).toEqual([])
  })
})
