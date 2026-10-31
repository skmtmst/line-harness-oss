// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PagePendingLayout } from './templates/page-pending'
const state = vi.hoisted(() => ({ accounts: [] as Array<{ id: string }>, selectedAccountId: null as string | null, loading: false, error: 'offline' as string | null, refreshing: false, refreshAccounts: vi.fn(), setSelectedAccountId: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ replace: state.replace }) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => state }))
import RootLandingGate from './root-landing-gate'
afterEach(cleanup)

it('表示先の失敗・再試行中もホームの題を保ち、取得後に本文を始める', () => {
  const draw = () => <PagePendingLayout variant="dashboard"><RootLandingGate><p>ホームの中身</p></RootLandingGate></PagePendingLayout>
  const view = render(draw())
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ダッシュボード')
  expect(screen.getByText('アカウント一覧を読み込めませんでした')).toBeTruthy()
  expect(screen.queryByText('ホームの中身')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  expect(state.refreshAccounts).toHaveBeenCalledTimes(1)
  state.refreshing = true
  view.rerender(draw())
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ダッシュボード')
  expect(screen.getByRole('button', { name: '読み込んでいます' }).hasAttribute('disabled')).toBe(true)
  state.loading = true; state.error = null
  view.rerender(draw())
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ダッシュボード')
  state.accounts = [{ id: 'a' }]; state.selectedAccountId = 'a'; state.loading = false
  view.rerender(draw())
  expect(screen.getByText('ホームの中身')).toBeTruthy()
  expect(state.replace).not.toHaveBeenCalled()
})
