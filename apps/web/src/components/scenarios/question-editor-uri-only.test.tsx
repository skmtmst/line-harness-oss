// @vitest-environment happy-dom
/*
 * SCENARIO-22：URL・電話・メールなどを開くだけの選択肢は、押された通知が届かない。
 * 質問の編集欄を描いて、届かない設定の入口を出さないこと・残っている設定を本人の操作で消せることを確かめる。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const scope = vi.hoisted(() => ({ tags: vi.fn(), fields: vi.fn(), scenarios: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))
vi.mock('./scenario-reference-data', () => ({ scenarioReferenceData: { tags: scope.tags, friendFields: scope.fields, scenarios: scope.scenarios } }))
vi.mock('@/components/shared/select', () => ({
  default: ({ value, options, onChange }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
  ),
}))

import QuestionEditor, { type ScenarioQuestion } from './question-editor'

const question: ScenarioQuestion = {
  tapMode: 'single',
  text: '体調はいかがですか？',
  choices: [
    { key: 'a', label: 'はい', behavior: 'none' },
    { key: 'b', label: '詳しく見る', behavior: 'url', url: 'https://example.com', reply: 'ありがとうございます', field: { fieldId: 'f1', value: 'x' } },
  ],
}

beforeEach(() => {
  for (const fn of [scope.tags, scope.fields, scope.scenarios]) fn.mockResolvedValue({ success: true, data: [] })
})
afterEach(cleanup)

async function renderEditor(onChange = vi.fn(), onOpenChoiceActions = vi.fn()) {
  render(<QuestionEditor value={question} onChange={onChange} onOpenChoiceActions={onOpenChoiceActions} choiceColumns />)
  await act(async () => {})
  return { onChange, onOpenChoiceActions }
}

describe('SCENARIO-22: URIだけの挙動に届かない設定をさせない', () => {
  it('アクションの入口は届く挙動の選択肢にだけ出す', async () => {
    const { onOpenChoiceActions } = await renderEditor()
    const buttons = screen.getAllByRole('button', { name: 'アクション' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onOpenChoiceActions).toHaveBeenCalledWith(0)
  })

  it('残っている実行されない設定を名指しし、「実行されない設定を消す」で返信と友だち情報だけを消す', async () => {
    const { onChange } = await renderEditor()
    expect(screen.getByText('いま設定されている 選択時の返信・友だち情報欄 は実行されません。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '実行されない設定を消す' }))
    const next = onChange.mock.calls.at(-1)![0] as ScenarioQuestion
    expect(next.choices[1]).toMatchObject({ label: '詳しく見る', behavior: 'url', url: 'https://example.com' })
    expect(next.choices[1].reply).toBeUndefined()
    expect(next.choices[1].field).toBeUndefined()
    expect(next.choices[0]).toEqual(question.choices[0])
  })
})
