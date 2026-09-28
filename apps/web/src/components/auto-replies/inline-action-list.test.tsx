// @vitest-environment happy-dom
/**
 * 監査 R255：必須内容が空の後続処理を未完成と示さず保存できる。
 *
 * 行ごとに不足内容の札が出て、埋めたら消える。下書き保存は止めない。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InlineActionList from './inline-action-list'
import type { InlineAction } from './draft-fields'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1' }),
}))
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ enabled: () => true }),
}))

afterEach(() => cleanup())

const EMPTY: Array<{ type: InlineAction['actionType']; config: unknown; reason: string }> = [
  { type: 'tag', config: { op: 'add', tagIds: [] }, reason: 'タグが選ばれていません' },
  { type: 'friend_field', config: { fieldId: '', op: 'set', value: '' }, reason: '友だち情報の項目が選ばれていません' },
  { type: 'scenario', config: { op: 'start', scenarioId: '', restart: 'from_start' }, reason: 'シナリオが選ばれていません' },
  { type: 'common_var', config: { varKey: '', op: 'add', value: '1' }, reason: '共通情報の項目が選ばれていません' },
  { type: 'send_message', config: { content: '' }, reason: '本文が空です' },
  { type: 'send_template', config: { templateId: '' }, reason: 'テンプレートが選ばれていません' },
  { type: 'reminder', config: { reminderId: '' }, reason: 'リマインダが選ばれていません' },
  { type: 'event_booking', config: { eventId: '' }, reason: 'イベントが選ばれていません' },
]

function toActions(): InlineAction[] {
  return EMPTY.map((item, index) => ({
    key: `action-${index + 1}`,
    actionType: item.type,
    config: item.config,
    onFailure: 'continue' as const,
  }))
}

const EMPTY_OPTIONS = { tags: [], fields: [], marks: [], scenarios: [], vars: [] }

describe('R255 空の後続処理に未完成の札が出る', () => {
  it('8種すべてに具体的な不足が出る', () => {
    render(<InlineActionList actions={toActions()} onChange={() => {}} {...EMPTY_OPTIONS} />)
    const badges = screen.getAllByText(/未完成 — /)
    expect(badges).toHaveLength(8)
    for (const item of EMPTY) {
      expect(screen.getByText(`未完成 — ${item.reason}`)).toBeTruthy()
    }
  })

  it('埋めた行の札は消え、空の行の札は残る', () => {
    const actions = toActions()
    actions[0] = { ...actions[0], config: { op: 'add', tagIds: ['tag-1'] } }
    actions[4] = { ...actions[4], config: { content: 'こんにちは' } }
    render(<InlineActionList actions={actions} onChange={() => {}} {...EMPTY_OPTIONS} />)
    expect(screen.getAllByText(/未完成 — /)).toHaveLength(6)
    expect(screen.queryByText('未完成 — タグが選ばれていません')).toBeNull()
    expect(screen.queryByText('未完成 — 本文が空です')).toBeNull()
    expect(screen.getByText('未完成 — テンプレートが選ばれていません')).toBeTruthy()
  })
})
