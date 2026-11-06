// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushListUrlState, writeListUrlParam } from '@/components/shared/list-url-state'

const fx = vi.hoisted(() => ({ account: 'A', list: vi.fn(), tags: vi.fn(), scenarios: vi.fn(), marks: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/friends' }))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fx.account, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: (key: string) => key === 'support_marks' }) }))
vi.mock('@/lib/operators-cache', () => ({ loadOperators: async () => ({ success: true, data: [] }) }))
vi.mock('@/components/shared/select', () => ({ default: ({ options, value, onChange, 'aria-label': label }: { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void; 'aria-label'?: string }) => <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, friends: { list: fx.list }, friendStats: { get: async () => ({ success: false }) }, tags: { list: fx.tags }, scenarios: { list: fx.scenarios }, supportMarks: { list: fx.marks } } }
})
import List from '@/v8/friends/list/list'

const answer = (name: string, total = 1) => ({ success: true, data: { items: [{ id: name, displayName: name, tags: [], createdAt: '2026-10-01' }], total } })
function deferred() {
  let resolve!: (value: ReturnType<typeof answer>) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<ReturnType<typeof answer>>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  fx.account = 'A'
  flushListUrlState()
  window.history.replaceState(null, '', '/friends')
  for (const load of [fx.tags, fx.scenarios, fx.marks]) load.mockReset().mockResolvedValue({ success: true, data: [] })
  fx.list.mockReset().mockResolvedValue(answer('最初の行', 100))
})
afterEach(() => { cleanup(); sessionStorage.clear() })

describe('友だち一覧の応答対象照合', () => {
  it.each(['成功', '例外'] as const)('アカウント切替後は前の行と件数を隠し、遅れた%sも採用しない', async outcome => {
    const view = render(<List />)
    await screen.findByText('最初の行')
    const old = deferred(), current = deferred()
    fx.list.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise)
    fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
    await waitFor(() => expect(fx.list).toHaveBeenCalledWith(expect.objectContaining({ offset: '20' })))
    fx.account = 'B'
    view.rerender(<List />)
    expect(screen.queryByText('最初の行')).toBeNull()
    expect(document.body.textContent).not.toContain('100件')
    await act(async () => current.resolve(answer('Bの行', 3)))
    await screen.findByText('Bの行')
    await act(async () => outcome === '成功' ? old.resolve(answer('Aの遅い行', 100)) : old.reject(new Error('古い失敗')))
    expect(screen.queryByText('Aの遅い行')).toBeNull()
    expect(screen.queryByText('友だちを読み込めませんでした')).toBeNull()
    expect(screen.getByText('Bの行')).toBeTruthy()
  })

  it.each(['ページ', '件数', '並び順', '絞り込み'] as const)('%sの変更でも旧条件の応答を採用しない', async change => {
    const old = deferred(), current = deferred()
    const view = render(<List />)
    await screen.findByText('最初の行')
    fx.list.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise)
    fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
    await waitFor(() => expect(fx.list).toHaveBeenCalledWith(expect.objectContaining({ offset: '20' })))
    if (change === 'ページ') {
      act(() => { writeListUrlParam('page', '3'); flushListUrlState() })
    } else if (change === '件数') {
      fireEvent.change(screen.getByRole('combobox', { name: /表示件数/ }), { target: { value: '50' } })
    } else if (change === '並び順') {
      fireEvent.change(screen.getByRole('combobox', { name: /並び/ }), { target: { value: 'oldest' } })
    } else {
      fireEvent.click(screen.getByRole('button', { name: '未対応' }))
    }
    await waitFor(() => expect(fx.list.mock.calls.length).toBeGreaterThanOrEqual(3))
    await act(async () => current.resolve(answer('今の条件の行', 100)))
    await act(async () => old.resolve(answer('古い条件の行', 100)))
    expect(screen.queryByText('古い条件の行')).toBeNull()
    expect(screen.getByText('今の条件の行')).toBeTruthy()
  })

  it('AからBを経てAに戻っても、最初のAの遅い応答を採用しない', async () => {
    const old = deferred(), current = deferred()
    fx.list.mockReturnValueOnce(old.promise).mockResolvedValueOnce(answer('Bの行')).mockReturnValueOnce(current.promise)
    const view = render(<List />)
    await waitFor(() => expect(fx.list).toHaveBeenCalledTimes(1))
    fx.account = 'B'; view.rerender(<List />)
    await screen.findByText('Bの行')
    fx.account = 'A'; view.rerender(<List />)
    await act(async () => current.resolve(answer('今のAの行')))
    await screen.findByText('今のAの行')
    await act(async () => old.resolve(answer('最初のAの遅い行')))
    expect(screen.queryByText('最初のAの遅い行')).toBeNull()
    expect(screen.getByText('今のAの行')).toBeTruthy()
  })

  it('アカウント切替後も新しい一覧の行を選べる', async () => {
    const view = render(<List />)
    await screen.findByText('最初の行')
    fx.account = 'B'
    fx.list.mockResolvedValue(answer('Bの行'))
    view.rerender(<List />)
    await screen.findByText('Bの行')
    const checkbox = screen.getByRole('checkbox', { name: 'Bの行を選ぶ' }) as HTMLInputElement
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
    expect(checkbox.closest('tr')?.getAttribute('aria-selected')).toBe('true')
  })

  it('アカウント固有の候補も遅い旧応答で上書きしない', async () => {
    let finish!: (value: unknown) => void
    fx.scenarios.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const view = render(<List />)
    await screen.findByText('最初の行')
    fx.account = 'B'
    view.rerender(<List />)
    await waitFor(() => expect(fx.scenarios).toHaveBeenCalledWith({ accountId: 'B' }))
    await act(async () => finish({ success: true, data: [{ id: 'old', name: 'Aだけの候補' }] }))
    expect(screen.queryByText('Aだけの候補')).toBeNull()
  })
})
