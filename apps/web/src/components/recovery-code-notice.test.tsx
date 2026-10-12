// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import RecoveryCodeNotice from './recovery-code-notice'
vi.mock('next/navigation', () => ({ usePathname: () => '/friends' }))
afterEach(() => { cleanup(); forgetSessionSnapshot() })
it('uses authenticated remaining counts and removes the low-code notice immediately after regeneration', async () => {
  const snapshot = { impersonation: null, unfamiliarAt: null, stepUpMethod: 'totp' as const, recoveryCodesRemaining: 2 }
  rememberSessionSnapshot(snapshot)
  render(<RecoveryCodeNotice />)
  await screen.findByText(/回復コードの残りが2個です/)
  act(() => rememberSessionSnapshot({ ...snapshot, recoveryCodesRemaining: 8 }))
  expect(screen.queryByText(/回復コードの残り/)).toBeNull()
})
