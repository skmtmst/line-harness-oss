// @vitest-environment happy-dom
/*
 * V8 アフィリエイター一覧：表の下に件数とページ送りを出す（v7 parity-D）。
 * 20件表示で25人いるとき、1頁に25人全員は出さず、2頁へ動ける。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AffiliatesTabV8 from './v8-affiliates-tab'

const calls = vi.hoisted(() => ({
  list: vi.fn(), allReport: vi.fn(), approvals: vi.fn(),
  settlementPreview: vi.fn(), linkBaseUrl: vi.fn(),
}))
vi.mock('@/lib/api', () => ({
  api: {
    affiliates: {
      list: calls.list,
      allReport: calls.allReport,
      settlementPreview: calls.settlementPreview,
    },
    accountSettings: { getLinkBaseUrl: calls.linkBaseUrl },
  },
  ApiError: class extends Error { status?: number },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/affiliates',
}))

const affiliates = Array.from({ length: 25 }, (_, index) => ({
  id: `aff-${index}`,
  name: `紹介者${index}`,
  code: `CODE${index}`,
  commissionRate: 10,
  isActive: true,
  createdAt: '2026-09-01T00:00:00+09:00',
  friendId: null,
}))

afterEach(cleanup)

async function renderTab() {
  calls.list.mockResolvedValue({ success: true, data: affiliates })
  calls.allReport.mockResolvedValue({ success: true, data: [] })
  calls.settlementPreview.mockRejectedValue(new Error('no settlement'))
  calls.linkBaseUrl.mockResolvedValue({ success: false })
  render(<AffiliatesTabV8 accountId="acc-1" canEdit registerHeaderActions={() => {}} />)
  await waitFor(() => expect(screen.getByText(/全\s*25件/)).toBeTruthy())
}

describe('V8 アフィリエイター一覧の件数とページ送り', () => {
  it('25人いるとき件数が出て、2頁へ動ける', async () => {
    await renderTab()
    // 1頁は20人だけ
    expect(screen.getByText('紹介者0')).toBeTruthy()
    expect(screen.queryByText('紹介者20')).toBeNull()
    const next = screen.getByRole('button', { name: '次のページ' })
    fireEvent.click(next)
    await waitFor(() => expect(screen.getByText('紹介者20')).toBeTruthy())
    expect(screen.queryByText('紹介者0')).toBeNull()
  })
})
