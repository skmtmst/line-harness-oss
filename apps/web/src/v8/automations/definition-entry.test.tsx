// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ account: 'a', canEdit: true, create: vi.fn(), replace: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.account }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => state.canEdit }))
vi.mock('@/lib/api', () => ({ api: { automations: { createDraftFromAutomation: state.create } } }))
vi.mock('@/components/shared/list-navigation', () => ({ useListNavigationRouter: () => router }))
vi.mock('@/components/shared/target-missing', () => ({ default: ({ title, onRetry }: { title: string; onRetry?: () => void }) => <div>{title}{onRetry && <button onClick={onRetry}>再試行</button>}</div> }))
const router = { replace: state.replace }
import AutomationDefinitionEntry from './definition-entry'
beforeEach(() => { state.account = 'a'; state.canEdit = true; vi.clearAllMocks() })
afterEach(cleanup)
it('名前のURLから既存の下書きへ移り、取得失敗は再試行できる', async () => {
  state.create.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ success: true, data: { id: 'draft-a' } })
  render(<AutomationDefinitionEntry automationId="rule-a" />)
  fireEvent.click(await screen.findByText('再試行'))
  await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/automations/drafts?id=draft-a'))
})
it('閲覧担当は改訂用の下書きを作らない', () => {
  state.canEdit = false
  render(<AutomationDefinitionEntry automationId="rule-a" />)
  expect(state.create).not.toHaveBeenCalled()
  expect(screen.getByText('このルールを編集する権限がありません')).toBeTruthy()
})
it('アカウントを替えたあとの古い応答では前の下書きに移らない', async () => {
  let resolve!: (value: unknown) => void
  state.create.mockReturnValueOnce(new Promise(done => { resolve = done })).mockResolvedValueOnce({ success: true, data: { id: 'draft-b' } })
  const view = render(<AutomationDefinitionEntry automationId="rule-a" />)
  state.account = 'b'
  view.rerender(<AutomationDefinitionEntry automationId="rule-a" />)
  await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/automations/drafts?id=draft-b'))
  await act(async () => resolve({ success: true, data: { id: 'draft-a' } }))
  expect(state.replace).toHaveBeenCalledTimes(1)
})
