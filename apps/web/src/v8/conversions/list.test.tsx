// @vitest-environment happy-dom
/*
 * V8 コンバージョンの一覧（src/v8/conversions/list.tsx）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 状態の札と件数・行の「…」（変える操作は権限のある人だけ）・止める小窓（理由が無いと止められない）・
 * 閲覧のみの帯と押せないボタンを置かないこと・1152 の板は札2つ。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const narrow = vi.hoisted(() => ({ value: false }))
const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/conversions',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.value }
})

vi.mock('@/lib/use-narrow-viewport', () => ({
  useNarrowViewport: () => narrow.value,
}))

import ConversionListV8 from './list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function point(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id, name, sourceType: 'ec_order_confirmed', value: null, measureMethod: 'webhook', targetUrl: null, countRepeat: true,
    attributionDays: 90, sourceConfig: {}, deduplicationMode: 'every', deduplicationWindowDays: null, valueMode: 'source',
    reversalPolicy: 'source_cancelled', lineAccountId: 'account-a', status: 'active', state: 'active', stateReason: null,
    ingest: { configured: true, disabledAt: null }, version: 3, usageCount: 2, usageNames: ['ファネル 1', 'アフィリエイト 1'],
    metrics: { recordedCount: 52, netCount: 52, reversedCount: null, reversedValue: null, netValue: 412000, reversalState: 'unavailable', reversalReason: '', cancellationCount: null, cancellationValue: null },
    stoppedAt: null, createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-08-25T09:00:00.000Z',
    ...overrides,
  }
}

const items = [
  point('cp-1', '商品を買った'),
  point('cp-6', '資料をダウンロードした', { sourceType: 'url_reach', measureMethod: 'url_reach', targetUrl: 'https://example.com/dl', deduplicationMode: 'once_per_friend', valueMode: 'none', status: 'stopped', state: 'stopped', usageCount: 0, usageNames: [], stoppedAt: '2026-09-20T09:00:00.000Z' }),
]

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const calls: string[] = []

let root: Root
let host: HTMLDivElement

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function mount() {
  await act(async () => { root.render(<ConversionListV8 accountId="account-a" />) })
  await flush()
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  role.value = 'owner'
  narrow.value = false
  push.mockReset()
  calls.length = 0
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    if (url.pathname === '/api/conversions/definitions') {
      return json({ success: true, data: { items, stateCounts: { active: 1, draft: 0, stopped: 1, invalid: 0, sourceStopped: 0, unused: 1 }, range: {}, pagination: { total: 2, limit: 100, cursor: '0', nextCursor: null } } })
    }
    if (url.pathname === '/api/conversions/report') {
      return json({ success: true, data: { kpis: { netCount: 52, previousNetCount: 40, netValue: 412000 }, byDefinition: [] } })
    }
    if (url.pathname.endsWith('/delete-impact')) {
      return json({ success: true, data: { definition: { ...items[0], version: 3 }, usages: [], eventCount: 52, canDelete: false, stopImpact: { affectedUsageCount: 2, preservesPastEvents: true, preservesUsages: true }, replacementCandidates: [] } })
    }
    return json({ success: true, data: null })
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

describe('V8 コンバージョンの一覧', () => {
  it('一覧の読み込みが失敗しても空とは扱わず、読み直すと成果地点を表示する', async () => {
    const base = globalThis.fetch
    let failed = true
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (failed && new URL(String(input)).pathname === '/api/conversions/definitions') {
        return json({ success: false, error: 'unavailable' }, 503)
      }
      return base(input, init)
    })
    await mount()
    expect(screen.getByText('成果地点を読み込めませんでした')).toBeTruthy()
    expect(screen.queryByText('まだ成果地点がありません')).toBeNull()
    failed = false
    fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }))
    await flush()
    expect(screen.getByText('商品を買った')).toBeTruthy()
    expect(screen.queryByText('成果地点を読み込めませんでした')).toBeNull()
  })
  it('編集で名前が空なら、その欄で理由を知らせ、欄へ移り、更新しない', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '成果地点「商品を買った」の操作' }))
    await flush()
    fireEvent.click(screen.getByRole('menuitem', { name: '編集する' }))
    await flush()
    const input = screen.getByLabelText('成果地点の名前') as HTMLInputElement
    const scroll = vi.fn()
    input.scrollIntoView = scroll
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'この内容にする' }))
    await flush()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(input)
    expect(scroll).toHaveBeenCalledWith({ block: 'center' })
    const error = screen.getByRole('alert')
    expect(error.textContent).toBe('名前を入れてください')
    expect(input.getAttribute('aria-describedby')).toBe(error.id)
    expect(screen.getAllByText('名前を入れてください')).toHaveLength(1)
    expect(calls.some((call) => call.startsWith('POST '))).toBe(false)
  })

  it('状態の札に口の件数を出し、行に数え方と使われている場所を出す', async () => {
    await mount()
    expect(screen.getByRole('button', { name: /動いている 1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /どこからも使われていない 1/ })).toBeTruthy()
    expect(screen.getByText('注文が確定したとき')).toBeTruthy()
    expect(screen.getByText('1回ごと・取り消しは引く')).toBeTruthy()
    expect(screen.getByText('1人1回・止めた日 9/20')).toBeTruthy()
    expect(screen.getByText('ファネル 1')).toBeTruthy()
    expect(screen.getByText('アフィリエイト 1')).toBeTruthy()
  })

  it('管理できる人：作る・使う場所を足すがあり、「…」から止めると表の下に止める小窓が開く（理由が無いと止められない）', async () => {
    await mount()
    expect(screen.getAllByRole('link', { name: /成果地点を作る/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: '使う場所を足す' }).length).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: '成果地点「商品を買った」の操作' }))
    await flush()
    expect(screen.getByRole('menuitem', { name: '編集する' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '複製する' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '止める' }))
    await flush()
    expect(calls).toContain('GET /api/conversions/definitions/cp-1/delete-impact')
    const card = screen.getByRole('region', { name: '止めるときの小窓' })
    expect(card.textContent).toContain('2か所で使われています。どうしますか。')
    const stop = Array.from(card.querySelectorAll('button')).find((button) => button.textContent === '止める') as HTMLButtonElement
    expect(stop.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('止める理由'), { target: { value: '計測の仕方を変えるため' } })
    expect(stop.disabled).toBe(false)
  })

  it('閲覧のみ：帯を出し、作る・使う場所を足す・変える操作は置かない（見る操作は残す）', async () => {
    role.value = 'staff'
    await mount()
    expect(screen.getByText('閲覧のみで見ています。変える操作は管理者に頼んでください。')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /成果地点を作る/ })).toBeNull()
    expect(screen.queryByRole('link', { name: '使う場所を足す' })).toBeNull()
    expect(Array.from(document.querySelectorAll('button')).filter((button) => button.disabled)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '成果地点「商品を買った」の操作' }))
    await flush()
    expect(screen.getByRole('menuitem', { name: '中身を見る' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '使う場所を見る' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '編集する' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '止める' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '複製する' })).toBeNull()
  })

  it('1152 の板：札は「動いている」「止めている」の2つだけ（ほかはよく使う絞り込みから）', async () => {
    narrow.value = true
    await mount()
    expect(screen.getByRole('button', { name: /動いている 1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /止めている 1/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /下書き 0/ })).toBeNull()
    expect(screen.getByText('使われていない')).toBeTruthy()
  })

  it('受け口を止めると押した瞬間に「止まっています」になり、保存に失敗したら元に戻す（触り心地 5 回目）', async () => {
    let finish: (response: Response) => void = () => {}
    const base = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/ingest-disable')) {
        calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
        return new Promise<Response>((resolve) => { finish = resolve })
      }
      return base(input, init)
    })
    await mount()
    fireEvent.click(screen.getByText('商品を買った'))
    await flush()
    const panel = screen.getByRole('region', { name: '詳細の小窓' })
    expect(panel.textContent).toContain('（動いています）')
    fireEvent.click(screen.getByRole('button', { name: '詳細「商品を買った」のその他の操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '受け口を止める' }))
    await flush()
    expect(calls).toContain('POST /api/conversions/definitions/cp-1/ingest-disable')
    // 返事を待たずに変わっている
    expect(screen.getByRole('region', { name: '詳細の小窓' }).textContent).toContain('（止まっています）')
    await act(async () => { finish(json({ success: false, error: 'conflict' }, 409)) })
    await flush()
    expect(screen.getByRole('region', { name: '詳細の小窓' }).textContent).toContain('（動いています）')
    expect(calls.filter((call) => call === 'GET /api/conversions/definitions')).toHaveLength(1)
  })

  it('札で絞ると、その状態の行だけになる', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /止めている 1/ }))
    await flush()
    expect(screen.queryByText('商品を買った')).toBeNull()
    expect(screen.getByText('資料をダウンロードした')).toBeTruthy()
  })
})
