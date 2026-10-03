// @vitest-environment happy-dom
/*
 * 点検の白画面（`/affiliates`・`/conversions` の filter・replace 落ち）。
 * 口が既定の器（`{items,total,page,limit}`）を返しても落ちず、
 * 内訳に再試行・配布URLは Worker の `/r/` で作ることを確かめる。
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://worker.example.com')

const EMPTY_PAGE = { items: [], total: 0, page: 1, limit: 20 }

vi.mock('@/lib/api', () => ({
  api: {
    affiliates: {
      list: async () => ({
        success: true,
        data: [
          { id: 'aff-a', name: '候補A', code: 'CODE_A', commissionRate: 10, isActive: true, createdAt: '2026-09-01T00:00:00+09:00', friendId: null },
        ],
      }),
      allReport: async () => ({ success: true, data: [] }),
      reportV2: async () => ({
        success: true,
        data: {
          affiliateId: 'aff-a', affiliateName: '候補A', code: 'CODE_A', commissionRate: 10,
          clicks: 10, linkClicks: 8, friendAdds: 1, conversions: 2,
          conversionsPending: 0, conversionsApproved: 2, conversionsRejected: 0,
          conversionsByPoint: [], revenue: 100, estimatedCommission: 10,
          confirmedReward: 10, byOffer: [], duplicateFlags: [],
        },
      }),
      links: async () => ({
        success: true,
        data: [
          {
            id: 'link-a', affiliate_id: 'aff-a', ref_code: 'CODE_A', label: null,
            line_account_id: null, is_active: 1, created_at: '2026-09-01T00:00:00+09:00',
            click_count: 5, offer_id: null, offer_name: null,
          },
        ],
      }),
      // 偽APIの既定の器（配列ではない）を返す。
      journeys: async () => ({ success: true, data: EMPTY_PAGE, nextCursor: null }),
    },
    accountSettings: {
      // 偽APIの既定の器（文字列ではない）を返す。
      getLinkBaseUrl: async () => ({ success: true, data: EMPTY_PAGE }),
    },
    conversionApprovals: {
      list: async () => ({ success: true, data: [] }),
    },
  },
}))

const tabs = await import('./tabs')
const { AffiliatorsTab } = tabs

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  cleanup()
})

describe('点検の器でも白画面にしない', () => {
  test('distributionUrl は文字列でない土台を無視する', () => {
    expect(tabs.distributionUrl('CODE_A', EMPTY_PAGE as unknown as string)).toBe(
      'https://worker.example.com/r/CODE_A',
    )
    expect(tabs.distributionUrl('CODE_A', null)).toBe('https://worker.example.com/r/CODE_A')
    expect(tabs.distributionUrl('CODE_A', 'https://short.example/')).toBe(
      'https://short.example/CODE_A',
    )
  })

  test('内訳を開いても落ちず、動線は再試行になる', async () => {
    render(<AffiliatorsTab accountId={null} />)
    await screen.findByText('候補A')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '候補Aの成果を見る' }))
    })
    // 内訳のリンク表が出る（配布URLは Worker の /r/ で作られる）。
    await waitFor(() =>
      expect(screen.queryByText('https://worker.example.com/r/CODE_A')).not.toBeNull(),
    )
    // 動線は配列でないため失敗扱い＝再試行が出る。白画面ではない。
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /もう一度読み込む/ })).not.toBeNull(),
    )
    expect(screen.queryByText('候補A')).not.toBeNull()
  })
})
