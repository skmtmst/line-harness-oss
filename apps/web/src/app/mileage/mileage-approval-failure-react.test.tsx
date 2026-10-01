// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- 実DOMと承認待ちの応答を最小mockで対照する */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ accountId: 'account-1' as string | null }))
const apiMocks = vi.hoisted(() => ({
  friendsV6: vi.fn(),
  earningRulesV6: vi.fn(),
  history: vi.fn(),
  rewards: vi.fn(),
  adjustmentApprovals: vi.fn(),
  approveAdjustment: vi.fn(),
  rejectAdjustment: vi.fn(),
  me: vi.fn(),
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/mileage',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: state.accountId, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/lib/api', () => ({
  api: {
    mileage: {
      friendsV6: apiMocks.friendsV6,
      earningRulesV6: apiMocks.earningRulesV6,
      history: apiMocks.history,
      rewards: apiMocks.rewards,
      adjustmentApprovals: apiMocks.adjustmentApprovals,
      approveAdjustment: apiMocks.approveAdjustment,
      rejectAdjustment: apiMocks.rejectAdjustment,
    },
    staff: { me: apiMocks.me },
  },
}))
vi.mock('@/lib/admin-session', () => ({ adminSessionHeaders: () => ({}) }))

const { default: MileagePage } = await import('./page')

/* D022: 見本は実APIの形に合わせる（monthChange・expiringMiles30d・nextExpiringAt・measuredAt は必須）。 */
const overview = {
  success: true,
  data: {
    items: [],
    summary: {
      totalMembers: 0,
      withBalanceCount: 0,
      available: 0,
      pending: 0,
      monthChange: 0,
      rankCounts: [],
      expiringMiles30d: null,
      nextExpiringAt: null,
    },
    pagination: { total: 0, limit: 20, offset: 0 },
    measuredAt: '2026-09-10T00:00:00.000Z',
  },
}

function approval(id = 'approval-1') {
  return {
    id,
    friend_id: 'friend-1',
    friend_display_name: 'テスト顧客',
    direction: 'increase',
    amount: 5000,
    reason: '高額調整の依頼',
    requested_by_staff_name: '担当A',
    created_at: '2026-09-20T10:00:00+09:00',
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  state.accountId = 'account-1'
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  apiMocks.friendsV6.mockResolvedValue(structuredClone(overview))
  apiMocks.earningRulesV6.mockResolvedValue({ success: true, data: { items: [], pagination: { total: 0, limit: 1, offset: 0 }, unassignedLegacyCount: 0 } })
  apiMocks.history.mockResolvedValue({ success: true, data: { summary: { byType: [] } } })
  apiMocks.rewards.mockResolvedValue({ success: true, data: { rewards: [] } })
  apiMocks.me.mockResolvedValue({ success: true, data: { role: 'owner' } })
  apiMocks.approveAdjustment.mockResolvedValue({ success: true, data: {} })
  apiMocks.rejectAdjustment.mockResolvedValue({ success: true, data: {} })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.clearAllMocks()
})

async function render() {
  await act(async () => {
    root.render(<MileagePage />)
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })
}

/**
 * M502: 承認待ちの読込失敗が表示されず依頼があるか分からなくなる。
 * 失敗は欄で理由と取り直しを出し、0 件（欄なし）と区別する。
 */
describe('M502 承認待ちの読み込み失敗（本物のReact）', () => {
  it('承認待ちの通信断は欄で理由と取り直しを出す', async () => {
    apiMocks.adjustmentApprovals.mockRejectedValue(new TypeError('fetch failed'))
    await render()
    const text = host.textContent ?? ''
    // 残高は正常に表示される。
    expect(text).toContain('マイルを持っている友だち')
    // 承認待ちの欄に失敗表示と取り直しが出る。
    expect(text).toContain('承認待ちのマイル変更')
    expect(text).toContain('承認待ちを読み込めませんでした')
    expect(text).toContain('もう一度読み込む')
  })

  it('取り直しの成功後は依頼があれば表示される', async () => {
    apiMocks.adjustmentApprovals.mockRejectedValueOnce(new TypeError('fetch failed'))
    await render()
    expect(host.textContent ?? '').toContain('承認待ちを読み込めませんでした')

    apiMocks.adjustmentApprovals.mockResolvedValue({ success: true, data: [approval()] })
    const retry = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'もう一度読み込む',
    ) as HTMLButtonElement | undefined
    expect(retry).toBeTruthy()
    await act(async () => {
      retry?.click()
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    })
    const text = host.textContent ?? ''
    expect(text).toContain('テスト顧客')
    expect(text).not.toContain('承認待ちを読み込めませんでした')
  })
})
