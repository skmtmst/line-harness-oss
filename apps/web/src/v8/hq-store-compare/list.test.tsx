// @vitest-environment happy-dom
/*
 * 統括「店の比較」（G7）：店×7つの数・平均との差の札・並べ替え・行の引き出し・準備中の窓。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diffTone, formatDiff, formatMetric, METRICS } from './metrics'

const navigation = vi.hoisted(() => ({push:vi.fn(),select:vi.fn()}))
const accountState = vi.hoisted(() => ({ accounts: [] as Array<Record<string, unknown>>, refresh: vi.fn(), role: 'owner' as string | null }))
const fetchApi = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), fetchApi }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => accountState.role, canManageRole: (role: string | null) => role === 'owner' || role === 'admin' }))
const api = vi.hoisted(() => ({ get: vi.fn(), detail: vi.fn(), export: vi.fn(), exportStatus: vi.fn(), download: vi.fn() }))
vi.mock('@/lib/api/helpers/gap3', () => ({ storeComparisonApi: api }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navigation.push, replace: vi.fn() }), usePathname: () => '/hq/store-comparison', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', setSelectedAccountId: navigation.select, loading: false, accounts: accountState.accounts, refreshAccounts: accountState.refresh }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))

const { default: StoreComparisonList } = await import('./list')

const metric = (value: number | null, diff: number | null, unit = '件') => ({ value, diff, unit, available: value !== null })
const row = (id: string, name: string, bookings: number, bookingsDiff: number, block: number, blockDiff: number) => ({
  accountId: id, name, style: null, computedAt: '2026-10-24T19:30:00.000Z',
  metrics: {
    friendChange: metric(4, 0, '人'), blockRate: metric(block, blockDiff, '%'), clickRate: metric(null, null, '%'),
    bookings: metric(bookings, bookingsDiff), visits: metric(10, 1), noShowRate: metric(2, -0.5, '%'), responseMinutes: metric(8, 0, '分'),
  },
})
const DATA = {
  rows: [row('s1', '大宮店', 12, -25, 3.8, 1.4), row('s2', '渋谷店', 72, 35, 1.2, -1.2)],
  average: { friendChange: 10, blockRate: 2.5, clickRate: null, bookings: 40, visits: 30, noShowRate: 3, responseMinutes: 9 },
  total: 2, computedAt: '2026-10-24T19:30:00.000Z',
}
const NOTHING = Object.fromEntries(Object.entries(DATA.rows[0].metrics).map(([key, value]) => [key, { ...value, value: null, diff: null, available: false }]))

beforeEach(() => {
  api.get.mockResolvedValue({ success: true, data: DATA })
  api.detail.mockResolvedValue({ success: true, data: { recentBroadcasts: [{ id: 'b1', title: '秋の新メニュー', status: 'sent', sent_at: '2026-10-14T01:00:00Z' }], attention: null } })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); accountState.accounts = []; accountState.role = 'owner' })

describe('数の書き方', () => {
  it('単位と符号：人は ±、割合は pt、件・分はそのまま', () => {
    expect(formatMetric('friendChange', -3)).toBe('−3 人')
    expect(formatMetric('blockRate', 3.84)).toBe('3.8%')
    expect(formatDiff('blockRate', -2.1)).toBe('−2.1')
    expect(formatDiff('bookings', 3)).toBe('+3')
    expect(formatDiff('bookings', 0)).toBeNull()
    expect(formatDiff('responseMinutes', 0.4)).toBeNull()
    expect(formatDiff('blockRate', 0.04)).toBeNull()
    expect(formatDiff('responseMinutes', 0.6)).toBe('+1')
    expect(formatMetric('clickRate', null)).toBe('—')
  })
  it('良い悪いは数ごとに向きが逆：ブロック率は下がると良い、予約は上がると良い', () => {
    const def = (key: string) => METRICS.find((m) => m.key === key)!
    expect(diffTone(def('blockRate'), -1)).toBe('up')
    expect(diffTone(def('blockRate'), 1)).toBe('down')
    expect(diffTone(def('bookings'), 5)).toBe('up')
    expect(diffTone(def('bookings'), -5)).toBe('down')
    expect(diffTone(def('bookings'), 0)).toBeNull()
    expect(diffTone(def('responseMinutes'), 0.3)).toBeNull()
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
    const average = screen.getByText('2 店の平均')
    const fullSummary = average.parentElement?.querySelector('[data-truncated-text]')
    expect(fullSummary?.getAttribute('title')).toBe(fullSummary?.textContent)
    for (const def of METRICS) expect(fullSummary?.getAttribute('title')).toContain(def.label)
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

it('推移7種と対応0件を保ち押した店を切り替えて開く',async()=>{
 const values={friendChange:-3,blockRate:1,clickRate:null,bookings:0,visits:0,noShowRate:null,responseMinutes:2};
 api.detail.mockResolvedValue({success:true,data:{trend:[{date:'2026-10-15',values,state:'partial'}],recentBroadcasts:[],attention:{status:'ready',counts:{unhandledChats:5,pendingBookings:3,unpaid:0,connections:1,stoppedDeliveries:0},targets:{unhandledChats:[{href:'/chats?status=unread',count:5}],pendingBookings:[{href:'/booking/bookings?view=list&status=requested',count:1},{href:'/events/bookings?id=definition-a',count:1},{href:'/restaurant-test/reservations?view=list',count:1}]}}}});
 render(<StoreComparisonList/>);fireEvent.click(await screen.findByText('大宮店'));await screen.findByRole('group',{name:'友だちの増減の日ごとの推移'});
 for(const def of METRICS)expect(screen.getByRole('group',{name:`${def.label}の日ごとの推移`})).toBeTruthy();expect(screen.getByText('未払い 0件')).toBeTruthy();expect(screen.queryByRole('button',{name:'お支払いの記録を開く 0件'})).toBeNull();expect(screen.getByText('承認待ちの予約 3件')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'未対応のトークを開く 5件'}));expect(navigation.select).toHaveBeenCalledWith('s1');expect(navigation.push).toHaveBeenCalledWith('/chats?status=unread');
 fireEvent.click(screen.getByRole('button',{name:'イベントの申込を開く 1件'}));expect(navigation.push).toHaveBeenLastCalledWith('/events/bookings?id=definition-a');
 fireEvent.click(screen.getByRole('button',{name:'飲食店の予約台帳を開く 1件'}));expect(navigation.push).toHaveBeenLastCalledWith('/restaurant-test/reservations?view=list');
});
it('対応取得失敗時は0件ボタンを作らず配信は残す',async()=>{
 api.detail.mockResolvedValue({success:true,data:{trend:[],recentBroadcasts:[{id:'b',title:'実際の配信',status:'sent',sent_at:null}],attention:{status:'unavailable',counts:null}}});
 render(<StoreComparisonList/>);fireEvent.click(await screen.findByText('大宮店'));expect(await screen.findByText('対応が要るものを読み込めませんでした。')).toBeTruthy();expect(screen.queryByRole('button',{name:'未払い 0件'})).toBeNull();expect(screen.getByText('実際の配信')).toBeTruthy();
});

describe('数が取れない理由', () => {
  const uncomputed = (rows: typeof DATA.rows) => ({ ...DATA, rows, computedAt: null })

  it('全店の集計がまだなら、集計の時刻と「—」の理由を出す', async () => {
    api.get.mockResolvedValue({ success: true, data: uncomputed(DATA.rows.map((r) => ({ ...r, computedAt: null, metrics: NOTHING as typeof r.metrics }))) })
    render(<StoreComparisonList />)
    await screen.findByText('大宮店')
    expect(screen.getByText(/^まだ集計していません（毎朝 4 時半から、前の日の分まで集計します）/)).toBeTruthy()
    expect(screen.getAllByTitle('まだ集計していません（毎朝 4 時半から、前の日の分まで集計します）').length).toBe(METRICS.length * 2)
    expect(screen.queryByTitle('この数はまだ取れていません')).toBeNull()
  })

  it('一部の店だけ集計がそろっていないときは店の数を出し、集計済みの店では出さない', async () => {
    api.get.mockResolvedValueOnce({ success: true, data: uncomputed([{ ...DATA.rows[0], computedAt: null, metrics: NOTHING as typeof DATA.rows[0]['metrics'] }, DATA.rows[1]]) })
    const view = render(<StoreComparisonList />)
    await screen.findByText('大宮店')
    expect(screen.getByText(/集計がそろっていない店が 1 店あります/)).toBeTruthy()
    view.unmount()
    render(<StoreComparisonList />)
    await screen.findByText('大宮店')
    expect(screen.queryByText(/集計していません|集計がそろっていない/)).toBeNull()
  })

  it('LINE の鍵が切れた店の行に知らせを出し、［更新する］で確かめ直して読み直す', async () => {
    accountState.accounts = [{ id: 's1', name: '大宮店', revision: 3, connection: { status: 'warn', checkedAt: null, tokenExpired: true, issues: [] } }, { id: 's2', name: '渋谷店', revision: 2, connection: { status: 'ok', checkedAt: null, tokenExpired: false } }]
    fetchApi.mockResolvedValue({ success: true })
    render(<StoreComparisonList />)
    await screen.findByText('大宮店')
    const notices = document.querySelectorAll('[data-store-connection]')
    expect([...notices].map((node) => node.getAttribute('data-store-connection'))).toEqual(['s1'])
    expect(notices[0].textContent).toContain('LINE の接続が切れています')
    const calls = api.get.mock.calls.length
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '更新する' })) })
    expect(fetchApi).toHaveBeenCalledWith('/api/line-accounts/s1/connection-checks', expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedRevision: 3 }) }))
    expect(accountState.refresh).toHaveBeenCalled()
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(calls))
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('確かめ直しに失敗したら行の知らせで伝え、閲覧だけの人には［更新する］を出さない', async () => {
    accountState.accounts = [{ id: 's1', name: '大宮店', revision: 3, connection: { status: 'warn', checkedAt: null, tokenExpired: true } }]
    fetchApi.mockRejectedValue(new Error('down'))
    const view = render(<StoreComparisonList />)
    await screen.findByText('大宮店')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '更新する' })) })
    expect(await screen.findByText(/確かめ直せませんでした/)).toBeTruthy()
    view.unmount()
    accountState.role = 'staff'
    render(<StoreComparisonList />)
    await screen.findByText('大宮店')
    expect(document.querySelector('[data-store-connection]')?.textContent).toContain('LINE の接続が切れています')
    expect(screen.queryByRole('button', { name: '更新する' })).toBeNull()
  })
})
