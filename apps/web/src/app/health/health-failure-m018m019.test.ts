// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pickEntity } from '@/components/shared/entity-picker-test-helpers'

const calls = vi.hoisted(() => ({ role: 'owner', accounts: vi.fn(), health: vi.fn(), migrations: vi.fn(), migrate: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), api: { health: { accounts: calls.accounts, getHealth: calls.health, migrations: calls.migrations, migrate: calls.migrate } } }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => calls.role }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
import HealthPage from './page'

beforeEach(() => {
  calls.role = 'owner'
  calls.accounts.mockResolvedValue({ success: true, data: [
    { id: 'a', name: '移行元', channelId: 'a', isActive: true },
    { id: 'b', name: '移行先', channelId: 'b', isActive: true },
  ] })
  calls.health.mockResolvedValue({ success: true, data: { riskLevel: 'danger' } })
  calls.migrations.mockResolvedValue({ success: true, data: [] })
})
afterEach(() => cleanup())

describe('監視画面の読込失敗と移行権限', () => {
  it.each(['response', 'network'])('%sのアカウント読込失敗を未登録にせず、再読込で戻れる', async (failure) => {
    if (failure === 'network') calls.accounts.mockRejectedValueOnce(new Error('offline'))
    else calls.accounts.mockResolvedValueOnce({ success: false, error: 'offline' })
    render(createElement(HealthPage))
    const retry = await screen.findByRole('button', { name: 'もう一度読み込む' })
    expect(screen.queryByText('LINEアカウントが登録されていません')).toBeNull()
    fireEvent.click(retry)
    expect(await screen.findByRole('button', { name: /移行元/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull()
    expect(calls.accounts).toHaveBeenCalledTimes(2)
  })

  it('成功0件だけを未登録として案内する', async () => {
    calls.accounts.mockResolvedValue({ success: true, data: [] })
    render(createElement(HealthPage))
    expect(await screen.findByText('LINEアカウントが登録されていません')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull()
  })

  it.each(['admin', 'staff', 'readonly', 'unknown'])('%sに押せない移行の入口を置かない', async (role) => {
    calls.role = role
    render(createElement(HealthPage))
    fireEvent.click(await screen.findByRole('button', { name: /移行元/ }))
    expect(screen.getByText('友だちの移行はオーナーだけができます。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '友だちを移行する' })).toBeNull()
    expect(calls.migrate).not.toHaveBeenCalled()
  })

  it('オーナーの移行が403で拒否されたら理由を示し、選択を残して再実行できる', async () => {
    calls.migrate.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))
    calls.migrate.mockResolvedValueOnce({ success: true, data: {} })
    render(createElement(HealthPage))
    fireEvent.click(await screen.findByRole('button', { name: /移行元/ }))
    fireEvent.click(screen.getByRole('button', { name: '友だちを移行する' }))
    await pickEntity('移行先アカウント', '移行先 (b)')
    fireEvent.click(screen.getByRole('button', { name: '移行を開始' }))
    expect(await screen.findByText('この操作の権限がありません。オーナーか管理者に頼んでください。')).toBeTruthy()
    expect(calls.migrate).toHaveBeenCalledWith('a', { toAccountId: 'b' })
    expect(screen.getByRole('heading', { name: '友だち移行: 移行元' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '移行を開始' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '移行を開始' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: '友だち移行: 移行元' })).toBeNull())
    expect(calls.migrate).toHaveBeenNthCalledWith(2, 'a', { toAccountId: 'b' })
    expect(calls.migrations).toHaveBeenCalledTimes(2)
  })

  it('失敗を一律の古い文に戻さない', () => {
    const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')
    expect(PAGE).not.toContain('アカウント情報の取得に失敗しました。もう一度読み込んでください。')
    expect(PAGE).not.toContain('アカウント情報の読み込みに失敗しました。もう一度お試しください。')
    expect(PAGE).not.toContain('移行リクエストに失敗しました。通信を確かめて、もう一度お試しください。')
  })
})
