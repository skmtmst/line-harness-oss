// @vitest-environment happy-dom
/*
 * 全ルート監査 A2（2026-09-25）:
 * `/line-notifications/operator/new` の「受け取る人」が
 * 「読み込めませんでした」になっていた。原因は候補の口が
 * `line-notifications` 名で無く、更新扱い（405）で返っていたこと。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ previewRecipients: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    status?: number
  },
  api: { lineNotifications: { operatorRules: { previewRecipients: (...args: unknown[]) => apiMocks.previewRecipients(...args) } } },
}))

import Page from './page'

const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  apiMocks.previewRecipients.mockReset()
})
afterEach(cleanup)

describe('operator/new の受け取る人', () => {
  it('候補の器（items/summary）で名前が出る', async () => {
    apiMocks.previewRecipients.mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 'staff-owner', name: '高橋 直人', lineLinked: true, emailVerified: true, channels: { line: true, email: false, dashboard: true }, canReceive: true },
        ],
        summary: { staff: 1, canReceive: 1, line: 1, email: 0, dashboard: 1, unavailable: 0 },
      },
    })
    render(<Page />)
    await flush()
    expect(await screen.findByText('高橋 直人')).toBeTruthy()
    expect(screen.queryByText('受け取る人を読み込めませんでした。')).toBeNull()
  })
})
