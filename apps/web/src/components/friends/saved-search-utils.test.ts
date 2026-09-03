import { describe, expect, it } from 'vitest'
import type { SavedSearchCondition, Tag } from '@line-crm/shared'
import { describeSavedCondition } from './saved-search-utils'

const tags = [{ id: 'tag-1', name: 'VIP' }] as Tag[]

function describeCondition(condition: SavedSearchCondition) {
  return describeSavedCondition(condition, tags, {
    marks: { 'mark-1': '未対応' },
    scenarios: { 'scenario-1': '初回フォロー' },
    fields: { next_delivery: '次回配送日' },
  })
}

describe('保存した検索の条件表示', () => {
  it('対応マーク・シナリオ・対応状況を運用者向けの名前にする', () => {
    expect(describeCondition({ kind: 'mark', op: 'eq', value: 'mark-1' })).toBe('対応マークが「未対応」')
    expect(describeCondition({ kind: 'scenario', op: 'eq', value: 'scenario-1' })).toBe('シナリオが「初回フォロー」')
    expect(describeCondition({ kind: 'chat_status', op: 'eq', value: 'in_progress' })).toBe('対応状況が「対応中」')
  })

  it('日付範囲をobject文字列にせず日付として表示する', () => {
    expect(describeCondition({ kind: 'created_at', op: 'between', value: { from: '2026-08-01', to: '2026-08-31' } }))
      .toBe('友だち追加日が 2026-08-01〜2026-08-31')
  })

  it('名前を取得できない場合も保存IDを画面へ出さない', () => {
    expect(describeSavedCondition({ kind: 'mark', op: 'eq', value: 'mark-secret' })).toBe('対応マークが「選択済みの対応マーク」')
    expect(describeSavedCondition({ kind: 'tag', op: 'includes', value: 'tag-secret' })).toBe('タグ を含む「選択済みのタグ」')
    expect(describeSavedCondition({ kind: 'field', key: 'field-secret', op: 'eq', value: 'あり' })).toBe('選択済みの友だち情報 が次と同じ「あり」')
  })

  it('友だち情報の保存キーを運用者向けの項目名にする', () => {
    expect(describeCondition({ kind: 'field', key: 'next_delivery', op: 'eq', value: '2026-09-01' }))
      .toBe('次回配送日 が次と同じ「2026-09-01」')
  })
})
