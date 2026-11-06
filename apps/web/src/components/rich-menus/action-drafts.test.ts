import { expect, it } from 'vitest'
import { TEMPLATES } from '@/lib/rich-menu-templates'
import { createAreaDrafts, saveAreaDraft } from './action-drafts'

it('新しい6面のボタン名は空欄で始め、面の位置と未入力の動きを保つ', () => {
  const template = TEMPLATES.find(item => item.size === 'large' && item.areas.length === 6)!
  const areas = createAreaDrafts(template)
  expect(areas.map(area => area.label)).toEqual(['', '', '', '', '', ''])
  expect(areas.map(area => [area.boundsX, area.boundsY, area.boundsWidth, area.boundsHeight]))
    .toEqual(template.areas.map(area => [Math.round(area.x), Math.round(area.y), Math.round(area.w), Math.round(area.h)]))
  expect(areas.every(area => area.intent === 'text' && area.actionData.text === '')).toBe(true)
})

it('利用者が付けた名前と動きを保存しても、ほかの面の名前を書き換えない', () => {
  const template = TEMPLATES.find(item => item.areas.length === 6)!
  const areas = createAreaDrafts(template)
  const edited = { ...areas[3], label: '予約する', intent: 'url' as const, actionType: 'uri' as const,
    actionData: { uri: 'https://example.test/reserve' } }
  const saved = saveAreaDraft(areas, 3, edited)
  expect(saved[3]).toEqual(edited)
  expect(saved[0]).toEqual(areas[0])
  expect(saved[5]).toEqual(areas[5])
})
