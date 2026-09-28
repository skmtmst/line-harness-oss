// @vitest-environment happy-dom
/*
 * R292: 既存紹介者の配布URLを再取得・コピーできる。作成画面を閉じた後でも
 * 同じ有効リンクのURLを取り出せて、取得・コピーでクリック計測や重複発行を
 * 起こさない。停止前の確認からの `focusAffiliateId` で内訳が開くことも見る。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://worker.example.com')

const fixture = vi.hoisted(() => ({
  baseUrlImpl: null as null | (() => Promise<unknown>),
  writeText: vi.fn(async (_text: string) => {}),
  detailCalls: [] as Array<string>,
}))

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: (text: string) => fixture.writeText(text) },
  configurable: true,
})

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
      reportV2: (id: string) => {
        fixture.detailCalls.push(`report:${id}`)
        return Promise.resolve({ success: false, error: 'なし' })
      },
      links: (id: string) => {
        fixture.detailCalls.push(`links:${id}`)
        return Promise.resolve({
          success: true,
          data: [
            {
              id: 'link-1',
              affiliate_id: id,
              ref_code: 'LINK_X1',
              label: '紹介用',
              line_account_id: null,
              is_active: 1,
              created_at: '2026-09-01T00:00:00+09:00',
              click_count: 7,
              offer_id: null,
              offer_name: null,
            },
          ],
        })
      },
      journeys: (id: string) => {
        fixture.detailCalls.push(`journeys:${id}`)
        return Promise.resolve({ success: true, data: [], nextCursor: null })
      },
    },
    accountSettings: {
      getLinkBaseUrl: () => fixture.baseUrlImpl!(),
    },
    conversionApprovals: {
      list: async () => ({ success: true, data: [] }),
    },
  },
}))

const { AffiliatorsTab } = await import('./tabs')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  fixture.detailCalls.length = 0
  fixture.writeText.mockClear()
  // 短縮ドメインあり。Worker の優先順位どおり直下につなぐ。
  fixture.baseUrlImpl = async () => ({ success: true, data: 'https://go.example.com' })
})

afterEach(() => {
  cleanup()
})

describe('R292 既存リンクの配布URLを取り出せる', () => {
  test('確認から来たら内訳が開き、配布URLとコピーがある', async () => {
    render(<AffiliatorsTab accountId={null} focusAffiliateId="aff-a" />)
    await screen.findByText('候補A')

    // 押さなくても内訳が開き、リンク表に配布URLが出る。
    await waitFor(() => expect(screen.queryByText('LINK_X1')).not.toBeNull())
    expect(screen.queryByText('https://go.example.com/LINK_X1')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'LINK_X1の配布URLをコピー' })).not.toBeNull()

    // コピーしても、取得の口は増えない（計測・発行を起こさない）。
    const before = fixture.detailCalls.length
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'LINK_X1の配布URLをコピー' }))
    })
    expect(fixture.writeText).toHaveBeenCalledWith('https://go.example.com/LINK_X1')
    expect(fixture.detailCalls.length).toBe(before)
    await screen.findByRole('button', { name: 'LINK_X1の配布URLをコピー' })
  })

  test('短縮ドメインが無ければ Worker の /r/ で作る', async () => {
    fixture.baseUrlImpl = async () => ({ success: true, data: null })
    render(<AffiliatorsTab accountId={null} focusAffiliateId="aff-a" />)
    await waitFor(() => expect(
      screen.queryByText('https://worker.example.com/r/LINK_X1'),
    ).not.toBeNull())
  })
})
