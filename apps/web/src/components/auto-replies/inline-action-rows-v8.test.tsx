// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1' }) }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => true }) }))
vi.mock('@/components/scenarios/action-editor', () => ({
  ACTION_KINDS: [{ type: 'tag', label: 'タグ操作', make: () => ({ op: 'add', tagIds: [] }) }],
  ActionConfigEditor: () => <p>中身の編集</p>,
}))

import InlineActionRowsV8, { actionRowTitle } from './inline-action-rows-v8'
import type { InlineAction } from './draft-fields'

afterEach(cleanup)

const opts = { tags: [{ id: 't1', name: '予約' }], fields: [], marks: [{ id: 'm1', name: '予約変更' }], scenarios: [], vars: [], notificationRules: [{ id: 'r1', name: 'Kenta Kawano', version: 1 }] }
const a = (over: Partial<InlineAction>): InlineAction => ({ key: 'k1', actionType: 'support_mark', config: { markId: 'm1' }, onFailure: 'continue', ...over })

describe('返したあとに行うこと（V8 の行）', () => {
  it('何をするか「どれを」を1行で出す', () => {
    expect(actionRowTitle(a({}), opts)).toBe('対応マークを付ける「予約変更」')
    expect(actionRowTitle(a({ actionType: 'notify_staff', config: { notificationRuleId: 'r1' } }), opts)).toBe('担当者へ知らせる「Kenta Kawano」')
    expect(actionRowTitle(a({ actionType: 'tag', config: { op: 'remove', tagIds: ['t1'] } }), opts)).toBe('タグを外す「予約」')
  })

  it('失敗したらの動きを変えると、その行だけが変わる', () => {
    const onChange = vi.fn()
    render(<InlineActionRowsV8 actions={[a({}), a({ key: 'k2' })]} onChange={onChange} {...opts} />)
    // 選ぶ欄は共通の Select（ボタン＋一覧）。開いて「ここで止める」を押す。
    fireEvent.click(screen.getByRole('button', { name: '1つ目の失敗したときの動き' }))
    fireEvent.click(screen.getByRole('button', { name: 'ここで止める' }))
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls.at(-1)?.[0] as InlineAction[]
    expect(next[0].onFailure).toBe('stop')
    expect(next[1].onFailure).toBe('continue')
  })

  it('何も無いときは足し方を出す', () => {
    render(<InlineActionRowsV8 actions={[]} onChange={() => {}} {...opts} />)
    expect(screen.getByText('まだ何もありません。「処理を足す」から選んでください。')).toBeTruthy()
    expect(screen.getByRole('button', { name: /処理を足す/ })).toBeTruthy()
  })
})
