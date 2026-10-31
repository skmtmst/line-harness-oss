// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const identity = vi.hoisted(() => ({ role: 'staff' as 'owner' | 'admin' | 'staff' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/webhooks/new', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '本店' } }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => identity.role }))
import WebhooksCreate from './create'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { PERMISSION_LOCK_SUMMARY } from '@/components/shared/permission-lock'
afterEach(() => { cleanup(); vi.unstubAllGlobals(); verifiedStaffRole(null) })
it.each(['staff'] as const)('作成できない%sは通知を1つと戻る操作を残し、書込を起動しない', role => {
  identity.role = verifiedStaffRole(role)
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<WebhooksCreate />)
  expect(container.querySelector('[data-read-only-notice]')?.getAttribute('role')).toBe('status')
  expect(container.querySelector('[data-read-only-notice]')?.textContent).toContain(PERMISSION_LOCK_SUMMARY.feature)
  const content = container.querySelector('[data-template-region="content"]')!
  expect(content.hasAttribute('data-content-spacing')).toBe(false)
  expect(container.querySelectorAll('[data-design-part="notice"]')).toHaveLength(1)
  expect(screen.getByRole('link', { name: '一覧へ戻る' }).getAttribute('href')).toBe('/webhooks')
  expect(screen.queryByRole('button', { name: 'つくって動かす' })).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
})
it.each(['owner', 'admin'] as const)('%s は入力でき、権限の帯を重ねない', role => {
  identity.role = verifiedStaffRole(role)
  const { container } = render(<WebhooksCreate />)
  expect(container.querySelector('[data-read-only-notice]')).toBeNull()
  expect(container.querySelector('[data-template-region="content"]')!.hasAttribute('data-content-spacing')).toBe(false)
  expect(screen.getByRole('textbox', { name: /名前/ })).toBeTruthy()
})
