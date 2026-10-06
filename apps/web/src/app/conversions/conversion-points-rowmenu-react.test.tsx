// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConversionsPage from './page'

/*
 * R280: 成果地点の一覧で行の「…」を開くと、メニューが二重に出ていた。
 *
 * 原因は `pointMenuId` をスマホカードとPC表の両方の ActionMenu で
 * 共有していたこと。隠れている側の器（MenuPortal）も body へ出るため、
 * 左上(8,4)に亡霊のメニューが現れ、外側クリックの処理が互いを閉じて
 * 詳細へ進めなかった。
 *
 * 直し：行ごとに独立した開閉（共通 RowActions）へ戻す。見るのは文字列
 * ではなく body に出た `[role="menu"]` の数と、開いた先の詳細の有無。
 */

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string | null, role: 'owner', roleMode: 'ok', tab: 'points', rows: 1, replace: vi.fn() }))
let releaseRole: (value: Response) => void
let writes: Array<{ path: string; body: Record<string, unknown> }> = []

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`tab=${fixture.tab}&affiliate=affiliate-a&from=notice`),
  useRouter: () => ({ replace: fixture.replace, push: () => {} }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
  useMergedTab: () => fixture.tab,
}))

const DEFINITION = {
  id: 'point-a',
  name: '購入',
  sourceType: 'ec_order_confirmed',
  value: 100,
  measureMethod: 'webhook',
  targetUrl: null,
  countRepeat: true,
  attributionDays: null,
  sourceConfig: {},
  deduplicationMode: 'every',
  deduplicationWindowDays: null,
  valueMode: 'fixed',
  reversalPolicy: 'manual',
  lineAccountId: 'account-a',
  status: 'active',
  state: 'active',
  stateReason: null,
  ingest: { configured: false, disabledAt: null },
  version: 3,
  usageCount: 1,
  usageNames: ['シナリオA'],
  metrics: {
    recordedCount: 5, netCount: 5, reversedCount: null, netValue: 500,
    reversalState: 'unavailable', reversalReason: '', cancellationCount: null, cancellationValue: null,
  },
  stoppedAt: null,
  createdAt: '2026-09-01T00:00:00.000+09:00',
  updatedAt: '2026-09-01T00:00:00.000+09:00',
}

function listBody() {
  return {
    success: true,
    data: {
      items: Array.from({ length: fixture.rows }, (_, index) => ({ ...DEFINITION, id: `point-${index}`, name: index === 0 ? '購入' : `購入 ${index + 1}` })),
      stateCounts: { active: fixture.rows, draft: 0, stopped: 0, invalid: 0, sourceStopped: 0, unused: 0 },
      range: { from: '2026-09-01 00:00:00', to: '2026-09-30 23:59:59', timeZone: 'Asia/Tokyo' },
      pagination: { total: fixture.rows, limit: 50, cursor: '0', nextCursor: null },
    },
  }
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, options?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status === 200, data }), { status, headers: { 'Content-Type': 'application/json' } })
    if (path.startsWith('/api/conversions/') && options?.method && options.method !== 'GET') writes.push({ path, body: JSON.parse(String(options.body ?? '{}')) })
    if (path.includes('/ingest-events')) return reply({ items: [] })
    if (path.startsWith('/api/staff/me')) {
      if (fixture.roleMode === 'pending') return new Promise<Response>((resolve) => { releaseRole = resolve })
      return reply({ role: fixture.role }, fixture.roleMode === 'failed' ? 503 : 200)
    }
    if (path.includes('/delete-impact')) return reply({ definition: DEFINITION, usages: [], eventCount: 5, canDelete: false, stopImpact: { affectedUsageCount: 1, preservesPastEvents: true, preservesUsages: true }, replacementCandidates: [] })
    if (path.endsWith('/stop')) return reply({ id: DEFINITION.id, status: 'stopped', version: 4, stoppedAt: '2026-10-04' })
    if (path.startsWith('/api/conversions/definitions')) {
      return new Response(JSON.stringify(listBody()), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (path.startsWith('/api/conversions/report') || path.startsWith('/api/conversions/definition-report')) {
      return new Response(JSON.stringify({ success: true, data: { kpis: {}, daily: [], byDefinition: [], byRoute: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}

let container: HTMLDivElement
let root: Root

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(React.createElement(ConversionsPage)) })
  await act(async () => { await Promise.resolve() })
}

function menus(): HTMLElement[] {
  return [...document.body.querySelectorAll('[role="menu"]')] as HTMLElement[]
}

function byText(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')]
    .find((node) => node.textContent?.trim() === text) as HTMLButtonElement | undefined
}

function moreButtons(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll('button[aria-label="購入のその他操作"]')]
    .filter((node) => node.isConnected) as HTMLButtonElement[]
}

async function click(node: HTMLElement | undefined) {
  expect(node, '押せる要素が見つかりません').toBeTruthy()
  await act(async () => { node!.click() })
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  fixture.accountId = 'account-a'
  fixture.role = 'owner'
  fixture.roleMode = 'ok'
  fixture.tab = 'points'
  fixture.rows = 1
  fixture.replace.mockClear()
  writes = []
  vi.stubGlobal('localStorage', new MemoryStorage())
  localStorage.setItem('lh_csrf', 'test-csrf')
  installFetch()
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

describe('R280 成果地点の操作メニューは1つだけ', () => {
  it('「…」を開いても可視メニューは1つだけ', async () => {
    await mount()
    expect(moreButtons().length).toBeGreaterThan(0)
    // PC表・スマホカードのどちらか片方を開く。共有状態のままだと両方が開く。
    await click(moreButtons()[0])
    expect(menus()).toHaveLength(1)
  })

  it('クリックで詳細が開く', async () => {
    await mount()
    await click(moreButtons()[0])
    await click(byText('中身を見る'))
    // 詳細の窓が開いた（閉じる×と成果地点の数え方が見える）。
    expect(document.body.querySelector('button[aria-label="閉じる"]')).toBeTruthy()
    expect(document.body.textContent).toContain('この成果地点の数え方と利用状況です。')
  })

  it('Escapeでメニューが閉じ、詳細は開かない', async () => {
    await mount()
    await click(moreButtons()[0])
    expect(menus()).toHaveLength(1)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await act(async () => { await Promise.resolve() })
    expect(menus()).toHaveLength(0)
    expect(document.body.textContent).not.toContain('この成果地点の数え方と利用状況です。')
  })

  it('行をクリックしても詳細が開く', async () => {
    await mount()
    const row = document.body.querySelector('tbody tr')
    expect(row, '一覧の行が見つかりません').toBeTruthy()
    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).toContain('この成果地点の数え方と利用状況です。')
  })
})


describe('V8 閲覧だけの担当者と権限確認中', () => {
  for (const roleMode of ['staff', 'failed', 'pending']) {
    it(`${roleMode} は管理操作を出さず、詳細の閲覧は残す`, async () => {
      fixture.role = 'staff'
      fixture.roleMode = roleMode === 'staff' ? 'ok' : roleMode
      await mount()
      expect(container.querySelector('a[href="/conversions/new"]')).toBeNull()
      await click(moreButtons()[0])
      expect(byText('編集する')).toBeUndefined()
      expect(byText('止める・差し替える・削除する')).toBeUndefined()
      expect(byText('使う場所を足す')).toBeUndefined()
      await click(byText('中身を見る'))
      expect(byText('編集')).toBeUndefined()
      expect(byText('停止・削除する')).toBeUndefined()
      expect(byText('鍵を発行する')).toBeUndefined()
      expect(document.body.textContent).toContain('この成果地点の数え方と利用状況です。')
      expect(writes).toEqual([])
      if (roleMode === 'pending') {
        await act(async () => { releaseRole(new Response(JSON.stringify({ success: true, data: { role: 'owner' } }), { headers: { 'Content-Type': 'application/json' } })) })
        expect(container.querySelector('a[href="/conversions/new"]')).not.toBeNull()
        expect(byText('編集')).toBeTruthy()
      }
    })
  }

  it('停止の理由が空なら送らず、入力した理由と開いた版を送る', async () => {
    await mount()
    await click(moreButtons()[0])
    await click(byText('止める・差し替える・削除する'))
    await click(byText('数えるのをやめる'))
    expect(writes).toHaveLength(0)
    expect(document.body.textContent).toContain('理由を入力してください')
    const reason = document.body.querySelector<HTMLInputElement>('#cv-stop-reason')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(reason, '計測の仕方を変えるため')
      reason.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(byText('数えるのをやめる'))
    expect(writes).toHaveLength(1)
    expect(writes[0].body).toMatchObject({ expectedVersion: 3, reason: '計測の仕方を変えるため' })
  })

  it('表示件数を増やすとページを戻し、全21行を表示する', async () => {
    fixture.rows = 21
    await mount()
    expect(container.querySelectorAll('tbody tr')).toHaveLength(20)
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="次のページ"]') ?? undefined)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="表示件数"]') ?? undefined)
    await click(byText('50件表示'))
    expect(container.querySelectorAll('tbody tr')).toHaveLength(21)
    expect(container.querySelector('button[aria-label="次のページ"]')).toBeNull()
  })

  it('旧URLの紹介者や送り元を失わず成果とアフィリエイトへ送る', async () => {
    fixture.tab = 'approvals'
    await mount()
    expect(fixture.replace).toHaveBeenCalledWith('/affiliates?tab=approvals&affiliate=affiliate-a&from=notice')
    expect(container.querySelector('table')).toBeNull()
  })
})
