// @vitest-environment happy-dom
/*
 * m13m: ダッシュボードの出荷予定は表示ONなら0件でも出す。
 * 画面の見出し「今日やること」は出さない。
 *
 * 実React＋通信差替で確かめる。押さえる契約:
 *  - 表示ON・0件でメインの出荷予定カードが描かれる（hiddenにしない）
 *  - 0件は1行の空表示「今日・明日の出荷予定はありません」
 *  - 画面に見出し「今日やること」を出さない（上段4枚は残す）
 *  - パネル単体の主な状態（読み込み中・空・失敗・正常）
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import DashboardPage from './page'
import ShipmentPanel from '@/components/dashboard/shipment-panel'

const fixture = vi.hoisted(() => ({
  accountId: 'account-a' as string | null,
  search: '',
}))

type Json = { status: number; body: unknown }
const ok = (body: unknown): Json => ({ status: 200, body })
const fail = (status = 404): Json => ({ status, body: { success: false, error: 'not available' } })

const EMPTY_SHIPMENTS = {
  success: true,
  data: {
    today: '2026-09-20', tomorrow: '2026-09-21',
    soon: [], later: [], soonCount: 0, laterCount: 0,
    todayCount: 0, scanned: 0, scanLimit: 50,
  },
}

const net = vi.hoisted(() => ({
  calls: [] as string[],
  shipments: (() => Promise.resolve(ok(EMPTY_SHIPMENTS))) as () => Promise<Json>,
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: unknown }) =>
    <a href={href}>{children as never}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(fixture.search),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: fixture.accountId,
    selectedAccount: fixture.accountId
      ? { id: fixture.accountId, channelId: `ch-${fixture.accountId}`, displayName: `${fixture.accountId}店`, basicId: 'nen' }
      : null,
    loading: false,
  }),
}))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,x') } }))

const jsonResponse = ({ status, body }: Json) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push(`${init?.method ?? 'GET'} ${path}`)
    if (path.startsWith('/api/ec-commerce/shipments')) return jsonResponse(await net.shipments())
    if (path.startsWith('/api/dashboard/preferences')) {
      return jsonResponse(ok({ success: true, data: { version: 0, cards: null } }))
    }
    return jsonResponse(fail())
  })
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

let host: HTMLDivElement
let root: Root

async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

beforeEach(() => {
  fixture.accountId = 'account-a'
  fixture.search = ''
  net.calls.length = 0
  net.shipments = () => Promise.resolve(ok(EMPTY_SHIPMENTS))
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  installFetch()
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

describe('m13m 表示ON・0件でも出荷予定カードを出す', () => {
  it('0件でもカードを描き、1行の空表示を出す', async () => {
    await act(async () => { root.render(<DashboardPage />) })
    await flush()
    const shipment = host.querySelector('[data-design="Shipment"]')
    expect(shipment).not.toBeNull()
    expect(shipment!.classList.contains('hidden')).toBe(false)
    expect(shipment!.textContent).toContain('今日・明日の出荷予定はありません')
  })

  it('画面に見出し「今日やること」を出さず、上段4枚は残す', async () => {
    await act(async () => { root.render(<DashboardPage />) })
    await flush()
    const headings = Array.from(host.querySelectorAll('h2')).map((node) => node.textContent?.trim())
    expect(headings).not.toContain('今日やること')
    const smallCards = Array.from(host.querySelectorAll('h3')).map((node) => node.textContent?.trim())
    for (const title of ['対応が必要な受信', '写真審査', '今日の予約', '出荷予定']) {
      expect(smallCards).toContain(title)
    }
  })
})

describe('m13m 出荷予定パネルの主な状態', () => {
  async function renderPanel() {
    await act(async () => {
      root.render(<ShipmentPanel accountId="account-a" onSummaryChange={() => {}} />)
    })
  }

  it('読み込み中は読み込み中と言う', async () => {
    net.shipments = () => new Promise<Json>(() => {})
    await renderPanel()
    await flush(2)
    expect(host.textContent).toContain('読み込んでいます')
  })

  it('0件は1行の空表示', async () => {
    await renderPanel()
    await flush()
    expect(host.textContent).toContain('出荷予定')
    expect(host.textContent).toContain('今日・明日の出荷予定はありません')
  })

  it('失敗は決まった文と読み直しを出す', async () => {
    net.shipments = () => Promise.resolve(fail(500))
    await renderPanel()
    await flush()
    expect(host.textContent).toContain('出荷予定を読み込めませんでした')
    const before = net.calls.filter((call) => call.includes('/api/ec-commerce/shipments')).length
    const retry = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'もう一度読み込む')
    expect(retry).not.toBeUndefined()
    await act(async () => { retry!.click() })
    await flush()
    const after = net.calls.filter((call) => call.includes('/api/ec-commerce/shipments')).length
    expect(after).toBeGreaterThan(before)
  })

  it('正常は行を並べる', async () => {
    net.shipments = () => Promise.resolve(ok({
      success: true,
      data: {
        today: '2026-09-20', tomorrow: '2026-09-21',
        soon: [{
          id: 'ship-1', eventType: 'order.created', eventLabel: '注文',
          orderNumber: 'ORD-1', friendId: null, friendName: 'テスト',
          items: '鹿肉ミンチ × 2', itemCount: 1, quantity: 2,
          shipDate: '2026-09-20', shipDateSource: 'ordered_at',
        }],
        later: [],
        soonCount: 1, laterCount: 0, todayCount: 1, scanned: 1, scanLimit: 50,
      },
    }))
    await renderPanel()
    await flush()
    expect(host.textContent).toContain('ORD-1')
    expect(host.textContent).toContain('今日・明日')
  })
})
