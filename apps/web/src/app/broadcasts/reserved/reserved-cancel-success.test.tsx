// @vitest-environment happy-dom
/*
 * 監査 WEB317：予約の取消が成功したら、成功の知らせを出す。
 * 応答は下書き（scheduledAt なし）なので、「予約待ちではありません」の画面に戻さない。
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ cancelReservation: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? 'bc-1' : null) }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false, accounts: [] }),
}))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => null }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn(), usePageCrumbs: vi.fn() }))

const scheduled = {
  id: 'bc-1', title: '秋のお知らせ', messageType: 'text', messageContent: '本文', targetType: 'all',
  targetTagId: null, status: 'scheduled', scheduledAt: '2026-10-20T01:00:00.000Z', sentAt: null,
  totalCount: 0, successCount: 0, lineAccountId: 'acc-1', version: 1, createdAt: '2026-10-01T00:00:00Z',
}

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number) { super(`API error: ${status}`); this.status = status }
  }
  return {
    ApiError,
    api: {
      broadcasts: {
        get: async () => ({ success: true, data: scheduled }),
        preflight: async () => ({ success: false, error: 'x' }),
        notificationSettings: async () => ({ success: false, error: 'x' }),
        testSend: vi.fn(),
        create: vi.fn(),
        cancelReservation: (...args: unknown[]) => apiMocks.cancelReservation(...args),
      },
      tags: { list: async () => ({ success: true, data: [] }) },
      scenarios: { list: async () => ({ success: true, data: [] }) },
      staff: { me: async () => ({ success: true, data: { role: 'owner' } }) },
    },
  }
})

import Page from './page'

afterEach(cleanup)

describe('予約の取消の成功（WEB317）', () => {
  it('取り消したら成功を知らせ、「予約状態を確認できませんでした」にしない', async () => {
    apiMocks.cancelReservation.mockResolvedValue({ success: true, data: { ...scheduled, status: 'draft', scheduledAt: null } })
    render(<Page />)
    const open = await screen.findByRole('button', { name: '予約を取り消す…' })
    await act(async () => { open.click() })
    const confirm = screen.getAllByRole('button').find((button) => button.textContent?.trim() === '予約を取り消す')
    expect(confirm).toBeTruthy()
    await act(async () => { confirm!.click() })
    await waitFor(() => expect(screen.getByText('予約を取り消しました。内容は下書きとして残っています。')).toBeTruthy())
    expect(screen.queryByText('予約状態を確認できませんでした')).toBeNull()
  })
})
