// @vitest-environment happy-dom
/*
 * S4-OR（動作条件の証明）: 終了後アクションの条件で、空の or だけ足して
 * 保存しても update の口は呼ばれず、不足の案内が出る。
 * 中身を入れたかたまり・条件なし（null）は保存できる。
 */
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ActionEditor from './action-editor'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const net = vi.hoisted(() => ({
  update: vi.fn(), draft: vi.fn(), saveDraft: vi.fn(),
  updates: [] as Array<{ scenarioId: string; actionId: string; patch: unknown }>,
}))

const SEED_ACTION = {
  id: 'a1',
  hook: 'scenario_completed',
  stepId: null,
  choiceIndex: null,
  actionType: 'tag',
  config: { op: 'add', tagIds: [] },
  condition: null,
  repeatOnRefire: true,
  sortOrder: 0,
}

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', accounts: [] }),
}))

vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready' as const, features: {}, enabled: () => true }),
}))

vi.mock('./scenario-reference-data', () => ({
  scenarioReferenceData: {
    tags: async () => ({ success: true as const, data: [] }),
    friendFields: async () => ({ success: true as const, data: [] }),
    supportMarks: async () => ({ success: true as const, data: [] }),
    scenarios: async () => ({ success: true as const, data: [] }),
    commonVars: async () => ({ success: true as const, data: [] }),
    templates: async () => ({ success: true as const, data: [] }),
    reminders: async () => ({ success: true as const, data: [] }),
    events: async () => ({ success: true as const, data: [] }),
  },
}))

vi.mock('@/lib/api', () => ({
  api: {
    scenarios: {
      list: async () => ({ success: true as const, data: [] }),
      actions: {
        list: async () => ({ success: true as const, data: [SEED_ACTION] }),
        update: net.update,
      },
      getDraft: net.draft,
      saveDraft: net.saveDraft,
    },
    tags: { list: async () => ({ success: true as const, data: [] }) },
    friendFields: { list: async () => ({ success: true as const, data: [] }) },
    supportMarks: { list: async () => ({ success: true as const, data: [] }) },
    segments: { count: async () => ({ success: true as const, data: { count: 0 } }) },
  },
}))

afterEach(() => {
  cleanup()
  net.updates = []
})

async function renderEditor() {
  await act(async () => {
    render(
      <ActionEditor
        scenarioId="sc-1"
        hook="scenario_completed"
        title="テストのあと"
        onClose={() => {}}
      />,
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function openCondition() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '条件OFF' }))
  })
}

function orAddButton() {
  return screen.getByRole('button', { name: /いずれか1つ以上を満たす.*を追加/ })
}

function kindPickers() {
  return screen.getAllByRole('combobox', { name: '追加する条件を選ぶ' })
}

function pickKind(field: HTMLElement, query: string) {
  fireEvent.focus(field)
  fireEvent.change(field, { target: { value: query } })
  fireEvent.keyDown(field, { key: 'ArrowDown' })
  fireEvent.keyDown(field, { key: 'Enter' })
}

async function saveCondition() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '条件を保存する' }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}


const sibling = { id: 'sibling', hook: 'step_sent', stepId: 'other-step', choiceKey: null, type: 'send_text', params: { content: '他の通' }, condition: null, onFailure: 'stop', sortOrder: 0 }
function setup() {
  net.update.mockReset().mockResolvedValue({ success: true, data: {} })
  net.draft.mockReset().mockResolvedValue({ success: true, data: { version: 4, afterActions: [sibling] } })
  net.saveDraft.mockReset().mockResolvedValue({ success: true, data: { version: 5 } })
}
it('WEB267: 一部のアクションを保存しても別の通の下書きを消さない', async () => {
  setup()
  await renderEditor()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '内容を編集' })))
  await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: '発動2回目以降も実行する' })))
  expect(net.saveDraft).toHaveBeenCalled()
  expect(net.saveDraft.mock.calls.at(-1)![1].afterActions).toContainEqual(sibling)
  expect(net.saveDraft.mock.calls.at(-1)![1].expectedVersion).toBe(4)
})
it('WEB264: 反映は保存待ちを閉じず、通信失敗を表示する', async () => {
  setup()
  let reject!: (error: Error) => void
  net.update.mockImplementation(() => new Promise((_, fail) => { reject = fail }))
  const close = vi.fn()
  await act(async () => render(<ActionEditor scenarioId="sc-1" hook="scenario_completed" title="あと" onClose={close} />))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '内容を編集' })))
  await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: '発動2回目以降も実行する' })))
  fireEvent.click(screen.getByRole('button', { name: 'このアクションを反映' }))
  expect(close).not.toHaveBeenCalled()
  await act(async () => reject(new Error('通信失敗')))
  expect(screen.getByText(/通信失敗/)).toBeTruthy()
  expect(close).not.toHaveBeenCalled()
})
