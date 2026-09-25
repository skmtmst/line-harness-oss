// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsDashboardPage from './page'
import { contractDetail, deltaLabel, minutesLabel, revenueDetail, revenueSourceLabel } from './format'
import { formatBytes, formatYen, formatYenShort, niceCeiling } from '@/components/ops/ops-charts'

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

/** ★V6 37-2 運営ダッシュボード。API の形どおりに数値カード・グラフ・要対応・使用量が出ること。 */

const payload = {
  period: 'month', periodLabel: '今月', pricing: 'stripe_actual', lastSyncedAt: '2026-09-25T03:00:00.000+09:00',
  plans: [{ key: 'light', label: 'ライト', monthlyYen: 9800 }],
  kpis: { revenueThisMonth: 398_000, revenueDelta: 59_600, refundsThisMonth: 0, contractMonthlyTotal: 412_300, filledByListPriceCount: 1, active: 12, byPlan: { light: 4, standard: 6, pro: 2 }, trialing: 3, newInPeriod: 2, newTrialsInPeriod: 2, churnInPeriod: 0, churnRate: 0 },
  revenueByMonth: [4, 5, 6, 7, 8, 9].map((m, i) => ({ month: `2026-0${m}`, label: `${m}月`, yen: 3_000_000 + i * 200_000, current: i === 5 })),
  planShare: { total: 15, rows: [
    { key: 'light', label: 'ライト', count: 4, percent: 27 }, { key: 'standard', label: 'スタンダード', count: 6, percent: 40 },
    { key: 'pro', label: 'プロ', count: 2, percent: 13 }, { key: 'trial', label: 'トライアル', count: 3, percent: 20 },
  ] },
  alerts: { pastDue: 1, trialEndingSoon: 1, lineTokenExpiring: 3, unansweredTickets: 3 },
  tickets: { newCount: 3, inProgressCount: 2, avgFirstReplyMinutes: 84, closedInPeriod: 18 },
  lineRegistration: { registered: 21, total: 24, unregisteredCount: 3 },
  usage: [
    { tenantId: 't1', tenantName: 'カフェ ムスビ', planKey: 'light', planLabel: 'ライト', messages: 4820, bannerUnits: 46, mediaBytes: 1.8 * 1024 ** 3, limits: { messages: 5000, images: 50, mediaBytes: 5 * 1024 ** 3 }, usageRate: 96 },
  ],
  generatedAt: '2026-09-17T10:00:00.000+09:00',
}

let host: HTMLDivElement
let root: Root
let urls: string[]

beforeEach(() => {
  urls = []
  process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test'
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    const body = url.includes('line-unregistered')
      ? { success: true, data: { registered: 21, total: 24, people: [{ staffId: 's1', name: '木下 花', tenantName: 'カフェ ムスビ', hasEmail: true }] } }
      : { success: true, data: { ...payload, periodLabel: url.includes('prev_month') ? '先月' : '今月' } }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function flush() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

describe('表記の決まり', () => {
  it('前月比・所要時間・目盛り・容量', () => {
    expect(deltaLabel(59_600)).toBe('前月比 ＋¥59,600')
    expect(deltaLabel(-9_800)).toBe('前月比 −¥9,800')
    expect(deltaLabel(0)).toBe('前月比 ±¥0')
    expect(revenueDetail(59_600, 0)).toBe('前月比 ＋¥59,600・返金 ¥0')
    expect(contractDetail(12, { light: 4, standard: 6, pro: 2 }, 1)).toBe('12件（ライト4・スタンダード6・プロ2）・定価で補い 1件')
    expect(revenueSourceLabel('list_price', null)).toBe('定価で数えています')
    expect(minutesLabel(84)).toBe('1時間24分')
    expect(formatYenShort(4_500_000)).toBe('¥450万')
    expect(formatYenShort(0)).toBe('¥0')
    // 数字でない値が来ても「¥NaN」を出さず「—」にする（金額は formatYen の1か所で守る）。
    expect(formatYen(398_000)).toBe('¥398,000')
    expect(formatYen(Number.NaN)).toBe('—')
    expect(formatYen(undefined as unknown as number)).toBe('—')
    expect(formatYenShort(Number.NaN)).toBe('—')
    expect(niceCeiling(3_980_000)).toBe(4_000_000)
    expect(niceCeiling(0)).toBe(100_000)
    expect(formatBytes(1.8 * 1024 ** 3)).toBe('1.8GB')
  })
})

describe('画面', () => {
  it('数値カード・グラフ・要対応・チケット・使用量が出る', async () => {
    await act(async () => { root.render(<OpsDashboardPage />) })
    await flush()
    const text = host.textContent ?? ''
    expect(text).toContain('今月のようす')
    expect(text).toContain('¥398,000')
    expect(text).toContain('前月比 ＋¥59,600')
    expect(text).toContain('返金 ¥0')
    expect(text).toContain('¥412,300')
    expect(text).toContain('12件（ライト4・スタンダード6・プロ2）・定価で補い 1件')
    expect(text).toContain('解約率 0.0%')
    expect(text).toContain('月ごとの売上')
    expect(host.querySelectorAll('svg rect').length).toBeGreaterThanOrEqual(6)
    expect(text).toContain('4件 ・ 27%')
    expect(text).toContain('トライアルは契約前です')
    expect(text).toContain('決済が失敗している契約先')
    expect(text).toContain('LINEのトークン期限が近い店舗')
    expect(text).toContain('1時間24分')
    expect(text).toContain('契約者専用LINEの登録　21人 / 24人')
    expect(text).toContain('未登録の3人へ案内')
    expect(text).toContain('4,820 / 5,000')
    expect(text).toContain('1.8GB / 5.0GB')
    expect(text).toContain('96%')
    expect(text).toContain('Stripe の入金実績（最終同期 9/25 03:00）')
    expect(text.toLowerCase()).not.toContain(['m', 'r', 'r'].join(''))
    expect(host.querySelector('[data-design-node="Xvofy"]')).not.toBeNull()
    expect(host.querySelector('[data-design-node="s7wSj"]')).not.toBeNull()
    expect(host.querySelector('[data-design-node="fyib5"]')).not.toBeNull()
  })

  it('Stripe未設定時は定価の注記を同じ場所に出す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { ...payload, pricing: 'list_price', lastSyncedAt: null },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    await act(async () => { root.render(<OpsDashboardPage />) })
    await flush()
    expect(host.querySelector('[data-design-node="xaUOz"]')?.textContent).toBe('定価で数えています')
  })

  it('期間を先月に切り替えると period 付きで読み直す。未登録の人の一覧は名前と契約先を出す', async () => {
    await act(async () => { root.render(<OpsDashboardPage />) })
    await flush()
    const prev = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('先月'))
    await act(async () => { prev!.click() })
    await flush()
    expect(urls.some((u) => u.includes('/api/ops/dashboard?period=prev_month'))).toBe(true)
    expect(host.textContent).toContain('先月のようす')
    const guide = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('人へ案内'))
    await act(async () => { guide!.click() })
    await flush()
    expect(document.body.textContent).toContain('木下 花')
    expect(urls.some((u) => u.endsWith('/api/ops/dashboard/line-unregistered'))).toBe(true)
  })

  it('#1058: 読み込みに失敗したらエラーと再読み込みを1枚だけ出し、各セクションは読み込み中のままにしない', async () => {
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async () => (
      fail
        ? new Response(JSON.stringify({ error: 'server' }), { status: 500 })
        : new Response(JSON.stringify({ success: true, data: payload }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )))
    await act(async () => { root.render(<OpsDashboardPage />) })
    await flush()
    // エラー表示は1枚だけ。読み込み中や空の案内は残らない。
    expect(host.querySelectorAll('[data-list-state="error"]')).toHaveLength(1)
    expect(host.querySelectorAll('[data-list-state="loading"]')).toHaveLength(0)
    expect(host.querySelectorAll('[data-list-state="empty"]')).toHaveLength(0)
    expect(host.textContent).toContain('ダッシュボードを表示できませんでした')
    // 再読み込みで復帰する。
    fail = false
    const retry = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('もう一度読み込む'))
    expect(retry).toBeTruthy()
    await act(async () => { retry!.click() })
    await flush()
    expect(host.textContent).toContain('¥398,000')
    expect(host.querySelector('[data-list-state="error"]')).toBeNull()
  })

  it('#1058: 未登録の人の一覧が読めないときは、ダイアログにエラーと再読み込みを出す', async () => {
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('line-unregistered') && fail) {
        return new Response(JSON.stringify({ error: 'server' }), { status: 500 })
      }
      const body = url.includes('line-unregistered')
        ? { success: true, data: { registered: 21, total: 24, people: [{ staffId: 's1', name: '木下 花', tenantName: 'カフェ ムスビ', hasEmail: true }] } }
        : { success: true, data: payload }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    await act(async () => { root.render(<OpsDashboardPage />) })
    await flush()
    const guide = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('人へ案内'))
    await act(async () => { guide!.click() })
    await flush()
    // ダイアログは「読み込んでいます」のままにせず、エラーと再読み込みを出す。
    expect(document.body.textContent).toContain('未登録の人を表示できませんでした')
    const retry = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('もう一度読み込む'))
    expect(retry).toBeTruthy()
    fail = false
    await act(async () => { retry!.click() })
    await flush()
    expect(document.body.textContent).toContain('木下 花')
  })
})
