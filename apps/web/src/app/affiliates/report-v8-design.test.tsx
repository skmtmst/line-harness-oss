// @vitest-environment happy-dom
/*
 * 板 `Eo56k` レポートタブの絵合わせ。
 * - 数の帯：成果（先月より +N）、売上、報酬（売上の N%）、1件あたりの報酬
 * - 青帯：期間は…。数は「認めた成果」だけ。…「分析 › レポート」…
 * - 道具：名前で探す、2つの札、よく使う絞り込み、期間
 * - 行：いちばん多い案件、成果・売上、報酬（先月より）の差分、操作の見出しなし
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const now = new Date()
const thisMonth = now.toISOString()
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString()

const ITEMS = [
  {
    eventId: 'e1', createdAt: thisMonth, friendId: 'f1', friendName: '佐藤 美咲',
    affiliateId: 'a1', affiliateName: '田中 明', offerId: 'o1', offerName: '定期便の初回',
    value: 412000, approvalStatus: 'approved', rewardAmount: 28000,
  },
  {
    eventId: 'e2', createdAt: thisMonth, friendId: 'f2', friendName: '鈴木 健',
    affiliateId: 'a2', affiliateName: '合同会社ノース', offerId: 'o2', offerName: '夏の紹介キャンペーン',
    value: 314000, approvalStatus: 'approved', rewardAmount: 31400,
  },
  {
    eventId: 'e3', createdAt: lastMonth, friendId: 'f3', friendName: '高橋 まい',
    affiliateId: 'a1', affiliateName: '田中 明', offerId: 'o1', offerName: '定期便の初回',
    value: 200000, approvalStatus: 'approved', rewardAmount: 24000,
  },
]

const AFFILIATES = [
  { id: 'a1', name: '田中 明', code: 'tanaka-a', commissionRate: 10, isActive: true, createdAt: thisMonth, friendId: null },
  { id: 'a2', name: '合同会社ノース', code: 'north', commissionRate: 10, isActive: true, createdAt: thisMonth, friendId: null },
  { id: 'a3', name: '旧パートナーA', code: 'old-a', commissionRate: 0, isActive: false, createdAt: thisMonth, friendId: null },
]

const fixture = vi.hoisted(() => ({ failed: false, truncated: false, missingReward: false }))

vi.mock('@/lib/api', () => ({
  api: {
    affiliates: {
      list: () => Promise.resolve({ success: !fixture.failed, data: AFFILIATES }),
    },
  },
}))

vi.mock('./tabs', () => ({
  listAllConversionApprovals: async () => ({ items: fixture.missingReward ? ITEMS.map((item) => ({ ...item, rewardAmount: null })) : ITEMS, truncated: fixture.truncated }),
}))

vi.mock('./v8-drawer', () => ({ default: () => null }))

const { default: ReportTabV8 } = await import('./v8-report-tab')

beforeEach(() => { fixture.failed = false; fixture.truncated = false; fixture.missingReward = false })

afterEach(() => {
  cleanup()
})

function renderTab() {
  render(<ReportTabV8 canEdit accountId="acc-1" registerHeaderActions={() => {}} />)
}

describe('Eo56k レポートタブの絵合わせ', () => {
  test('紹介者の取得失敗をゼロ件に見せず、再読み込みで回復する', async () => {
    fixture.failed = true
    renderTab()
    await waitFor(() => expect(screen.getByText('紹介者を読み込めませんでした。集計は表示していません。')).toBeTruthy())
    expect(screen.queryByText('田中 明')).toBeNull()
    fixture.failed = false
    fireEvent.click(screen.getByRole('button', { name: /もう一度試す/ }))
    await waitFor(() => expect(screen.getByText('田中 明')).toBeTruthy())
  })

  test('全件を取れないときに部分合計を確定値として表示しない', async () => {
    fixture.truncated = true
    renderTab()
    await waitFor(() => expect(screen.getByText(/成果が取得上限を超えています/)).toBeTruthy())
    expect(screen.queryByText('田中 明')).toBeNull()
  })

  test('報酬が未確定なら売上を報酬として代用しない', async () => {
    fixture.missingReward = true
    renderTab()
    await waitFor(() => expect(screen.getByText('田中 明')).toBeTruthy())
    expect(screen.getAllByText('未確定の報酬があります')).toHaveLength(2)
    expect(screen.queryByText('売上の 100.0%')).toBeNull()
    expect(screen.getByText(/未確定の報酬は金額を表示せず/)).toBeTruthy()
  })

  test('数の帯と青帯が絵どおり', async () => {
    renderTab()
    await waitFor(() => {
      expect(screen.getByText('1件あたりの報酬')).toBeTruthy()
    })
    // 今月 2件 − 先月 1件
    expect(screen.getByText('先月より +1')).toBeTruthy()
    expect(screen.getByText('成果になった注文の合計')).toBeTruthy()
    expect(screen.getByText('売上の 8.2%')).toBeTruthy()
    expect(screen.getByText(/期間は今月（/)).toBeTruthy()
    expect(screen.getByText(/数は「認めた成果」だけ/)).toBeTruthy()
    expect(screen.getByText(/分析 › レポート/)).toBeTruthy()
  })

  test('道具が絵どおり', async () => {
    renderTab()
    await waitFor(() => {
      expect(screen.getByLabelText('名前で探す')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'アフィリエイターごと' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '案件ごと' })).toBeTruthy()
    expect(screen.getByLabelText('よく使う絞り込み')).toBeTruthy()
    expect(screen.getByLabelText('期間')).toBeTruthy()
  })

  test('行に差分と操作の見出しなしが出る', async () => {
    renderTab()
    await waitFor(() => {
      expect(screen.getByText('定期便の初回')).toBeTruthy()
    })
    // a1：今月 28,000 − 先月 24,000
    expect(screen.getByText('（+¥4,000）')).toBeTruthy()
    // a2：先月なし → 初めて
    expect(screen.getByText('（初めて）')).toBeTruthy()
    // a3：0件
    expect(screen.getByText('0件')).toBeTruthy()
    expect(screen.queryByText('操作')).toBeNull()
    expect(screen.getByText(/行を押すと、その人の成果の明細/)).toBeTruthy()
  })
})
