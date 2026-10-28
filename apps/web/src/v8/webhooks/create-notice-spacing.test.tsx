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
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it.each(['staff', 'admin'] as const)('非オーナー%sは両通知と戻る操作を残し、書込を起動しない', role => {
  identity.role = role
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<WebhooksCreate />)
  expect(container.querySelector('[data-read-only-notice]')?.getAttribute('role')).toBe('status')
  expect(container.querySelector('[data-read-only-notice]')?.textContent).toContain('閲覧のみで見ています。')
  const content = container.querySelector('[data-template-region="content"]')!
  expect(content.getAttribute('data-content-spacing')).toBe('notice-after-read-only')
  expect(content.querySelector('[data-design-part="notice"]')?.textContent).toBeTruthy()
  expect(container.querySelectorAll('[data-design-part="notice"]')).toHaveLength(2)
  expect(screen.getByRole('link', { name: '一覧へ戻る' }).getAttribute('href')).toBe('/webhooks')
  expect(screen.queryByRole('button', { name: 'つくって動かす' })).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
})
it('オーナーの入力と既定の余白は維持する', () => {
  identity.role = 'owner'
  const { container } = render(<WebhooksCreate />)
  expect(container.querySelector('[data-read-only-notice]')).toBeNull()
  expect(container.querySelector('[data-template-region="content"]')!.hasAttribute('data-content-spacing')).toBe(false)
  expect(screen.getByRole('textbox', { name: /名前/ })).toBeTruthy()
})
