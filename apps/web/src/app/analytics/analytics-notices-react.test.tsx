// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsPage from './page'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

/**
 * N-281/N-283/N-289: 分析画面の打切り注記とファネル段の案内を、本物のReactで描いて確かめる。
 *
 * - 配信の反応タブ: 一斉配信・シナリオの一覧が上限に達したときだけ
 *   「先頭○件まで表示」を実値で出し、CSV書出しが同じ範囲であることも断る。
 * - ファネルタブ: 「段の作り方」の案内に、作成フォームで実際に選べる
 *   全種類が並ぶ。
 *
 * 差し替えるのは通信(fetch)とタブ・アカウント・Linkだけで、api・fetchApiは実物を通す。
 */

const fixture = vi.hoisted(() => ({
  accountId: 'account-a',
  tab: 'reactions' as string,
  reactionsBody: null as unknown,
  funnelsBody: null as unknown,
  latestRunBody: null as unknown,
}))

const net = vi.hoisted(() => ({
  calls: [] as string[],
}))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
  useMergedTab: () => fixture.tab,
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push(path)
    let body: unknown = { success: false, error: `未設定: ${path}` }
    if (path.startsWith('/api/staff/me')) {
      body = {
        success: true,
        data: {
          id: 'u-1', name: '担当者', role: 'owner', email: 't@example.com',
          line_user_id: null, is_active: 1, invite_status: 'active', account_scope: 'all',
        },
      }
    } else if (path.startsWith('/api/analytics/reactions')) {
      body = fixture.reactionsBody
    } else if (path.startsWith('/api/analytics/funnels') && path.includes('/runs/latest')) {
      body = fixture.latestRunBody
    } else if (path.startsWith('/api/analytics/funnels')) {
      body = fixture.funnelsBody
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

const metric = (value: number | string | null, state = 'available', reason: string | null = null) =>
  ({ value, state, reason })

function campaign(id: string, kind: 'broadcast' | 'scenario') {
  return {
    id,
    name: kind === 'broadcast' ? `一斉配信${id}` : `シナリオ${id}`,
    kind,
    sentAt: '2026-09-01T00:00:00.000Z',
    targetPeople: metric(30),
    delivered: metric(28),
    opened: kind === 'broadcast' ? metric(10) : metric(null, 'unavailable', 'x'),
    lineClicked: kind === 'broadcast' ? metric(3) : metric(null, 'unavailable', 'x'),
    outcomes: metric(null, 'unavailable', 'x'),
    fetchedAt: null,
  }
}

function reactionsBody(campaigns: unknown[], truncation: { broadcast: boolean; scenario: boolean }) {
  return {
    success: true,
    data: {
      lineAccountId: 'account-a',
      timeZone: 'Asia/Tokyo',
      period: { from: '2026-08-11', to: '2026-09-09' },
      dataCutoffAt: '2026-09-09T00:00:00.000Z',
      data: {
        metrics: {
          sent: metric(120),
          delivered: metric(110),
          opened: metric(30),
          lineClicked: metric(9),
          trackedClicks: metric(0),
          unavailableCampaigns: metric(0),
        },
        campaigns,
        campaignsTruncation: { limit: 200, ...truncation },
        trackedClickHours: Array.from({ length: 24 }, (_, hour) => ({ hour, clicks: 0 })),
        clickDefinition: '自社計測URLが実際にクリックされた時間',
      },
    },
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.accountId = 'account-a'
  fixture.tab = 'reactions'
  fixture.reactionsBody = null
  fixture.funnelsBody = null
  fixture.latestRunBody = null
  net.calls.length = 0
  installFetch()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => { root.render(<AnalyticsPage />) })
}

const text = () => host.textContent ?? ''

describe('配信の反応タブの打切り注記', () => {
  it('上限に達した系統だけ「先頭○件まで」を実値で出し、CSVが同じ範囲だと断る', async () => {
    fixture.reactionsBody = reactionsBody(
      [campaign('b1', 'broadcast'), campaign('b2', 'broadcast'), campaign('b3', 'broadcast'), campaign('s1', 'scenario')],
      { broadcast: true, scenario: false },
    )
    await render()
    expect(text()).toContain('一斉配信は新しい方から先頭3件までを表示しています')
    expect(text()).toContain('一覧にもCSVの書き出しにも入りません')
    // 打切っていない系統は注記に出さない。
    expect(text()).not.toContain('シナリオは新しい方から先頭')
  })

  it('両系統が打切りなら両方の実値を並べる', async () => {
    fixture.reactionsBody = reactionsBody(
      [campaign('b1', 'broadcast'), campaign('s1', 'scenario'), campaign('s2', 'scenario')],
      { broadcast: true, scenario: true },
    )
    await render()
    expect(text()).toContain('一斉配信は新しい方から先頭1件')
    expect(text()).toContain('シナリオは新しい方から先頭2件')
  })

  it('上限未満なら打切り注記を出さない（CSV書出しは使える）', async () => {
    fixture.reactionsBody = reactionsBody(
      [campaign('b1', 'broadcast')],
      { broadcast: false, scenario: false },
    )
    await render()
    expect(text()).not.toContain('先頭')
    expect(text()).not.toContain('CSVの書き出しにも入りません')
    // 一覧と同じ範囲を書き出すCSVボタンは常に出す。
    expect(
      Array.from(host.querySelectorAll('button')).some((item) => item.textContent?.includes('CSVで書き出す')),
    ).toBe(true)
  })
})

describe('ファネルの段の作り方案内', () => {
  it('案内には作成フォームで選べる全種類が並ぶ', async () => {
    fixture.tab = 'funnel'
    fixture.funnelsBody = {
      success: true,
      data: [{
        id: 'fn-1',
        name: 'テストファネル',
        windowDays: 30,
        createdAt: '2026-08-01T00:00:00.000Z',
        status: 'active',
        currentVersion: { id: 'fv-1', versionNumber: 1, createdAt: '2026-08-01T00:00:00.000Z' },
        migrationState: 'ready',
      }],
    }
    fixture.latestRunBody = { success: false, error: 'Not found' }
    await render()
    const guide = Array.from(host.querySelectorAll('li')).find((item) =>
      item.textContent?.includes('段には'),
    )
    expect(guide).toBeDefined()
    for (const label of [
      '友だち追加',
      'タグが付いた',
      '情報欄に値が入った',
      'フォームに答えた',
      'サイトのページを見た',
      '購入が確定した',
      'リンクを踏んだ',
      '成果が記録された',
      'メッセージを受信した',
      '予約が確定した',
      'オートメーションが動いた',
    ]) {
      expect(guide?.textContent).toContain(label)
    }
  })
})
