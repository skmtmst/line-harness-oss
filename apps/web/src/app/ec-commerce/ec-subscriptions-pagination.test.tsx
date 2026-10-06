// @vitest-environment happy-dom
/*
 * 定期便のページ送りと、タブの件数(#731)。**本物の React でマウントする。**
 *
 * 直す前はこうだった。
 *   - パネルは `limit=100` を送るだけで `offset` を送らず、**101件目から先へ
 *     行く手立てが無かった。**
 *   - 「N件中M件」の N は取ってきた行を数えたものだったので、**501人目以降の
 *     契約は N にも入らなかった。**
 *   - タブは `subscriptions?limit=1` を別に叩いていた(同じ数を2回取っていた)。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  subscriptions: vi.fn(),
  overview: vi.fn(),
  identities: vi.fn(),
  theme: "v7" as "v7" | "v8",
}))

vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => fixture.theme }))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error { status = 0 },
  api: {
    ecCommerce: {
      subscriptions: (...args: unknown[]) => fixture.subscriptions(...args),
      overview: (...args: unknown[]) => fixture.overview(...args),
      operationIdentityCandidates: (...args: unknown[]) => fixture.identities(...args),
    },
  },
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/ec-commerce',
}))

const SubscriptionsPanel = (await import('./subscriptions-panel')).default
const EcTabsView = (await import('./ec-tabs-view')).default

/** 契約900件のうち、要求された窓ぶんだけ返す。 */
function page(offset: number, limit: number, total = 900) {
  const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
    id: `c${offset + i}`, friendId: `f${offset + i}`, ownerName: `お客様${offset + i}`,
    petName: null, contractNumber: null, status: 'active', statusLabel: '続いています',
    riskReason: null, nextShippingAt: '2026-10-01', cycle: null, items: null,
    amount: 1000, continuedCount: 1, startedAt: null, cancelledAt: null,
    cancellationReason: null, syncedAt: '2026-09-01',
  }))
  return {
    success: true,
    data: {
      items,
      summary: {
        total, active: total, paused: 0, atRisk: 0, cancelled: 0, monthlyAmount: null,
        startedThisMonth: 0, cancelledThisMonth: 0, cancellationTopReason: null, monthlyStats: [],
      },
      skipped: { malformedSnapshots: 0 },
      risk: { source: 'payment_status', ruleVersion: 'v1', calculatedAt: null, predictiveScoreAvailable: false },
    },
    pagination: { total, limit, offset },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  /* 完全切り替え：V8 だけ。1ページ10件が既定。 */
  fixture.theme = "v8"
  fixture.subscriptions.mockImplementation(async (params: { offset?: number; limit?: number }) =>
    page(params.offset ?? 0, params.limit ?? 10))
  fixture.overview.mockResolvedValue({ success: true, data: { total: 12, subscriptions: 900 } })
  fixture.identities.mockResolvedValue({ success: true, data: { summary: { unmatched: 3 } } })
})

afterEach(() => { cleanup() })

describe('#731 定期便のページ送りとタブの件数', () => {
  test('総数はサーバが数えた数を出し、2ページ目は offset を送って取りに行く', async () => {
    render(<SubscriptionsPanel accountId="account-a" />)
    await screen.findByText(/900件中/)
    const footer = screen.getByText(/900件中/).textContent ?? ''
    console.log('AUDIT-WEB フッター(1ページ目) =', footer)
    expect(footer).toContain('1〜10件を表示')
    expect(fixture.subscriptions.mock.calls[0][0]).toMatchObject({ limit: 10, offset: 0 })

    // 2ページ目へ。**offset が乗ること**が要点。
    const next = screen.getByRole('button', { name: '2ページ目へ' })
    await act(async () => { fireEvent.click(next) })
    await waitFor(() => {
      expect(fixture.subscriptions.mock.calls.length).toBeGreaterThan(1)
    })
    const second = fixture.subscriptions.mock.calls.at(-1)![0]
    console.log('AUDIT-WEB 2ページ目の要求 =', JSON.stringify(second))
    expect(second).toMatchObject({ limit: 10, offset: 10 })
    await screen.findByText(/11〜20件を表示/)
  })

  test('9ページ目(81件目以降)へも行ける', async () => {
    /* 10件×9ページ=90件で、最終ページへ直接行ける。 */
    fixture.subscriptions.mockImplementation(async (params: { offset?: number; limit?: number }) =>
      page(params.offset ?? 0, params.limit ?? 10, 90))
    render(<SubscriptionsPanel accountId="account-a" />)
    await screen.findByText(/90件中/)
    const last = screen.getByRole('button', { name: '9ページ目へ' })
    await act(async () => { fireEvent.click(last) })
    await waitFor(() => {
      expect(fixture.subscriptions.mock.calls.at(-1)![0]).toMatchObject({ offset: 80 })
    })
    const footer = await screen.findByText(/81〜90件を表示/)
    console.log('AUDIT-WEB フッター(9ページ目) =', footer.textContent)
    expect(footer.textContent).toContain('81〜90件を表示')
  })

  test('タブの件数は overview から取り、定期便の口を別に叩かない', async () => {
    render(<EcTabsView accountId="account-a" active="subscriptions" />)
    await waitFor(() => { expect(screen.getByText('900')).toBeTruthy() })
    console.log('AUDIT-WEB タブの件数 =', screen.getByText('900').textContent,
      ' subscriptions を叩いた回数 =', fixture.subscriptions.mock.calls.length)
    // パネルが出す総数と同じ数であること。
    expect(screen.getByText('900')).toBeTruthy()
    // 同じ数を2回取らない。
    expect(fixture.subscriptions).not.toHaveBeenCalled()
  })

  test('読めなかったスナップショットがあることを画面に出す', async () => {
    fixture.subscriptions.mockImplementation(async () => {
      const base = page(0, 100, 12)
      base.data.skipped.malformedSnapshots = 2
      return base
    })
    render(<SubscriptionsPanel accountId="account-a" />)
    const footer = await screen.findByText(/数えていません/)
    console.log('AUDIT-WEB 弾いた件数の知らせ =', footer.textContent)
    expect(footer.textContent).toContain('2件は数えていません')
  })
})


describe('V8 定期便の表示件数', () => {
  test('10件で開き、50件へ変えた後の次ページはoffset50を使う', async () => {
    fixture.theme = 'v8'
    render(<SubscriptionsPanel accountId="account-a" />)
    await screen.findByText(/1〜10件を表示/)
    expect(fixture.subscriptions.mock.calls[0][0]).toMatchObject({ limit: 10, offset: 0 })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '定期便の表示件数' })) })
    await act(async () => { fireEvent.click(within(screen.getByRole('option', { name: '50件' })).getByRole('button')) })
    await screen.findByText(/1〜50件を表示/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '2ページ目へ' })) })
    await screen.findByText(/51〜100件を表示/)
    expect(fixture.subscriptions.mock.calls.at(-1)![0]).toMatchObject({ limit: 50, offset: 50 })
  })
})
