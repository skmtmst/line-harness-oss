// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OpsDashboardPage from './page'
import { deltaLabel, minutesLabel } from './format'
import { formatBytes, formatYenShort, niceCeiling } from '@/components/ops/ops-charts'

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

/** ★V6 37-2 運営ダッシュボード。API の形どおりに数値カード・グラフ・要対応・使用量が出ること。 */

const payload = {
  period: 'month', periodLabel: '今月', pricing: 'list_price',
  plans: [{ key: 'light', label: 'ライト', monthlyYen: 9800 }],
  kpis: { mrr: 398_000, mrrDelta: 59_600, active: 12, byPlan: { light: 4, standard: 6, pro: 2 }, trialing: 3, newInPeriod: 2, newTrialsInPeriod: 2, churnInPeriod: 0, churnRate: 0 },
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
    expect(minutesLabel(84)).toBe('1時間24分')
    expect(formatYenShort(4_500_000)).toBe('¥450万')
    expect(formatYenShort(0)).toBe('¥0')
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
    expect(text).toContain('ライト4・スタンダード6・プロ2')
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
    expect(text).toContain('定価で数えています')
    expect(host.querySelector('[data-design-node="Xvofy"]')).not.toBeNull()
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
})
