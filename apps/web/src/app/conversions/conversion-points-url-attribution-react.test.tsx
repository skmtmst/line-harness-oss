// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConversionsPage from './page'

/*
 * R281: 対象URLと計測期間を、作ったあと画面から確かめ・直せる。
 *
 * 口と版上げ（revise）は targetUrl/attributionDays を持っていたが、
 * 詳細に出ず・編集に欄が無かった。見るのは画面の文字と送った口の中身。
 * 空欄は既定の90日と分かる書き方にし、明示の7日と区別する。
 */

const fixture = vi.hoisted(() => ({ accountId: 'account-a' as string | null }))
const net = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; method: string; body: unknown }>,
}))

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
  useMergedTab: () => 'points',
}))

const BASE = {
  sourceType: 'url_reach',
  value: null,
  measureMethod: 'url_reach',
  countRepeat: true,
  sourceConfig: {},
  deduplicationMode: 'every',
  deduplicationWindowDays: null,
  valueMode: 'none',
  reversalPolicy: 'manual',
  lineAccountId: 'account-a',
  status: 'active',
  state: 'active',
  stateReason: null,
  ingest: { configured: false, disabledAt: null },
  version: 3,
  usageCount: 0,
  usageNames: [],
  metrics: {
    recordedCount: 0, netCount: 0, reversedCount: null, netValue: 0,
    reversalState: 'unavailable', reversalReason: '', cancellationCount: null, cancellationValue: null,
  },
  stoppedAt: null,
  createdAt: '2026-09-01T00:00:00.000+09:00',
  updatedAt: '2026-09-01T00:00:00.000+09:00',
}

const state = vi.hoisted(() => ({
  items: [] as unknown[],
}))

function listBody() {
  return {
    success: true,
    data: {
      items: state.items,
      stateCounts: { active: 1, draft: 0, stopped: 0, invalid: 0, sourceStopped: 0, unused: 0 },
      range: { from: '2026-09-01 00:00:00', to: '2026-09-30 23:59:59', timeZone: 'Asia/Tokyo' },
      pagination: { total: state.items.length, limit: 50, cursor: '0', nextCursor: null },
    },
  }
}

function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const path = raw.startsWith('http') ? raw.slice(new URL(raw).origin.length) : raw
    let body: unknown = null
    try { body = init?.body ? JSON.parse(String(init.body)) : null } catch { body = init?.body ?? null }
    net.calls.push({ path, method: init?.method ?? 'GET', body })
    if (/^\/api\/conversions\/definitions\/[^/]+\/revise/.test(path)) {
      // 本番の版上げと同じく、保存した内容を次の一覧読み直しへ反映する。
      const item = state.items[0] as Record<string, unknown>
      const b = (body ?? {}) as Record<string, unknown>
      state.items[0] = {
        ...item,
        name: b.name ?? item['name'],
        targetUrl: (b.targetUrl as string | null) ?? null,
        attributionDays: (b.attributionDays as number | null) ?? null,
        version: Number(item['version']) + 1,
      }
      return new Response(JSON.stringify({
        success: true, data: { id: 'point-page', version: 4, revisionId: 'rev-1', movedUsages: 0, updatedAt: '' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (path.startsWith('/api/conversions/definitions')) {
      return new Response(JSON.stringify(listBody()), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (path.startsWith('/api/conversions/report') || path.startsWith('/api/conversions/definition-report')) {
      return new Response(JSON.stringify({ success: true, data: { kpis: {}, daily: [], byDefinition: [], byRoute: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (path.startsWith('/api/conversions/definition-events') || path.startsWith('/api/conversions/events')) {
      return new Response(JSON.stringify({ success: true, data: { items: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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

let container: HTMLDivElement
let root: Root

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(React.createElement(ConversionsPage)) })
  await act(async () => { await Promise.resolve() })
}

function byText(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')]
    .find((node) => node.textContent?.trim() === text) as HTMLButtonElement | undefined
}

function byLabel(label: string): HTMLElement | undefined {
  return (document.body.querySelector(`[aria-label="${label}"]`) ?? undefined) as HTMLElement | undefined
}

function field(label: string): HTMLInputElement | undefined {
  return byLabel(label) as HTMLInputElement | undefined
}

async function click(node: HTMLElement | undefined) {
  expect(node, '押せる要素が見つかりません').toBeTruthy()
  await act(async () => { node!.click() })
  await act(async () => { await Promise.resolve() })
}

async function type(node: HTMLInputElement | undefined, value: string) {
  expect(node, '入力欄が見つかりません').toBeTruthy()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(node!, value)
    node!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function openDetail(name: string) {
  await click(byLabel(`${name}のその他操作`) as HTMLButtonElement)
  await click(byText('中身を見る'))
}

async function openEdit(name: string) {
  await openDetail(name)
  await click(byText('編集'))
}

function pagePoint() {
  return {
    ...BASE,
    id: 'point-page',
    name: '到達ページ',
    targetUrl: 'https://example.com/thanks',
    attributionDays: 7,
  }
}

beforeEach(() => {
  net.calls = []
  fixture.accountId = 'account-a'
  state.items = [pagePoint()]
  vi.stubGlobal('localStorage', new MemoryStorage())
  installFetch()
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

describe('R281 対象URLと計測期間の確認・修正', () => {
  it('詳細にURL・7日・取消方針が出る', async () => {
    await mount()
    await openDetail('到達ページ')
    const text = document.body.textContent ?? ''
    expect(text).toContain('https://example.com/thanks')
    expect(text).toContain('7日')
    expect(text).toContain('人が取り消す')
  })

  it('空欄の計測期間は既定の90日と分かる', async () => {
    state.items = [{ ...pagePoint(), attributionDays: null }]
    await mount()
    await openDetail('到達ページ')
    expect(document.body.textContent).toContain('90日（既定）')
  })

  it('編集欄でURLと7日を直すと口へ渡り、再読込後の詳細にも出る', async () => {
    await mount()
    await openEdit('到達ページ')
    expect((field('数えてよいページ') as HTMLInputElement).value).toBe('https://example.com/thanks')
    expect((field('友だち追加からの計測期間') as HTMLInputElement).value).toBe('7')

    await type(field('数えてよいページ'), 'https://example.com/thanks2')
    await type(field('友だち追加からの計測期間'), '30')
    await click(byText('この内容にする'))

    const revise = net.calls.find((call) => call.path.includes('/revise'))
    expect(revise, '編集の口が呼ばれていません').toBeTruthy()
    expect(revise!.body).toMatchObject({
      targetUrl: 'https://example.com/thanks2',
      attributionDays: 30,
    })

    // 保存後の読み直しで新しい値が返るので、詳細にも出る。
    await act(async () => { await Promise.resolve() })
    await openDetail('到達ページ')
    const text = document.body.textContent ?? ''
    expect(text).toContain('https://example.com/thanks2')
    expect(text).toContain('30日')
  })

  it('URL以外の起点の編集にはURL欄が出ない', async () => {
    state.items = [{
      ...pagePoint(),
      id: 'point-order',
      name: '注文',
      sourceType: 'ec_order_confirmed',
      measureMethod: 'webhook',
      targetUrl: null,
      valueMode: 'source',
    }]
    await mount()
    await openEdit('注文')
    expect(field('数えてよいページ')).toBeUndefined()
    // 計測期間は起点を問わず直せる。
    expect(field('友だち追加からの計測期間')).toBeTruthy()
  })

  it('URLが空・期間が範囲外のまま送らない', async () => {
    await mount()
    await openEdit('到達ページ')
    await type(field('数えてよいページ'), '   ')
    await click(byText('この内容にする'))
    expect(net.calls.filter((call) => call.path.includes('/revise'))).toHaveLength(0)
    expect(document.body.textContent).toContain('数えてよいページを入れてください')

    await type(field('数えてよいページ'), 'https://example.com/thanks')
    await type(field('友だち追加からの計測期間'), '0')
    await click(byText('この内容にする'))
    expect(net.calls.filter((call) => call.path.includes('/revise'))).toHaveLength(0)
    expect(document.body.textContent).toContain('計測期間は1〜365日で入れてください')
  })
})
