// @vitest-environment happy-dom
/*
 * 分析「お客さまの分け方」（G5-1）：5×5 の表・全員の数・マスの引き出し・LINE を送る・閲覧のみの扱い。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), friends: vi.fn(), saveSearch: vi.fn(), rename: vi.fn() }))
const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('@/lib/api/helpers/gap3', () => ({ customerSegmentsApi: api }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn() }), usePathname: () => '/analytics', useSearchParams: () => new URLSearchParams() }))

const { default: SegmentsV8 } = await import('./segments')

const cells = Array.from({ length: 25 }, (_, i) => ({ r: 1 + Math.floor(i / 5), f: 1 + (i % 5), name: `マス${i + 1}`, count: i === 12 ? 88 : 10, optedOutCount: 0 }))
const DATA = { cells, outside: { count: 312 }, total: 1284, computedAt: '2026-10-16T04:00:00.000Z', status: 'ready' }
const FRIENDS = { items: [{ id: 'f1', display_name: '佐藤 健', activity_count: 1, amount: 0, last_activity_at: '2026-08-02T01:00:00Z' }], total: 88, optedOutCount: 6, nextCursor: '20' }

beforeEach(() => {
  api.get.mockResolvedValue({ success: true, data: DATA })
  api.friends.mockResolvedValue({ success: true, data: FRIENDS })
  api.saveSearch.mockResolvedValue({ success: true, data: { id: 's' } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('お客さまの分け方', () => {
  it('全員の数と、表の外（来店・購入なし）の数を出す。25 マスが並ぶ', async () => {
    render(<SegmentsV8 accountId="a" canManage />)
    expect(await screen.findByText('全員 1,284 人')).toBeTruthy()
    expect(screen.getByText(/来店・購入なし 312 人は表の外/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^マス\d+ / })).toHaveLength(25)
    expect(api.get).toHaveBeenCalledWith('a', 'both', 'count')
  })

  it('［金額で見る］と数える物の切り替えで、頼み直す', async () => {
    render(<SegmentsV8 accountId="a" canManage />)
    await screen.findByText('全員 1,284 人')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '金額で見る' })) })
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('a', 'both', 'amount'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '来店だけ' })) })
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('a', 'visit', 'amount'))
  })

  it('マスを押すと人の一覧と、宣伝を止めている人の数を出す。［この 88 人に LINE を送る］は配信の条件を付けて開く', async () => {
    render(<SegmentsV8 accountId="a" canManage />)
    await screen.findByText('全員 1,284 人')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'マス13 88 人' })) })
    expect(await screen.findByText('佐藤 健')).toBeTruthy()
    expect(screen.getByText(/宣伝を止めている人 6 人/)).toBeTruthy()
    expect(api.friends).toHaveBeenCalledWith('a', 3, 3, 'both', 'count')
    fireEvent.click(screen.getByRole('button', { name: 'この 88 人に LINE を送る' }))
    const url = nav.push.mock.calls[0][0] as string
    expect(url.startsWith('/broadcasts/new?condition=')).toBe(true)
    expect(JSON.parse(decodeURIComponent(url.split('=')[1]))).toEqual({ operator: 'AND', rules: [{ type: 'customer_segment', value: { r: 3, f: 3, basis: 'both', measure: 'count' } }] })
  })

  it('［保存した検索にする］は保存の口を呼ぶ。閲覧のみの人には、保存も LINE も置かない', async () => {
    const { unmount } = render(<SegmentsV8 accountId="a" canManage />)
    await screen.findByText('全員 1,284 人')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'マス13 88 人' })) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '保存した検索にする' })) })
    await waitFor(() => expect(api.saveSearch).toHaveBeenCalledWith('a', 3, 3, expect.objectContaining({ basis: 'both', measure: 'count' })))
    unmount()
    render(<SegmentsV8 accountId="a" canManage={false} />)
    await screen.findByText('全員 1,284 人')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'マス13 88 人' })) })
    await screen.findByText('佐藤 健')
    expect(screen.queryByRole('button', { name: '保存した検索にする' })).toBeNull()
    expect(screen.queryByRole('button', { name: /LINE を送る/ })).toBeNull()
  })

  it('集計がまだのときは案内を出し、マスは押せない', async () => {
    api.get.mockResolvedValue({ success: true, data: { ...DATA, cells: cells.map((c) => ({ ...c, count: null })), computedAt: null, status: 'not_computed', total: null, outside: { count: null } } })
    render(<SegmentsV8 accountId="a" canManage />)
    expect(await screen.findByText(/まだ集計していません/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^マス\d+ / })[0].hasAttribute('disabled')).toBe(true)
  })
})
