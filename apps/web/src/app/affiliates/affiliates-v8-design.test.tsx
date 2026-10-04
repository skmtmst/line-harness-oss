// @vitest-environment happy-dom
/*
 * 板 `KdFRI` アフィリエイタータブの絵合わせ。
 * - 数の帯：アフィリエイター（計測中・停止中）、今月の成果（先月より±N）、
 *   今月の報酬（¥表示・承認待ち分は入れない）、承認待ち（認めると報酬に入ります）
 * - 道具：作るボタン、名前・紹介コードで探す、計測中／報酬ありの札、
 *   よく使う絞り込み、表示件数
 * - 行：売上の N%・報酬なし（計測のみ）の約束行、計測中／停止中の札、
 *   成果を見るボタン、脚注どおりの「…」の内訳
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const AFFILIATES = [
  {
    id: 'a1', name: '田中 明', code: 'tanaka-a', commissionRate: 10,
    isActive: true, createdAt: '2026-08-01T00:00:00.000Z',
    friendId: null, email: null, holdDays: null, payoutCycle: null, notifyOnConversion: false,
  },
  {
    id: 'a2', name: '旧パートナーA', code: 'old-a', commissionRate: 0,
    isActive: false, createdAt: '2026-07-01T00:00:00.000Z',
    friendId: null, email: null, holdDays: null, payoutCycle: null, notifyOnConversion: false,
  },
  {
    id: 'a3', name: '中村 彩', code: 'nakamura', commissionRate: 0,
    isActive: true, createdAt: '2026-08-15T00:00:00.000Z',
    friendId: null, email: null, holdDays: null, payoutCycle: null, notifyOnConversion: false,
  },
]

const DETAIL = [
  { affiliateId: 'a1', totalClicks: 100, totalConversions: 14, totalRevenue: 280000, confirmedReward: 0, linkCount: 2, friendAdds: 186 },
  { affiliateId: 'a2', totalClicks: 10, totalConversions: 0, totalRevenue: 0, confirmedReward: 0, linkCount: 1, friendAdds: 12 },
]

const MONTHLY_CURRENT = [{ totalConversions: 30 }, { totalConversions: 8 }]
const MONTHLY_PREV = [{ totalConversions: 25 }, { totalConversions: 6 }]

const fixture = vi.hoisted(() => ({ datedCalls: 0 }))

vi.mock('@/lib/api', () => ({
  api: {
    affiliates: {
      list: () => Promise.resolve({ success: true, data: AFFILIATES }),
      allReport: (params?: { startDate?: string; endDate?: string }) => {
        if (!params?.startDate) return Promise.resolve({ success: true, data: DETAIL })
        fixture.datedCalls += 1
        const data = fixture.datedCalls === 1 ? MONTHLY_CURRENT : MONTHLY_PREV
        return Promise.resolve({ success: true, data })
      },
      settlementPreview: () => Promise.resolve({ success: true, data: { affiliates: [], totalAmount: 70400 } }),
      links: () => Promise.resolve({ success: true, data: [] }),
      archive: () => Promise.resolve({ success: true, data: null }),
    },
    accountSettings: {
      getLinkBaseUrl: () => Promise.resolve({ success: true, data: null }),
    },
  },
}))

vi.mock('./tabs', () => ({
  CreateAffiliateModal: () => null,
  distributionUrl: () => null,
  listAllConversionApprovals: async () => ({ items: [], truncated: false }),
}))

const { default: AffiliatesTabV8 } = await import('./v8-affiliates-tab')

afterEach(() => {
  cleanup()
  fixture.datedCalls = 0
})

describe('KdFRI アフィリエイタータブの絵合わせ', () => {
  test('数の帯が絵どおり（先月差分・¥表示）', async () => {
    render(<AffiliatesTabV8 accountId="acc-1" canEdit registerHeaderActions={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('今月の成果')).toBeTruthy()
    })
    expect(screen.getByText('計測中 2・停止中 1')).toBeTruthy()
    // 今月 38 − 先月 31 ＝ +7
    expect(screen.getByText('先月より+7')).toBeTruthy()
    expect(screen.getByText('¥70,400')).toBeTruthy()
    expect(screen.getByText('承認待ち')).toBeTruthy()
    expect(screen.getByText('認めると報酬に入ります')).toBeTruthy()
  })

  test('道具が絵どおり', async () => {
    render(<AffiliatesTabV8 accountId="acc-1" canEdit registerHeaderActions={() => {}} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /アフィリエイターを作る/ })).toBeTruthy()
    })
    expect(screen.getByLabelText('名前・紹介コードで探す')).toBeTruthy()
    expect(screen.getByRole('button', { name: /計測中/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /報酬あり/ })).toBeTruthy()
    expect(screen.getByLabelText('よく使う絞り込み')).toBeTruthy()
    expect(screen.getByLabelText('表示件数')).toBeTruthy()
  })

  test('行に約束行と札と操作が出る', async () => {
    render(<AffiliatesTabV8 accountId="acc-1" canEdit registerHeaderActions={() => {}} />)
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '成果を見る' }).length).toBe(3)
    })
    expect(screen.getByText('売上の 10%')).toBeTruthy()
    expect(screen.getByText('報酬なし（計測のみ）')).toBeTruthy()
    expect(screen.getAllByText('計測中').length).toBeGreaterThan(0)
    expect(screen.getByText('停止中')).toBeTruthy()
    expect(screen.getByText(/止めると、その人の紹介リンクからの成果を数えなくなります/)).toBeTruthy()
  })
})
