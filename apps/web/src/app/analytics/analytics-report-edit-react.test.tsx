// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReportNewPage from './reports/new/page'

/**
 * 定期レポート作成/編集画面を本物のReactで動かす試験(#844 / N-277,N-278)。
 *
 * ?id= つきで開いたとき既存の内容が入り、「変更を保存する」が
 * 読み取った版つきのPUTになること、失敗と欠番を区別することを見る。
 */

const fixture = vi.hoisted(() => ({
  editId: null as string | null,
  role: 'owner' as 'owner' | 'staff',
}))

const net = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; method: string; body: unknown }>,
  handler: ((url: string) =>
    Promise.reject(new Error(`未設定: ${url}`))) as
      (url: string, init?: RequestInit) => Promise<unknown>,
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? fixture.editId : null) }),
  usePathname: () => '/analytics/reports/new',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => undefined,
  usePageChrome: () => ({ title: null, fullWidth: false }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    net.calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const body = await net.handler(path, init)
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

const SCHEDULE = {
  id: 'report-1', lineAccountId: 'account-a', name: '週次まとめ',
  sections: ['friends', 'reactions'], savedAnalysisIds: ['saved-1'],
  cadence: 'weekly', weekday: 3, monthDay: null,
  sendTime: '10:30', timeZone: 'Asia/Tokyo', periodDays: 30,
  recipients: [{ kind: 'staff', staffId: 'u-1', label: 'テスト' }],
  channels: ['dashboard', 'email'], alertRules: [
    { metric: 'block_rate', operator: 'greater_than', threshold: 0.5, minimumSample: 20 },
  ],
  status: 'active', isOneTime: false,
  nextRunAt: '2026-09-24T01:30:00.000Z', createdBy: 'u-1',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}

const OPTIONS = {
  timeZone: 'Asia/Tokyo',
  savedAnalyses: [{ id: 'saved-1', name: '流入別の成果', kind: 'cross' }],
  recipients: [{ id: 'u-1', name: 'テスト', role: 'owner', email: 'a@example.com', lineLinked: true }],
}

function defaultHandler(path: string, init?: RequestInit) {
  if (path === '/api/staff/me') return Promise.resolve({ success: true, data: { role: fixture.role } })
  if (path.startsWith('/api/analytics/report-schedules/') && init?.method === 'PUT') {
    return Promise.resolve({ success: true, data: { ...SCHEDULE, name: '週次まとめ', updatedAt: '2026-09-02T00:00:00.000Z' } })
  }
  if (path.startsWith('/api/analytics/report-schedules')) {
    return Promise.resolve({ success: true, data: { items: [SCHEDULE], options: OPTIONS } })
  }
  return Promise.reject(new Error(`未設定: ${path}`))
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.editId = null
  fixture.role = 'owner'
  net.calls.length = 0
  net.handler = defaultHandler
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
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
  await act(async () => { root.render(<ReportNewPage />) })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label,
  )
  if (!found) throw new Error(`ボタンが見つからない: ${label}`)
  return found
}

describe('定期レポートの編集画面(?id=)', () => {
  it('既存の内容が入り、「変更を保存する」が版つきのPUTになる', async () => {
    fixture.editId = 'report-1'
    await render()
    // 初期値が入っている(名前・曜日・時刻・期間・宛先)
    const nameInput = Array.from(host.querySelectorAll('input[type="text"], input:not([type])'))
      .find((item) => (item as HTMLInputElement).value === '週次まとめ')
    expect(nameInput).toBeTruthy()
    expect(host.textContent).toContain('「週次まとめ」を直しています')
    expect(host.textContent).toContain('変更を保存する')
    expect(host.textContent).not.toContain('いますぐ1回だけ送ってみる')

    await act(async () => { button('変更を保存する').click() })
    const putCall = net.calls.find((call) => call.path.startsWith('/api/analytics/report-schedules/report-1?') && call.method === 'PUT')
    expect(putCall).toBeTruthy()
    expect(putCall?.body).toMatchObject({
      name: '週次まとめ',
      cadence: 'weekly',
      weekday: 3,
      sendTime: '10:30',
      periodDays: 30,
      expectedUpdatedAt: '2026-09-01T00:00:00.000Z',
    })
    expect(host.textContent).toContain('定期レポートを更新しました')
  })

  it('idが無いときは新規作成画面のまま(旧レポートへの誤PUTをしない)', async () => {
    await render()
    expect(host.textContent).toContain('つくって動かす')
    expect(net.calls.filter((call) => call.method === 'PUT')).toHaveLength(0)
  })

  it('idが一覧に無いときは「見つかりません」とだけ出す', async () => {
    fixture.editId = 'gone-1'
    await render()
    expect(host.textContent).toContain('定期レポートが見つかりませんでした')
    expect(host.textContent).not.toContain('つくって動かす')
  })

  it('一覧の取得失敗は「見つかりません」ではなく、やり直せる失敗画面にする', async () => {
    fixture.editId = 'report-1'
    net.handler = (path) => {
      if (path === '/api/staff/me') return Promise.resolve({ success: true, data: { role: 'owner' } })
      return Promise.reject(new Error('接続できませんでした'))
    }
    await render()
    expect(host.textContent).toContain('定期レポートを表示できませんでした')
    expect(host.textContent).not.toContain('定期レポートが見つかりませんでした')
    // やり直しで読み直しが走る
    // ★V7 `x63W5x`：失敗の1枚の副ボタンは「もう一度読み込む」1つ。
    net.handler = defaultHandler
    await act(async () => { button('もう一度読み込む').click() })
    expect(net.calls.filter((call) => call.path.startsWith('/api/analytics/report-schedules') && call.method === 'GET').length).toBeGreaterThanOrEqual(2)
    expect(host.textContent).toContain('「週次まとめ」を直しています')
  })
})
