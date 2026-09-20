import { describe, expect, it } from 'vitest'
import type { SavedSearchCondition, Tag } from '@line-crm/shared'
import {
  conditionsToEditorState,
  describeSavedCondition,
  describeSavedVisibility,
  editorStateToConditions,
  hasSavedSearchFilter,
  type FriendSearchEditorState,
} from './saved-search-utils'

const tags = [{ id: 'tag-1', name: 'VIP' }] as Tag[]

function state(partial: Partial<FriendSearchEditorState> = {}): FriendSearchEditorState {
  return { blocks: [], any: [], extraAll: [], visibility: 'visible', ...partial }
}

describe('FRIEND-01 対象の選択は4値の明示的な状態', () => {
  it('表示中は is_hidden=0（visible_only）+ 友だち中を送る', () => {
    const conditions = editorStateToConditions(state({ visibility: 'visible' }), { sort: 'recent', limit: 20 })
    expect(conditions.visibility).toBe('visible_only')
    expect(conditions.all).toContainEqual({ kind: 'following', op: 'eq', value: true })
  })

  it('非表示のみは hidden_only。ブロックは is_following=0。すべては絞らない', () => {
    expect(editorStateToConditions(state({ visibility: 'hidden' }), { sort: 'recent', limit: 20 }).visibility).toBe('hidden_only')
    const blocked = editorStateToConditions(state({ visibility: 'blocked' }), { sort: 'recent', limit: 20 })
    expect(blocked.visibility).toBe('all')
    expect(blocked.all).toContainEqual({ kind: 'following', op: 'eq', value: false })
    const all = editorStateToConditions(state({ visibility: 'all' }), { sort: 'recent', limit: 20 })
    expect(all.visibility).toBe('all')
    expect(all.all ?? []).toEqual([])
  })

  it('リセット後の既定は「表示中」で、旧来の hidden_only にはならない', () => {
    // 旧実装はリセットで visibility='' → hidden_only になっていた。
    const state_ = state() // 既定値 = visible
    expect(editorStateToConditions(state_, { sort: 'recent', limit: 20 }).visibility).toBe('visible_only')
  })
})

describe('FRIEND-02 同じ項目のAND条件はすべて残る', () => {
  it('名前2件・タグ2件・同じ情報欄2件が all へ残る', () => {
    const conditions = editorStateToConditions(state({
      blocks: [
        { kind: 'name', keyword: 'Alpha' },
        { kind: 'name', keyword: 'Beta' },
        { kind: 'tag', include: ['tag-1', 'tag-2'], exclude: ['tag-3'] },
        { kind: 'field', key: '誕生日', op: 'eq', value: '1990-01-01' },
        { kind: 'field', key: '誕生日', op: 'ne', value: '2000-01-01' },
      ],
    }), { sort: 'recent', limit: 20 })
    const names = (conditions.all ?? []).filter((c) => c.kind === 'name')
    expect(names).toEqual([
      { kind: 'name', op: 'contains', value: 'Alpha' },
      { kind: 'name', op: 'contains', value: 'Beta' },
    ])
    const tagConditions = (conditions.all ?? []).filter((c) => c.kind === 'tag')
    expect(tagConditions).toEqual([
      { kind: 'tag', op: 'includes', value: 'tag-1' },
      { kind: 'tag', op: 'includes', value: 'tag-2' },
      { kind: 'tag', op: 'excludes', value: 'tag-3' },
    ])
    const fields = (conditions.all ?? []).filter((c) => c.kind === 'field')
    expect(fields).toEqual([
      { kind: 'field', key: '誕生日', op: 'eq', value: '1990-01-01' },
      { kind: 'field', key: '誕生日', op: 'ne', value: '2000-01-01' },
    ])
  })

  it('未入力のブロックは条件にしない', () => {
    const conditions = editorStateToConditions(state({
      blocks: [
        { kind: 'name', keyword: '  ' },
        { kind: 'field', key: '', op: 'eq', value: '' },
      ],
    }), { sort: 'recent', limit: 20 })
    // visibility=visible の following だけが残る
    expect(conditions.all).toEqual([{ kind: 'following', op: 'eq', value: true }])
  })
})

describe('FRIEND-32 保存済み条件を編集画面へ復元する', () => {
  it('名前・タグ・情報欄・対応状況・日付範囲がブロックへ戻る', () => {
    const restored = conditionsToEditorState({
      all: [
        { kind: 'name', op: 'contains', value: 'Alpha' },
        { kind: 'tag', op: 'includes', value: 'tag-1' },
        { kind: 'tag', op: 'excludes', value: 'tag-9' },
        { kind: 'field', key: '誕生日', op: 'ne', value: '2000-01-01' },
        { kind: 'chat_status', op: 'eq', value: 'on_hold' },
        { kind: 'created_at', op: 'between', value: { from: '2026-01-01', to: '2026-01-31' } },
      ],
      any: [{ kind: 'scenario', op: 'eq', value: 's2' }],
      visibility: 'visible_only',
    })
    expect(restored.blocks).toContainEqual({ kind: 'name', keyword: 'Alpha' })
    expect(restored.blocks).toContainEqual({ kind: 'tag', include: ['tag-1'], exclude: ['tag-9'] })
    expect(restored.blocks).toContainEqual({ kind: 'field', key: '誕生日', op: 'ne', value: '2000-01-01' })
    expect(restored.blocks).toContainEqual({ kind: 'chat_status', value: 'on_hold' })
    expect(restored.blocks).toContainEqual({ kind: 'created_at', from: '2026-01-01', to: '2026-01-31' })
    expect(restored.any).toEqual([{ kind: 'scenario', op: 'eq', value: 's2' }])
    expect(restored.visibility).toBe('visible')
    expect(restored.extraAll).toEqual([])
  })

  it('編集画面で組み直せない条件は extraAll へ保持し、再適用で残る', () => {
    const mark: SavedSearchCondition = { kind: 'mark', op: 'eq', value: 'm1' }
    const restored = conditionsToEditorState({ all: [mark], visibility: 'all' })
    expect(restored.extraAll).toEqual([mark])
    // 再適用しても条件が消えない
    const roundTripped = editorStateToConditions(restored, { sort: 'recent', limit: 20 })
    expect(roundTripped.all).toContainEqual(mark)
  })

  it('ブロック条件は「ブロックした人」の選択へ畳み、重複して残さない', () => {
    const restored = conditionsToEditorState({
      all: [{ kind: 'following', op: 'eq', value: false }],
      visibility: 'all',
    })
    expect(restored.visibility).toBe('blocked')
    expect(restored.extraAll).toEqual([])
    const roundTripped = editorStateToConditions(restored, { sort: 'recent', limit: 20 })
    expect(roundTripped.all).toEqual([{ kind: 'following', op: 'eq', value: false }])
  })

  it('復元→再適用でAND/OR/対象が変わらない（無変更の適用と同じ結果）', () => {
    const original = {
      all: [
        { kind: 'name', op: 'contains', value: 'Alpha' },
        { kind: 'following', op: 'eq', value: true },
      ],
      any: [{ kind: 'memo', op: 'exists' }],
      visibility: 'visible_only' as const,
    }
    const restored = conditionsToEditorState(original)
    const roundTripped = editorStateToConditions(restored, { sort: 'oldest', limit: 50 })
    expect(roundTripped.all).toEqual(original.all)
    expect(roundTripped.any).toEqual(original.any)
    expect(roundTripped.visibility).toBe('visible_only')
    expect(roundTripped.list).toEqual({ sort: 'oldest', limit: 50 })
  })
})

describe('FRIEND-01 絞り込みの有無を判定して空の条件を送らない', () => {
  it('「すべて」で条件が無いときは絞り込みなし（送信しない）', () => {
    const conditions = editorStateToConditions(state({ visibility: 'all' }), { sort: 'recent', limit: 20 })
    expect(hasSavedSearchFilter(conditions)).toBe(false)
  })

  it('「非表示のみ」だけでも有効な絞り込みとして送る', () => {
    const conditions = editorStateToConditions(state({ visibility: 'hidden' }), { sort: 'recent', limit: 20 })
    expect(hasSavedSearchFilter(conditions)).toBe(true)
    expect(conditions.visibility).toBe('hidden_only')
  })

  it('条件があれば対象が「すべて」でも送る', () => {
    const conditions = editorStateToConditions(state({
      visibility: 'all',
      blocks: [{ kind: 'name', keyword: 'Alpha' }],
    }), { sort: 'recent', limit: 20 })
    expect(hasSavedSearchFilter(conditions)).toBe(true)
  })
})

describe('FRIEND-03/20 条件を人が読める形で出す', () => {
  it('OR軸の実際の値・日付を表示する', () => {
    expect(describeSavedCondition({ kind: 'scenario', op: 'eq', value: 's2' }, tags, { scenarios: { s2: '2本目のシナリオ' } }))
      .toBe('シナリオが「2本目のシナリオ」')
    expect(describeSavedCondition({ kind: 'last_activity', op: 'after', value: '2026-03-01' }))
      .toBe('最終反応日が 2026-03-01以降')
    expect(describeSavedCondition({ kind: 'event_booking', op: 'exists' })).toBe('イベント予約がある')
    expect(describeSavedCondition({ kind: 'memo', op: 'exists' })).toBe('個別メモがある')
    expect(describeSavedCondition({ kind: 'common_event', op: 'exists', value: 'conversion' }))
      .toBe('その他のイベント「conversion」がある')
  })

  it('対象の範囲を1行で説明する', () => {
    expect(describeSavedVisibility({ visibility: 'visible_only', all: [{ kind: 'following', op: 'eq', value: true }] }))
      .toBe('表示中のみ')
    expect(describeSavedVisibility({ visibility: 'hidden_only' })).toBe('非表示のみ')
    expect(describeSavedVisibility({ visibility: 'all', all: [{ kind: 'following', op: 'eq', value: false }] }))
      .toBe('ブロックした人')
    expect(describeSavedVisibility({ visibility: 'all' })).toBe('すべて')
    expect(describeSavedVisibility({})).toBe('すべて')
  })
})
