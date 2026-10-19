// @vitest-environment happy-dom
/*
 * 統括「店の比較」（G7）：店×7つの数・平均との差の札・並べ替え・行の引き出し・準備中の窓。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diffTone, formatDiff, formatMetric, METRICS } from './metrics'

const api = vi.hoisted(() => ({ get: vi.fn(), detail: vi.fn(), export: vi.fn(), exportStatus: vi.fn(), download: vi.fn() }))
vi.mock('@/lib/api/helpers/gap3', () => ({ storeComparisonApi: api }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/hq/store-comparison', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', setSelectedAccountId: vi.fn(), loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))

const { default: StoreComparisonList } = await import('./list')

const metric = (value: number | null, diff: number | null, unit = '件') => ({ value, diff, unit, available: value !== null })
const row = (id: string, name: string, bookings: number, bookingsDiff: number, block: number, blockDiff: number) => ({
  accountId: id, name, style: null, computedAt: null,
  metrics: {
    friendChange: metric(4, 0, '人'), blockRate: metric(block, blockDiff, '%'), clickRate: metric(null, null, '%'),
    bookings: metric(bookings, bookingsDiff), visits: metric(10, 1), noShowRate: metric(2, -0.5, '%'), responseMinutes: metric(8, 0, '分'),
  },
})
const DATA = {
  rows: [row('s1', '大宮店', 12, -25, 3.8, 1.4), row('s2', '渋谷店', 72, 35, 1.2, -1.2)],
  average: { friendChange: 10, blockRate: 2.5, clickRate: null, bookings: 40, visits: 30, noShowRate: 3, responseMinutes: 9 },
  total: 2, computedAt: null,
}

beforeEach(() => {
  api.get.mockResolvedValue({ success: true, data: DATA })
  api.detail.mockResolvedValue({ success: true, data: { recentBroadcasts: [{ id: 'b1', title: '秋の新メニュー', status: 'sent', sent_at: '2026-10-14T01:00:00Z' }], attention: null } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('数の書き方', () => {
  it('単位と符号：人は ±、割合は pt、件・分はそのまま', () => {
    expect(formatMetric('friendChange', -3)).toBe('−3 人')
    expect(formatMetric('blockRate', 3.84)).toBe('3.8%')
    expect(formatDiff('blockRate', -2.1)).toBe('−2.1')
    expect(formatDiff('bookings', 3)).toBe('+3')
    expect(formatDiff('bookings', 0)).toBeNull()
    expect(formatMetric('clickRate', null)).toBe('—')
  })
  it('良い悪いは数ごとに向きが逆：ブロック率は下がると良い、予約は上がると良い', () => {
    const def = (key: string) => METRICS.find((m) => m.key === key)!
    expect(diffTone(def('blockRate'), -1)).toBe('up')
    expect(diffTone(def('blockRate'), 1)).toBe('down')
    expect(diffTone(def('bookings'), 5)).toBe('up')
    expect(diffTone(def('bookings'), -5)).toBe('down')
    expect(diffTone(def('bookings'), 0)).toBeNull()
  })
})

describe('店の比較の表', () => {
  it('店と7つの数を出し、初めは予約の少ない順で頼む。取れない数は「—」', async () => {
    render(<StoreComparisonList />)
    await screen.findByText('大宮店')
    expect(api.get).toHaveBeenCalledWith(expect.objectContaining({ sort: 'bookings', order: 'asc', compare: 'previous', pageSize: 20 }))
    for (const def of METRICS) expect(screen.getByRole('button', { name: `${def.label}で並べ替える` })).toBeTruthy()
    expect(screen.getByText('−25')).toBeTruthy()
    expect(screen.getAllByTitle('この数はまだ取れていません').length).toBe(2)
    expect(screen.getByText('2 店の平均')).toBeTruthy()
    expect(screen.getByText(/札は前の期間との差（赤＝悪い・緑＝良い）/)).toBeTruthy()
  })

  it('列の見出しを押すとその数の順で頼み直す（同じ列をもう一度押すと向きが逆）', async () => {
    render(<StoreComparisonList />)
    await screen.findByText('大宮店')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ブロック率で並べ替える' })) })
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'blockRate', order: 'asc' })))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ブロック率で並べ替える' })) })
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'blockRate', order: 'desc' })))
  })

  it('行を押すと右の引き出しに、最近の配信と［この店を開く］を出す', async () => {
    render(<StoreComparisonList />)
    fireEvent.click(await screen.findByText('大宮店'))
    expect(await screen.findByText('秋の新メニュー')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'この店を開く' })).toBeTruthy()
    expect(api.detail).toHaveBeenCalledWith('s1', expect.any(String), expect.any(String))
  })

  it('CSV は書き出しを頼み、できたら受け取る（今の並び・比べる相手のまま）', async () => {
    api.export.mockResolvedValue({ success: true, data: { id: 'x1', replayed: false } })
    api.exportStatus.mockResolvedValue({ success: true, data: { id: 'x1', status: 'completed', rowCount: 2, downloadUrl: null, errorCode: null } })
    api.download.mockResolvedValue(undefined)
    render(<StoreComparisonList />)
    await screen.findByText('大宮店')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'CSVで書き出す' })) })
    await waitFor(() => expect(api.download).toHaveBeenCalledWith('x1'))
    expect(api.export).toHaveBeenCalledWith(expect.objectContaining({ sort: 'bookings', order: 'asc', compare: 'previous' }), expect.any(String))
  })

  it('書き出しに失敗したら理由を知らせる', async () => {
    api.export.mockRejectedValue(new Error('down'))
    render(<StoreComparisonList />)
    await screen.findByText('大宮店')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'CSVで書き出す' })) })
    expect(await screen.findByText(/CSV を書き出せませんでした/)).toBeTruthy()
  })

  it('店の組は口が無いので「現在準備中です」の窓を出す', async () => {
    render(<StoreComparisonList />)
    await screen.findByText('大宮店')
    fireEvent.click(screen.getByRole('button', { name: '店の組：すべて' }))
    expect((await screen.findByRole('dialog')).textContent).toContain('現在準備中です')
  })

  it('失敗したら「もう一度」を出す', async () => {
    api.get.mockRejectedValueOnce(new Error('down'))
    render(<StoreComparisonList />)
    expect(await screen.findByRole('button', { name: /もう一度/ })).toBeTruthy()
  })
})
