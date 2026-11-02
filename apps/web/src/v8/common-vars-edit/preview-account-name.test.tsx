// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  account: { selectedAccountId: 'a' as string | null, selectedAccount: { id: 'a', name: '管理名A', displayName: 'LINE名A' } as { id: string; name: string; displayName?: string } | null, loading: false, error: null as string | null },
  detail: vi.fn(), create: vi.fn(), update: vi.fn(), seen: [] as Array<{ id: string | null; name: string }>,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }), useSearchParams: () => new URLSearchParams('id=var-1') }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => state.account }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/components/shared/line-preview', () => ({
  default: ({ accountName, children }: { accountName: string; children: React.ReactNode }) => {
    state.seen.push({ id: state.account.selectedAccountId, name: accountName })
    return <section data-testid="preview"><strong data-testid="preview-name">{accountName}</strong>{children}</section>
  },
  LinePreviewMessage: ({ accountName, children }: { accountName: string; children: React.ReactNode }) => <article><strong data-testid="message-name">{accountName}</strong>{children}</article>,
}))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
    commonVars: { ...actual.api.commonVars, detail: state.detail, create: state.create, update: state.update,
      schedules: async () => ({ success: true, data: [] }), deleteImpact: async () => ({ success: true, data: { variable: { id: 'var-1', name: '営業時間', varKey: 'hours' }, total: 0, blockingTotal: 0, historicalTotal: 0, unscopedFormTotal: 0, canDelete: true, byKind: {}, items: [], unavailableReferences: [], checkedAt: '2026-11-01T00:00:00Z', recommendedAction: 'delete' } }) },
  } }
})
import NewCommonVar from './new'
import EditCommonVar from './edit'

const detail = (accountId: string | null = 'a') => ({ success: true, data: {
  id: 'var-1', lineAccountId: accountId, name: '営業時間', varKey: 'hours', type: 'text', value: '10時', memo: '', status: 'active', validFrom: null, validUntil: null, expiryBehavior: 'stop', fallbackValue: null,
  version: 1, usages: [], history: [], usageCount: 0, usagePage: { total: 0, shown: 0 },
} })
const names = () => screen.queryAllByTestId('preview-name').map(node => node.textContent)
const ready = async () => waitFor(() => expect(names()).toContain('LINE名A'))
const account = (id: string) => { state.account.selectedAccountId = id; state.account.selectedAccount = { id, name: `管理名${id}`, displayName: id === 'a' ? 'LINE名A' : 'LINE名B' } }
beforeEach(() => {
  state.account = { selectedAccountId: 'a', selectedAccount: { id: 'a', name: '管理名A', displayName: 'LINE名A' }, loading: false, error: null }
  state.seen = []
  state.detail.mockReset().mockImplementation(async (_id: string, accountId: string) => detail(accountId))
  state.create.mockReset(); state.update.mockReset()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

for (const [mode, Component] of [['新規', NewCommonVar], ['編集', EditCommonVar]] as const) {
  it(`${mode}は同じ選択アカウントのLINE表示名を見本へ渡す`, async () => {
    render(<Component />); await ready()
    const preview = screen.getByTestId('preview')
    expect(preview.textContent?.match(/LINE名A/g)).toHaveLength(2)
    expect(preview.textContent).not.toContain('管理名A')
    expect(state.create).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled()
  })
  it(`${mode}は表示名が空白なら取得済み管理名を使い、両方空なら中立にする`, async () => {
    state.account.selectedAccount = { id: 'a', name: ' 管理名A ', displayName: '  ' }
    const view = render(<Component />)
    await waitFor(() => expect(names()).toContain('管理名A'))
    state.account.selectedAccount = { id: 'a', name: ' ', displayName: '' }; view.rerender(<Component />)
    expect(names()).toEqual(['アカウント名未取得'])
  })
  it.each(['loading', 'error', 'id-mismatch', 'missing-account'])(`${mode}の%sではキャッシュの名前を断定しない`, async condition => {
    const view = render(<Component />); await ready()
    if (condition === 'loading') state.account.loading = true
    if (condition === 'error') state.account.error = 'offline'
    if (condition === 'id-mismatch') state.account.selectedAccount = { id: 'b', name: '旧管理名', displayName: '旧名' }
    if (condition === 'missing-account') state.account.selectedAccount = null
    view.rerender(<Component />)
    expect(names()).toEqual(['アカウント名未取得'])
  })
}

it('編集で所属が不明な取得値からアカウント名を補完しない', async () => {
  state.detail.mockResolvedValue(detail(null)); render(<EditCommonVar />)
  await waitFor(() => expect(state.detail).toHaveBeenCalledWith('var-1', 'a'))
  await screen.findByRole('heading', { name: '営業時間' })
  expect(names()).toEqual(['アカウント名未取得'])
})
it('編集のAからBからAへの切替で最初の描画も中立となり、遅い旧detailを使わない', async () => {
  const view = render(<EditCommonVar />); await ready()
  let resolveB!: (value: ReturnType<typeof detail>) => void
  let resolveA!: (value: ReturnType<typeof detail>) => void
  state.detail.mockImplementationOnce(() => new Promise(done => { resolveB = done })).mockImplementationOnce(() => new Promise(done => { resolveA = done }))
  account('b'); state.seen = []; view.rerender(<EditCommonVar />)
  expect(state.seen[0]).toEqual({ id: 'b', name: 'アカウント名未取得' })
  account('a'); state.seen = []; view.rerender(<EditCommonVar />)
  expect(state.seen[0]).toEqual({ id: 'a', name: 'アカウント名未取得' })
  await act(async () => resolveB(detail('b')))
  expect(names()).toEqual(['アカウント名未取得'])
  await act(async () => resolveA(detail('a'))); await ready()
})
it('編集の取得失敗は既存の再読込案内となり、見本名を出さない', async () => {
  state.detail.mockRejectedValue(new Error('offline')); render(<EditCommonVar />)
  await screen.findByText('共通情報を読み込めませんでした')
  expect(names()).toEqual([]); expect(state.update).not.toHaveBeenCalled()
})
it('新規の保存失敗で入力と取得済みの見本名を保持する', async () => {
  state.create.mockRejectedValue(new Error('save offline')); render(<NewCommonVar />)
  fireEvent.change(document.getElementById('cv-name')!, { target: { value: '営業時間' } })
  fireEvent.change(document.getElementById('cv-key')!, { target: { value: 'hours' } })
  fireEvent.change(document.getElementById('cv-value')!, { target: { value: '10時' } })
  fireEvent.click(screen.getByRole('button', { name: '保存して公開' }))
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.queryByText(/保存できませんでした/)).toBeTruthy())
  expect((document.getElementById('cv-value') as HTMLInputElement).value).toBe('10時')
  expect(names()).toEqual(['LINE名A'])
  expect(state.create.mock.calls[0][0]).toEqual(expect.objectContaining({ accountId: 'a', value: '10時', status: 'active' }))
  expect(state.create.mock.calls[0][0]).not.toHaveProperty('accountName')
})
