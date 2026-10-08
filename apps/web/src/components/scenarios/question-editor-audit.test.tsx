// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const scope = vi.hoisted(() => ({ account: 'a', tags: vi.fn(), fields: vi.fn(), scenarios: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: scope.account }) }))
vi.mock('./scenario-reference-data', () => ({ scenarioReferenceData: { tags: scope.tags, friendFields: scope.fields, scenarios: scope.scenarios } }))
vi.mock('@/components/shared/select', () => ({ default: ({ value, options, onChange }: {value: string; onChange: (value: string) => void; options: Array<{value: string; label: string}>; 'aria-label'?: string}) => <select value={value} onChange={e => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }))
import QuestionEditor from './question-editor'
afterEach(cleanup)
const question = { tapMode: 'single' as const, title: '質問', text: '選ぶ', choices: ['A','B'].map(key => ({ key, label: key, behavior: 'scenario' as const, scenario: { op: 'start' as const, scenarioId: 's', restart: 'from_start' as const } })) }
it('WEB265: 選択肢ごとの再開ラジオを独立したグループにする', async () => {
  for (const fn of [scope.tags, scope.fields, scope.scenarios]) fn.mockResolvedValue({ success: true, data: [] })
  const view = render(<QuestionEditor value={question} onChange={() => {}} choiceColumns />)
  await act(async () => {})
  const groups = [...view.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(el => el.name)
  expect(groups.length).toBe(4)
  expect(new Set(groups).size).toBe(2)
})

it('WEB261/262: 持ち主の候補を使い、切替前の遅い応答を捨てる', async () => {
  let resolveOld!: (value: unknown) => void
  scope.tags.mockImplementation((id: string) => id === 'owner-a' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ success: true, data: [{ id: 'b', name: '新しいタグ' }] }))
  scope.fields.mockResolvedValue({ success: true, data: [] })
  scope.scenarios.mockResolvedValue({ success: true, data: [] })
  const view = render(<QuestionEditor accountId="owner-a" value={question} onChange={() => {}} choiceColumns />)
  await act(async () => {})
  expect(scope.tags).toHaveBeenLastCalledWith('owner-a')
  view.rerender(<QuestionEditor accountId="owner-b" value={question} onChange={() => {}} choiceColumns />)
  await act(async () => {})
  await act(async () => resolveOld({ success: true, data: [{ id: 'old', name: '古いタグ' }] }))
  expect(view.container.textContent).not.toContain('古いタグ')
  expect(view.container.textContent).toContain('新しいタグ')
})
