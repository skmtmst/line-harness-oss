import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { normalizeSavedViewConditions } from './saved-view-types'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * 保存した検索の中身をそろえる（設計 `ASsb3` 2-13）。
 *
 * **受信箱より前に作られた行がある。** 保存した検索の仕組みは受信箱より
 * 先にあり、古い行は友だち側と同じ `{ all: [], any: [] }` の形で入っている。
 * 形を確かめずに `conditions.statuses.length` を読むと、受信箱ごと真っ白になった。
 */
describe('古い形の保存した検索でも落ちない', () => {
  it('友だち側の形（all/any）は「何も絞っていない」として読む', () => {
    const conditions = normalizeSavedViewConditions({ all: [], any: [] })
    expect(conditions.statuses).toEqual([])
    expect(conditions.channels).toEqual([])
    expect(conditions.assignees).toEqual([])
    expect(conditions.unread).toBe('all')
    expect(conditions.sort).toBe('newest')
  })

  it('null・undefined・文字列でも落ちない', () => {
    for (const raw of [null, undefined, 'なにか', 42, []]) {
      expect(() => normalizeSavedViewConditions(raw)).not.toThrow()
      expect(normalizeSavedViewConditions(raw).statuses).toEqual([])
    }
  })

  it('知っている軸はそのまま残す', () => {
    const conditions = normalizeSavedViewConditions({
      version: 1,
      query: 'ペット',
      channels: ['line'],
      statuses: ['unread', 'on_hold'],
      assignees: ['operator-kenta'],
      unread: 'mine',
      messageTypes: ['text'],
      receivedFrom: '2026-08-01',
      receivedTo: null,
      sort: 'waiting_desc',
    })
    expect(conditions.query).toBe('ペット')
    expect(conditions.channels).toEqual(['line'])
    expect(conditions.statuses).toEqual(['unread', 'on_hold'])
    expect(conditions.assignees).toEqual(['operator-kenta'])
    expect(conditions.unread).toBe('mine')
    expect(conditions.sort).toBe('waiting_desc')
  })

  it('知らない値は捨てる（そのまま画面へ流さない）', () => {
    /*
      保存した時点では正しかった値が、あとから無くなることがある。
      知らない値を通すと、絞り込みの選び口に**選べない選択肢**が出る。
    */
    const conditions = normalizeSavedViewConditions({
      statuses: ['unread', 'archived'],
      channels: ['line', 'sms'],
      sort: 'oldest',
    })
    expect(conditions.statuses).toEqual(['unread'])
    expect(conditions.channels).toEqual(['line'])
    expect(conditions.sort).toBe('newest')
  })

  it('画面は形をそろえてから読む', () => {
    // **考え方が正しくても、繋いでいなければ落ちる。**
    expect(PAGE).toContain('const conditions = normalizeSavedViewConditions(view.conditions)')
    expect(PAGE).toContain('savedViewSummary(normalizeSavedViewConditions(view.conditions), operatorNames)')
    // そろえずに直接読む形へ戻さない。
    expect(PAGE).not.toContain('const conditions = view.conditions')
  })
})
