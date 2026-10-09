// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * V8 一覧の閲覧のみの帯（`hEDTK`）。staff（変えられない人）には
 * 見出しの下に青い帯「閲覧のみで見ています。変える操作は管理者に頼んでください。」
 * が出る。owner/admin には出ない。
 */

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/templates',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ accounts: [], selectedAccountId: 'account-1', loading: false }),
}))
vi.mock('@/lib/staff-capability', () => ({
  isOwnerOrAdmin: () => (globalThis as unknown as { __staffRole?: string }).__staffRole !== 'staff',
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    templates: {
      list: () => Promise.resolve({ success: true, data: [] }),
    },
    broadcastMessageAssets: {
      counts: () => Promise.resolve({ success: true, data: {} }),
    },
    folders: {
      list: () => Promise.resolve({ success: true, data: [] }),
    },
  },
}))

import TemplatesListV8 from './list-v8'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BAND = '閲覧のみで見ています。変える操作は管理者に頼んでください。'

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
})

afterEach(() => {
  cleanup()
  delete (globalThis as unknown as { __staffRole?: string }).__staffRole
})

async function renderAndSettle(role: string | undefined) {
  ;(globalThis as unknown as { __staffRole?: string }).__staffRole = role
  render(<TemplatesListV8 />)
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

describe('テンプレートV8一覧の閲覧のみの帯 (hEDTK)', () => {
  it('staffには帯が出る', async () => {
    await renderAndSettle('staff')
    expect(screen.getByText(BAND)).toBeTruthy()
  })

  it('ownerには帯が出ない', async () => {
    await renderAndSettle('owner')
    expect(screen.queryByText(BAND)).toBeNull()
  })
})
