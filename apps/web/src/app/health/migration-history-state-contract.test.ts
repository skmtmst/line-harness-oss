// @vitest-environment happy-dom
import { createElement, act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ accounts: vi.fn(), health: vi.fn(), migrations: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), api: { health: { accounts: calls.accounts, getHealth: calls.health, migrations: calls.migrations } } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
import HealthPage from './page'

const record = (status: string, id = status) => ({
  id, fromAccountId: 'a', toAccountId: 'b', status, migratedCount: 3, totalCount: 5,
  createdAt: '2026-10-22T00:00:00Z', completedAt: status === 'completed' ? '2026-10-22T00:05:00Z' : null,
})
beforeEach(() => {
  calls.accounts.mockResolvedValue({ success: true, data: [
    { id: 'a', name: '移行元', channelId: 'a', isActive: true },
    { id: 'b', name: '移行先', channelId: 'b', isActive: true },
  ] })
  calls.health.mockResolvedValue({ success: true, data: {} })
  calls.migrations.mockResolvedValue({ success: true, data: [] })
})
afterEach(() => cleanup())

describe('監視画面の移行履歴の読込状態', () => {
  it('読込中は0件にせず、成功0件になってから空の案内を出す', async () => {
    let resolve!: (value: unknown) => void
    calls.migrations.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    render(createElement(HealthPage))
    expect(await screen.findByText('移行履歴を読み込んでいます...')).toBeTruthy()
    expect(screen.queryByText('移行履歴はありません')).toBeNull()
    await act(async () => resolve({ success: true, data: [] }))
    expect(await screen.findByText('移行履歴はありません')).toBeTruthy()
    expect(screen.queryByText('移行履歴を読み込んでいます...')).toBeNull()
  })

  it('複数の履歴を元・先の名前と実際の状態・件数で表示する', async () => {
    calls.migrations.mockResolvedValue({ success: true, data: ['pending', 'in_progress', 'completed', 'failed'].map((status) => record(status)) })
    render(createElement(HealthPage))
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(4)
    for (const [index, label] of ['待機中', '移行中', '完了', '失敗'].entries()) {
      const row = within(rows[index])
      expect(row.getByText('移行元')).toBeTruthy()
      expect(row.getByText('移行先')).toBeTruthy()
      expect(within(row.getAllByRole('cell')[2]).getByText(label, { exact: true })).toBeTruthy()
    }
    expect(within(rows[1]).getByText('3 / 5 人')).toBeTruthy()
    expect(screen.queryByText('移行履歴はありません')).toBeNull()
  })

  it.each(['api', 'shape', 'network'])('%sの失敗を0件にせず、再読み込みで保存済みの履歴へ復帰する', async (failure) => {
    if (failure === 'network') calls.migrations.mockRejectedValueOnce(new Error('offline'))
    else calls.migrations.mockResolvedValueOnce(failure === 'api' ? { success: false, error: 'offline' } : { success: true, data: {} })
    render(createElement(HealthPage))
    expect(await screen.findByText('移行履歴を取得できませんでした。')).toBeTruthy()
    expect(screen.queryByText('移行履歴はありません')).toBeNull()
    calls.migrations.mockResolvedValueOnce({ success: true, data: [record('completed')] })
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }))
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
    expect(within(screen.getByRole('table')).getByText('完了')).toBeTruthy()
    expect(screen.queryByText('移行履歴を取得できませんでした。')).toBeNull()
    expect(calls.migrations).toHaveBeenCalledTimes(2)
  })
})
