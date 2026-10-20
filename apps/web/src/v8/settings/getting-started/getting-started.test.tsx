// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ role: 'owner', allowed: true, reload: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', loading: false }) }))
vi.mock('@/lib/staff-role', async (original) => ({
  ...await original<typeof import('@/lib/staff-role')>(),
  useStaffRole: () => state.role,
  useStaffIdentity: () => ({ id: 'u07-test', role: state.role, readOnly: state.role === 'viewer' }),
}))
vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/v8/onboarding/use-first-run', async () => {
  const { buildStepsFromApi } = await import('./steps')
  return { useFirstRun: () => ({ status: 'ready', error: null, reload: state.reload, steps: buildStepsFromApi(['accounts', 'featureSet', 'attributes', 'friendAdd', 'scenario', 'firstMessage'].map((key) => ({ key, state: 'done', href: state.allowed ? '/' : null, reason: null }))) }) }
})
import GettingStarted from './getting-started'
beforeEach(() => { state.role = 'owner'; state.allowed = true })
afterEach(cleanup)

it('送信せずに2つの確認経路へ案内し、受信後の読み直しを置く', () => {
  render(<GettingStarted />)
  expect(screen.getByRole('link', { name: '友だち追加のQRを開く' }).getAttribute('href')).toBe('/?qr=base')
  expect(screen.getByRole('link', { name: 'シナリオを選んでテスト送信する' }).getAttribute('href')).toBe('/scenarios')
  expect(screen.getByText(/送らずに判定するテストと受信箱の手動返信は完了に数えません/)).toBeTruthy()
  expect(state.reload).not.toHaveBeenCalled()
})
it('完了済みでも閲覧のみ・送信権限のない人には送信への入口を出さない', () => {
  state.role = 'viewer'
  const { unmount } = render(<GettingStarted />)
  expect(screen.queryByRole('link', { name: 'シナリオを選んでテスト送信する' })).toBeNull()
  unmount()
  state.role = 'owner'; state.allowed = false
  render(<GettingStarted />)
  expect(screen.queryByRole('link', { name: 'シナリオを選んでテスト送信する' })).toBeNull()
})
