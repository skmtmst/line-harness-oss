// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ role: null as string | null }))
vi.mock('@/lib/staff-role', async (original) => ({
  ...await original<typeof import('@/lib/staff-role')>(),
  useStaffRole: () => fixture.role,
}))
vi.mock('@/lib/api', () => ({ api: {
  affiliates: { list: async () => ({ success: true, data: [] }) },
  affiliateOffers: { list: async () => ({ success: true, data: [] }) },
} }))
vi.mock('./tabs', () => ({ listAllConversionApprovals: async () => ({ items: [], truncated: false }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a' }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('./v8-affiliates-tab', () => ({ default: ({ canEdit }: { canEdit: boolean }) => <button disabled={!canEdit}>登録</button> }))
vi.mock('./v8-offers-tab', () => ({ default: () => null }))
vi.mock('./v8-approvals-tab', () => ({ default: () => null }))
vi.mock('./v8-payment-tab', () => ({ default: () => null }))
vi.mock('./v8-report-tab', () => ({ default: () => null }))
import AffiliatesV8 from './affiliates-v8'

afterEach(() => { cleanup(); fixture.role = null })
it('権限を確認する前と閲覧担当は変更できず、管理者と分かった後だけ変更できる', () => {
  const { rerender } = render(<AffiliatesV8 />)
  expect((screen.getByRole('button', { name: '登録' }) as HTMLButtonElement).disabled).toBe(true)
  fixture.role = 'staff'
  rerender(<AffiliatesV8 />)
  expect((screen.getByRole('button', { name: '登録' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toContain('閲覧のみ')
  fixture.role = 'owner'
  rerender(<AffiliatesV8 />)
  expect((screen.getByRole('button', { name: '登録' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.queryByRole('status')).toBeNull()
})
