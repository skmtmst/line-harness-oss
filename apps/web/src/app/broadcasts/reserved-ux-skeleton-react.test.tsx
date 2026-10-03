// @vitest-environment happy-dom
/*
 * 予約結果 V8 の骨組み（サクサク感 A）。
 * V8 のときだけ、読み始め0.3秒を超えたら頭の板と段の骨組みを出す。
 * v7 は従来の読み込み表示のまま。
 */
import React, { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ broadcastsGet: vi.fn() }))

vi.mock('@/lib/api', () => ({
  ApiError: class extends Error { status?: number },
  api: { broadcasts: { get: apiMock.broadcastsGet } },
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: 'テスト店' }, loading: false }),
}))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner' }))
vi.mock('@/lib/staff-capability', () => ({ canEditFeature: () => true }))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('id=r1'),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageCrumbs: () => {}, usePageTitle: () => {} }))

import ReservedPage from './reserved/page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  apiMock.broadcastsGet.mockReturnValue(new Promise(() => {}))
  document.documentElement.dataset.theme = 'v8'
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete document.documentElement.dataset.theme
})

describe('予約結果V8の骨組み', () => {
  it('0.3秒を超えたら頭と段の骨組みを出す', async () => {
    render(<ReservedPage />)
    await flush()
    expect(document.querySelector('[data-skeleton]')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(350) })
    const busy = document.querySelector('[aria-busy="true"][aria-label="予約結果を確認しています"]')
    expect(busy, '骨組みの入れ物').toBeTruthy()
    expect(busy?.querySelector('[data-skeleton]'), '骨組みがある').toBeTruthy()
    expect(document.body.textContent).not.toContain('読み込み中')
  })

  it('v7 は従来の読み込み表示のまま', async () => {
    delete document.documentElement.dataset.theme
    render(<ReservedPage />)
    await flush()
    await act(async () => { vi.advanceTimersByTime(350) })
    expect(document.querySelector('[aria-busy="true"][aria-label="予約結果を確認しています"]')).toBeNull()
    expect(document.body.textContent).toContain('予約結果を確認しています')
  })
})
