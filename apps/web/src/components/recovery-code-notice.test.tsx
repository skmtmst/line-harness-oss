// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import RecoveryCodeNotice from './recovery-code-notice'
const route = vi.hoisted(() => ({ pathname: '/friends' }))
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }))
beforeEach(() => { route.pathname = '/friends' })
afterEach(() => { cleanup(); forgetSessionSnapshot(); localStorage.clear(); vi.useRealTimers() })
it('uses authenticated remaining counts and removes the low-code notice immediately after regeneration', async () => {
  const snapshot = { impersonation: null, unfamiliarAt: null, stepUpMethod: 'totp' as const, recoveryCodesRemaining: 2 }
  rememberSessionSnapshot(snapshot)
  render(<RecoveryCodeNotice />)
  await screen.findByText('回復コードが残り少なくなっています（残り 2 個）')
  act(() => rememberSessionSnapshot({ ...snapshot, recoveryCodesRemaining: 8 }))
  expect(screen.queryByRole('note')).toBeNull()
})

it.each(['/friends', '/hq/templates', '/hq/banners'])('%sから本人の二段階認証へ案内する', async pathname => {
  route.pathname = pathname
  render(<RecoveryCodeNotice remaining={1} />)
  const link = await screen.findByRole('link', { name: '作り直す' })
  expect(link.getAttribute('href')).toBe('/staff')
})
it('運営は運営の二段階認証へ案内する', async () => {
  route.pathname = '/ops/accounts'
  render(<RecoveryCodeNotice remaining={0} />)
  expect((await screen.findByRole('link', { name: '作り直す' })).getAttribute('href')).toBe('/ops/two-factor')
})
it.each(['/staff', '/ops/two-factor'])('%sで作り直している間は同じ案内を出さない', pathname => {
  route.pathname = pathname
  render(<RecoveryCodeNotice remaining={1} />)
  expect(screen.queryByRole('link', { name: '作り直す' })).toBeNull()
  expect(screen.queryByRole('note')).toBeNull()
})

it.each([[0, '回復コードが残っていません'], [1, '回復コードが残り少なくなっています（残り 1 個）'], [2, '回復コードが残り少なくなっています（残り 2 個）']])('残り%i個の題は数と合う', async (remaining, heading) => {
  render(<RecoveryCodeNotice remaining={remaining} />)
  expect(await screen.findByText(heading)).toBeTruthy()
})

it('［閉じる］でその日はその端末で出さず、日が変わるとまた出す。作り直すの道は残す', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-25T03:00:00Z'))
  const view = render(<RecoveryCodeNotice remaining={0} />)
  expect((await screen.findByRole('link', { name: '作り直す' })).getAttribute('href')).toBe('/staff')
  fireEvent.click(screen.getByRole('button', { name: '通知を閉じる' }))
  expect(screen.queryByRole('note')).toBeNull()
  view.unmount()
  route.pathname = '/broadcasts'
  const again = render(<RecoveryCodeNotice remaining={0} />)
  expect(screen.queryByRole('note')).toBeNull()
  again.unmount()
  // 日本時間の次の日（10/26 0:00 JST = 10/25 15:00 UTC）にはまた出る。
  vi.setSystemTime(new Date('2026-10-25T15:00:00Z'))
  render(<RecoveryCodeNotice remaining={0} />)
  expect(await screen.findByText('回復コードが残っていません')).toBeTruthy()
})

it.each(['/', '/settings', '/hq/settings'])('%sでは閉じた日も残し、閉じる印を出さない', async pathname => {
  render(<RecoveryCodeNotice remaining={1} />)
  fireEvent.click(await screen.findByRole('button', { name: '通知を閉じる' }))
  cleanup()
  route.pathname = pathname
  render(<RecoveryCodeNotice remaining={1} />)
  expect(await screen.findByRole('link', { name: '作り直す' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '通知を閉じる' })).toBeNull()
})
