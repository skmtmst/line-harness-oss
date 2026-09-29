import { describe, expect, test } from 'vitest'
import { describeVersionChanges, versionChangeSummary } from './version-diff'
import type { CommonActionStep } from '@/lib/api'

const wait = (id: string, minutes: number, onFailure: CommonActionStep['onFailure'] = 'stop'): CommonActionStep => ({
  id, type: 'wait', params: { durationMinutes: minutes }, onFailure,
})
const tag = (id: string, tagId = 'tag-1'): CommonActionStep => ({
  id, type: 'add_tag', params: { tagId }, onFailure: 'stop',
})

/*
 * 監査 R468: 切替確認で待ち時間・失敗時の動きの前後が分からない。
 * 「1個の処理」「待つ」だけの比較表示にしない。
 */
describe('describeVersionChanges（監査 R468）', () => {
  test('待機1分→60分・停止→続行を前後で書く', () => {
    const lines = describeVersionChanges([wait('w', 1)], [wait('w', 60, 'continue')])
    expect(lines).toContain('「待つ」を1分から60分にした')
    expect(lines).toContain('「待つ」の失敗時を「止める」から「次へ進む」にした')
  })

  test('処理の追加・削除・順序変更を区別する', () => {
    expect(describeVersionChanges([tag('a')], [tag('a'), wait('w', 5)]))
      .toContain('「待つ」を追加した')
    expect(describeVersionChanges([tag('a'), wait('w', 5)], [tag('a')]))
      .toContain('「待つ」を外した')
    expect(describeVersionChanges([tag('a'), wait('w', 5)], [wait('w', 5), tag('a')]))
      .toContain('処理の順番を変えた')
  })

  test('変わりがなければその旨を1行にする', () => {
    expect(describeVersionChanges([wait('w', 5)], [wait('w', 5)]))
      .toEqual(['内容の変更はありません'])
  })

  test('履歴の1行は初版・件数・先頭の変更を出す', () => {
    const v1 = { versionNumber: 1, actions: [wait('w', 1)] }
    expect(versionChangeSummary(v1, [v1])).toBe('はじめて公開した')
    const v2 = { versionNumber: 2, actions: [wait('w', 60)] }
    expect(versionChangeSummary(v2, [v1, v2])).toBe('「待つ」を1分から60分にした')
    const v3 = { versionNumber: 3, actions: [wait('w', 60), tag('a')] }
    expect(versionChangeSummary(v3, [v1, v2, v3])).toBe('処理を1個から2個にした')
  })
})
