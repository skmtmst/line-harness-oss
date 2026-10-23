// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import RecoveryCodeNotice from './recovery-code-notice'
const route = vi.hoisted(() => ({ pathname: '/friends' }))
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }))
beforeEach(() => { route.pathname = '/friends' })
afterEach(() => { cleanup(); forgetSessionSnapshot() })
it('uses authenticated remaining counts and removes the low-code notice immediately after regeneration', async () => {
  const snapshot = { impersonation: null, unfamiliarAt: null, stepUpMethod: 'totp' as const, recoveryCodesRemaining: 2 }
  rememberSessionSnapshot(snapshot)
  render(<RecoveryCodeNotice />)
  await screen.findByText(/回復コードの残りが2個です/)
  act(() => rememberSessionSnapshot({ ...snapshot, recoveryCodesRemaining: 8 }))
  expect(screen.queryByText(/回復コードの残り/)).toBeNull()
})

it.each(['/friends', '/hq/templates', '/hq/banners'])('%sから本人の二段階認証へ案内する', async pathname => {
  route.pathname = pathname
  render(<RecoveryCodeNotice remaining={1} />)
  const link = await screen.findByRole('link', { name: '作り直す →' })
  expect(link.getAttribute('href')).toBe('/staff')
})
it('運営は運営の二段階認証へ案内する', async () => {
  route.pathname = '/ops/accounts'
  render(<RecoveryCodeNotice remaining={0} />)
  expect((await screen.findByRole('link', { name: '作り直す →' })).getAttribute('href')).toBe('/ops/two-factor')
})
it.each(['/staff', '/ops/two-factor'])('%sで作り直している間は同じ案内を出さない', pathname => {
  route.pathname = pathname
  render(<RecoveryCodeNotice remaining={1} />)
  expect(screen.queryByRole('link', { name: '作り直す →' })).toBeNull()
  expect(screen.queryByRole('note')).toBeNull()
})
