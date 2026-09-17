// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsPage from './page'

/**
 * 保存タブの定期レポート一覧を本物のReactで動かす試験(#844 / N-277,N-278)。
 *
 * 「なし」と決め打ちで出していた一覧・停止・再開・しまう・編集導線が、
 * 実APIの応答から正しく描かれ、版つきの状態変更へ進むことを見る。
 * api・fetchApiは実物を通し、通信(fetch)だけを差し替える。
 */

const fixture = vi.hoisted(() => ({
  accountId: 'account-a' as string,
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

vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
  useMergedTab: () => 'saved',
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

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

/** fetchApi がPUTで読むCSRF/session領域。実物と同じ形だけ用意する。 */
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const SAVED_ITEM = {
  id: 'saved-1', name: '流入別の成果', kind: 'cross', status: 'active',
  currentVersionNumber: 2, createdBy: 'u-1', createdByName: 'テスト',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  snapshotCount: 1,
  latestSnapshot: {
    id: 'snap-1', state: 'available', periodFrom: '2026-08-25', periodTo: '2026-09-01',
    dataCutoffAt: '2026-09-01T15:00:00.000Z', createdAt: '2026-09-01T15:00:00.000Z',
  },
}

function schedule(overrides: Record<string, unknown>) {
  return {
    id: 'report-1', lineAccountId: 'account-a', name: '週次まとめ',
    sections: ['friends'], savedAnalysisIds: ['saved-1'], cadence: 'weekly', weekday: 1,
    monthDay: null, sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
    recipients: [{ kind: 'staff', staffId: 'u-1', label: 'テスト' }],
    channels: ['dashboard'], alertRules: [], status: 'active',
    isOneTime: false, nextRunAt: '2026-09-21T00:00:00.000Z', createdBy: 'u-1',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const SCHEDULE_OPTIONS = {
  timeZone: 'Asia/Tokyo',
  savedAnalyses: [{ id: 'saved-1', name: '流入別の成果', kind: 'cross' }],
  recipients: [{ id: 'u-1', name: 'テスト', role: 'owner', email: 'a@example.com', lineLinked: true }],
}

function defaultHandler(path: string, init?: RequestInit) {
  if (path === '/api/staff/me') return Promise.resolve({ success: true, data: { role: fixture.role } })
  if (path.startsWith('/api/analytics/saved/saved-1/snapshots')) return Promise.resolve({ success: true, data: [] })
  if (path.startsWith('/api/analytics/saved')) return Promise.resolve({ success: true, data: [SAVED_ITEM] })
  if (path.startsWith('/api/analytics/report-schedules/') && init?.method === 'PUT') {
    return Promise.resolve({ success: true, data: schedule({ status: 'paused' }) })
  }
  if (path.startsWith('/api/analytics/report-schedules')) {
    return Promise.resolve({ success: true, data: { items: [schedule({})], options: SCHEDULE_OPTIONS } })
  }
  return Promise.reject(new Error(`未設定: ${path}`))
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.accountId = 'account-a'
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
  await act(async () => { root.render(<AnalyticsPage />) })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label,
  )
  if (!found) throw new Error(`ボタンが見つからない: ${label}`)
  return found
}

/** 確認窓は document.body への portal なので、窓の中だけを探す。 */
function dialogButton(label: string): HTMLButtonElement {
  const dialog = document.body.querySelector('[role="alertdialog"], [role="dialog"]')
  const found = dialog && Array.from(dialog.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label,
  )
  if (!found) throw new Error(`確認窓のボタンが見つからない: ${label}`)
  return found as HTMLButtonElement
}

describe('V6 保存タブの定期レポート', () => {
  it('実データの一覧(名前・間隔・次回・状態)を出し、「なし」の決め打ちを残さない', async () => {
    await render()
    expect(host.textContent).toContain('週次まとめ')
    expect(host.textContent).toContain('毎週月曜 09:00')
    expect(host.textContent).toContain('送る予定あり')
    expect(host.textContent).not.toContain('定期レポートは現在「なし」です')
    // 選んでいる保存分析へ紐づく件数も実数で出る
    expect(host.textContent).toContain('定期レポート 1件')
    // 作成への導線がある
    expect(host.querySelector('a[href="/analytics/reports/new"]')).not.toBeNull()
    expect(host.querySelector('a[href="/analytics/reports/new?id=report-1"]')).not.toBeNull()
  })

  it('止める・また送るを読み取った版つきで送る', async () => {
    await render()
    await act(async () => { button('止める').click() })
    const pauseCall = net.calls.find((call) => call.path.startsWith('/api/analytics/report-schedules/report-1/status'))
    expect(pauseCall?.method).toBe('PUT')
    expect(pauseCall?.body).toMatchObject({ status: 'paused', expectedUpdatedAt: '2026-09-01T00:00:00.000Z' })

    // 停止後は「また送る」に変わる
    expect(host.textContent).toContain('止めている')
    await act(async () => { button('また送る').click() })
    const resumeCall = net.calls.filter((call) => call.path.includes('/status')).at(-1)
    expect(resumeCall?.body).toMatchObject({ status: 'active' })
  })

  it('しまうは確認してから送り、一覧から消える', async () => {
    net.handler = (path, init) => {
      if (path.includes('/status') && init?.method === 'PUT') {
        return Promise.resolve({ success: true, data: schedule({ status: 'archived' }) })
      }
      return defaultHandler(path, init)
    }
    await render()
    await act(async () => { button('しまう').click() })
    // 確認窓が出る。まだ送っていない
    expect(document.body.textContent).toContain('定期レポートをしまいますか')
    expect(net.calls.filter((call) => call.path.includes('/status'))).toHaveLength(0)
    await act(async () => { dialogButton('しまう').click() })
    const archiveCall = net.calls.find((call) => call.path.includes('/status'))
    expect(archiveCall?.body).toMatchObject({ status: 'archived', expectedUpdatedAt: '2026-09-01T00:00:00.000Z' })
    // しまったレポートは一覧から消える
    expect(host.textContent).not.toContain('週次まとめ')
    expect(host.textContent).toContain('定期レポートはまだありません')
  })

  it('版ずれの応答はエラーとして見せ、一覧を読み直す', async () => {
    await render()
    net.handler = (path, init) => {
      if (path.includes('/status') && init?.method === 'PUT') {
        return Promise.resolve({ success: false, error: 'この定期レポートは別の画面で先に更新されました。最新の内容を読み込み直してください' })
      }
      return defaultHandler(path, init)
    }
    await act(async () => { button('止める').click() })
    expect(host.textContent).toContain('別の画面で先に更新されました')
    // 読み直しが走る
    expect(net.calls.filter((call) => call.path.startsWith('/api/analytics/report-schedules') && call.method === 'GET').length).toBeGreaterThanOrEqual(2)
  })

  it('一覧の取得失敗はバナーだけにし、0件や「まだありません」と偽らない', async () => {
    net.handler = (path, init) => {
      if (path === '/api/staff/me') return Promise.resolve({ success: true, data: { role: 'owner' } })
      if (path.startsWith('/api/analytics/report-schedules')) return Promise.reject(new Error('接続できませんでした'))
      return defaultHandler(path, init)
    }
    await render()
    expect(host.textContent).toContain('接続できませんでした')
    expect(host.textContent).not.toContain('定期レポートはまだありません')
    expect(host.textContent).not.toContain('定期レポート 0件')
  })

  it('運用担当には一覧は見せるが変更操作は出さない', async () => {
    fixture.role = 'staff'
    await render()
    expect(host.textContent).toContain('週次まとめ')
    for (const label of ['止める', 'また送る', 'しまう', '内容を変える', '定期レポートを作る']) {
      expect(Array.from(host.querySelectorAll('button, a')).some((item) => item.textContent?.trim() === label)).toBe(false)
    }
  })
})
