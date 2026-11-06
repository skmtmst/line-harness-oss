import { describe, expect, it } from 'vitest'

import { isSameFieldContent } from './field-edit-conflict'

const latest = {
  id: 'f-1',
  folderId: null,
  name: 'メモ',
  fieldKey: 'memo',
  type: 'text',
  options: null,
  defaultValue: null,
  source: 'manual',
  ecFieldPath: null,
  ecIsMaster: false,
  isPersonal: false,
  isStarred: true,
  displayOrder: 0,
  createdAt: '2026-09-01T00:00:00+09:00',
  updatedAt: '2026-09-02T00:00:00+09:00',
  version: 4,
} as const

const sent = {
  name: 'メモ',
  folderId: null,
  options: null,
  defaultValue: null,
  isPersonal: false,
  isStarred: true,
  ecIsMaster: false,
  ecFieldPath: null,
}

/*
 * R517: 送った内容と最新の保存内容が同じなら、応答消失前の保存が
 * 成功している。違うなら、ほかの担当者が変えている。
 */
describe('R517 送った内容と最新の比べ分け', () => {
  it('同じ内容は保存済みと判定する', () => {
    expect(isSameFieldContent(sent, { ...latest })).toBe(true)
  })

  it('名前が違えば別人と判定する', () => {
    expect(isSameFieldContent({ ...sent, name: '別の名前' }, { ...latest })).toBe(false)
  })

  it('選択肢の選択肢名は保存時のIDへ戻して比べる', () => {
    const selectLatest = {
      ...latest,
      type: 'select',
      options: ['東京', '大阪'],
      optionDefinitions: [
        { id: 'opt-1', label: '東京' },
        { id: 'opt-2', label: '大阪' },
      ],
      defaultValue: 'opt-1',
    }
    expect(isSameFieldContent(
      { ...sent, options: ['東京', '大阪'], defaultValue: '東京' },
      selectLatest,
    )).toBe(true)
    expect(isSameFieldContent(
      { ...sent, options: ['東京', '大阪'], defaultValue: '大阪' },
      selectLatest,
    )).toBe(false)
  })

  it('比べられない既定値は保存済みと言い切らない', () => {
    const selectLatest = { ...latest, type: 'select', options: ['東京'], defaultValue: 'opt-9' }
    expect(isSameFieldContent({ ...sent, defaultValue: '東京' }, selectLatest)).toBe(false)
  })
})
