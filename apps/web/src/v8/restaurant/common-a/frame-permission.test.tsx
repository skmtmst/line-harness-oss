// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import RestaurantFrame, { RestaurantPage } from './frame'
import RestaurantShell from '../booking-kit/shell'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { READ_ONLY_MESSAGE, READ_ONLY_MESSAGE_HQ } from '@/components/shared/read-only-notice'
import { PERMISSION_LOCK_SUMMARY } from '@/components/shared/permission-lock'

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: null }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
beforeEach(() => { forgetStaffIdentity(); forgetSessionSnapshot() })
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot() })

it.each([
  { role: 'viewer', readOnly: true, need: undefined, expected: READ_ONLY_MESSAGE },
  { role: 'viewer', readOnly: 'hq', need: undefined, expected: READ_ONLY_MESSAGE_HQ },
  { role: 'staff', readOnly: true, need: 'manager', expected: PERMISSION_LOCK_SUMMARY.manager },
  { role: 'admin', readOnly: true, need: 'owner', expected: PERMISSION_LOCK_SUMMARY.owner },
] as const)('題の直下へ実際の共通権限帯を1つ置く: %j', ({ role, readOnly, need, expected }) => {
  verifiedStaffRole(role)
  const view = render(<RestaurantPage boardId="fixture" title="店舗の設定" description="店舗の情報" readOnly={readOnly} readOnlyNeed={need}>
    <section aria-label="設定内容">内容</section>
  </RestaurantPage>)
  const heading = screen.getByRole('heading', { name: '店舗の設定' })
  const notice = screen.getByRole('status')
  const content = screen.getByRole('region', { name: '設定内容' })
  expect(notice.textContent).toBe(expected)
  expect(view.container.querySelectorAll('[data-read-only-notice]')).toHaveLength(1)
  expect(heading.closest('header')?.contains(notice)).toBe(true)
  expect(heading.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(notice.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it.each([undefined, false] as const)('帯を指定しない従来画面はそのまま: %s', readOnly => {
  verifiedStaffRole('viewer')
  render(<RestaurantPage boardId="fixture" title="店舗の設定" description="店舗の情報" readOnly={readOnly}>内容</RestaurantPage>)
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByText('内容')).toBeTruthy()
})

it('本人が未知の時は権限拒否の文を出さない', () => {
  render(<RestaurantPage boardId="fixture" title="店舗の設定" description="店舗の情報" readOnly readOnlyNeed="manager">内容</RestaurantPage>)
  expect(screen.queryByRole('status')).toBeNull()
})

it('代理閲覧は必要権限より優先した既存の理由を使う', () => {
  verifiedStaffRole('owner')
  rememberSessionSnapshot({ impersonation: { mode: 'read' } } as Parameters<typeof rememberSessionSnapshot>[0])
  render(<RestaurantPage boardId="fixture" title="店舗の設定" description="店舗の情報" readOnly readOnlyNeed="owner">内容</RestaurantPage>)
  expect(screen.getByRole('status').textContent).toBe(PERMISSION_LOCK_SUMMARY.impersonation)
})

it('取得を持つ枠でも同じ口を題へ渡し、本人の読み込みを始めない', () => {
  verifiedStaffRole('viewer')
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  try {
    const view = render(<RestaurantFrame boardId="fixture" title="店舗の設定" description="店舗の情報" readOnly="hq" readOnlyNeed="tenantWide" banner={false}>
      {() => <p>取得後の内容</p>}
    </RestaurantFrame>)
    const notice = screen.getByRole('status')
    expect(notice.textContent).toBe(READ_ONLY_MESSAGE_HQ)
    expect(view.container.querySelector('header')?.contains(notice)).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})


it.each([true, false])('予約用の枠も両方の見出し経路へ必要権限を渡す: templateHeading=%s', templateHeading => {
  verifiedStaffRole('staff')
  const view = render(<RestaurantShell boardId="fixture" title="在庫の設定" description="店舗の情報" templateHeading={templateHeading} readOnly readOnlyNeed="manager" boundary={false} />)
  const notice = screen.getByRole('status')
  expect(notice.textContent).toBe(PERMISSION_LOCK_SUMMARY.manager)
  expect(view.container.querySelectorAll('[data-read-only-notice]')).toHaveLength(1)
  expect(view.container.querySelector('header')?.contains(notice)).toBe(true)
})
it.each([true, false])('予約用の枠でも統括の閲覧のみの文を渡す: templateHeading=%s', templateHeading => {
  verifiedStaffRole('viewer')
  render(<RestaurantShell boardId="fixture" title="在庫の設定" description="店舗の情報" templateHeading={templateHeading} readOnly="hq" boundary={false} />)
  expect(screen.getByRole('status').textContent).toBe(READ_ONLY_MESSAGE_HQ)
})
it.each([true, false])('予約用の枠でも本人未知や従来の指定なしで帯を出さない: templateHeading=%s', templateHeading => {
  const view = render(<RestaurantShell boardId="fixture" title="在庫の設定" description="店舗の情報" templateHeading={templateHeading} readOnly boundary={false} />)
  expect(screen.queryByRole('status')).toBeNull()
  verifiedStaffRole('viewer')
  view.rerender(<RestaurantShell boardId="fixture" title="在庫の設定" description="店舗の情報" templateHeading={templateHeading} boundary={false} />)
  expect(screen.queryByRole('status')).toBeNull()
})
