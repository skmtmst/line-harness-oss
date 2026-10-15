// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ role: 'owner' as 'owner' | 'viewer', impact: vi.fn(), remove: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams('id=var-1') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => state.role }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
    commonVars: { ...actual.api.commonVars,
      detail: async () => ({ success: true, data: { id: 'var-1', name: '営業時間', key: 'hours', type: 'text', value: '10時', memo: '', status: 'active', validFrom: null, validUntil: null, version: 1, usages: [], history: [], usageCount: 0, usagePage: { total: 0, shown: 0 } } }),
      schedules: async () => ({ success: true, data: [] }), deleteImpact: state.impact, delete: state.remove,
    },
  } }
})
import Editor from './edit'

beforeEach(() => {
  state.role = 'owner'
  state.impact.mockReset().mockResolvedValue({ success: true, data: {
    variable: { id: 'var-1', name: '営業時間', varKey: 'hours' }, total: 0, blockingTotal: 0,
    historicalTotal: 0, unscopedFormTotal: 0, canDelete: true, byKind: {}, items: [],
    unavailableReferences: [], checkedAt: '2026-10-14T00:00:00+09:00', recommendedAction: 'delete',
  } })
  state.remove.mockReset()
})
afterEach(cleanup)

it('下帯の削除入口に印があり、押すと使用先を確認し、取消では削除しない', async () => {
  render(<Editor />)
  const trigger = await screen.findByRole('button', { name: '削除する', exact: true })
  expect(trigger.className).toContain('danger-outline')
  expect(trigger.querySelector('svg.lucide-trash-2')?.getAttribute('aria-hidden')).toBe('true')
  expect(trigger.closest('[data-shared-part="sticky-bar"]')).not.toBeNull()
  fireEvent.click(trigger)
  const dialog = await screen.findByRole('alertdialog')
  await within(dialog).findByText('使っている設定はありません。')
  expect(state.impact).toHaveBeenCalledWith('var-1', 'a')
  expect(within(dialog).queryByRole('button', { name: '削除する', exact: true })).toBeNull()
  fireEvent.change(within(dialog).getByRole('textbox', { name: /消した理由/ }), { target: { value: '店舗情報の変更のため' } })
  const confirm = within(dialog).getByRole('button', { name: '削除する', exact: true })
  expect(confirm.className).toContain('danger')
  expect(confirm.className).not.toContain('danger-outline')
  expect(state.remove).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: '閉じる', exact: true }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(state.remove).not.toHaveBeenCalled()
})

it('閲覧のみの人には、下帯の削除入口を出さない', async () => {
  state.role = 'viewer'
  render(<Editor />)
  await screen.findByRole('heading', { name: '営業時間', exact: true })
  expect(screen.queryByRole('button', { name: '削除する', exact: true })).toBeNull()
  expect(state.impact).not.toHaveBeenCalled()
  expect(state.remove).not.toHaveBeenCalled()
})
