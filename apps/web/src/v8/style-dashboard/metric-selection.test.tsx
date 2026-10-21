// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { STYLE_METRIC_IDS, type StyleSchedule, type StyleSnapshot } from '@line-crm/shared'
const state = vi.hoisted(() => ({ account: 'a', role: 'admin', get: vi.fn(), save: vi.fn(), reset: vi.fn(), summary: vi.fn(), version: 2, customized: false as boolean | undefined, ids: ['bookings', 'attention', 'nextBookingRate', 'paidAmount', 'newBookings'], error: null as unknown }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.account }) }))
vi.mock('@/lib/staff-role', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/staff-role')>(), useStaffRole: () => state.role }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/v8/restaurant/dashboard/public/use-store-today/index', () => ({ useStoreToday: () => ({}) }))
vi.mock('@/components/shared/preparing-dialog', () => ({ PREPARING_TITLE: 'preparing', usePreparingDialog: () => ({ open: vi.fn(), dialog: null }) }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { summary: state.summary, schedule: vi.fn(), get: state.get, saveCards: state.save, resetCards: state.reset } }))
vi.mock('@/lib/api', async importOriginal => { const actual = await importOriginal<typeof import('@/lib/api')>(); return { ...actual, bookingApi: { ...actual.bookingApi, getPaymentConfig: vi.fn().mockResolvedValue({ data: {} }) } } })
import StyleDashboard from './style-dashboard'
import { styleApi } from '@/lib/api/helpers/styles'
const cards = [{ id: 'connection-alert', visible: true }, { id: 'ledger', visible: true }, { id: 'analytics', visible: true }]
const profile = () => ({ data: { cards, version: state.version, metricIds: [...state.ids], metricsCustomized: state.customized } })
const metric = (value: number, unit = '件') => ({ value, status: 'available' as const, unit, formula: '選択した期間の実集計' })
const snapshot: StyleSnapshot = { style: 'salon', from: '2026-10-20T15:00:00Z', to: '2026-10-21T15:00:00Z', timeZone: 'Asia/Tokyo', asOf: '2026-10-21T05:00:00Z', dateBasis: 'visit', range: 'today', metrics: { bookings: metric(4), attention: metric(2), nextBookingRate: metric(0.2, '%'), recall: metric(9), noShowRate: metric(0.1, '%'), visits: metric(3, '人') }, previous: {}, items: [], newBookings: [], resultId: 'real' }
const schedule: StyleSchedule = { style: 'salon', from: snapshot.from, to: snapshot.to, timeZone: snapshot.timeZone, asOf: snapshot.asOf, range: 'today', display: 'list', calendarView: 'day', entries: [], columns: [], days: [], closures: [], availability: { status: 'available', reason: null, resources: [], slots: [], closedDates: [] } }
function labels() { return Array.from(document.querySelectorAll('[data-style-dashboard] [data-kpi-label]')).map(node => node.getAttribute('title')) }
async function open() { await waitFor(() => expect(state.summary).toHaveBeenCalled()); fireEvent.click(screen.getByRole('button', { name: '表示を変える' })); const drawer = await screen.findByRole('dialog', { name: /表示を変える/ }); await within(drawer).findByRole('switch', { name: '分析', exact: true }); return drawer }
beforeEach(() => {
  vi.clearAllMocks(); state.account = 'a'; state.role = 'admin'; state.version = 2; state.customized = false; state.ids = ['bookings', 'attention', 'nextBookingRate', 'paidAmount', 'newBookings']; state.error = null
  state.get.mockImplementation(async () => profile()); state.summary.mockResolvedValue({ data: snapshot }); vi.mocked(styleApi.schedule).mockResolvedValue({ success: true, data: schedule })
  state.save.mockImplementation(async (_account, version, _cards, ids) => {
    if (state.error) throw state.error
    expect(version).toBe(state.version); state.version++
    if (ids !== undefined) { state.ids = ids; state.customized = true }
    return profile()
  })
  state.reset.mockImplementation(async () => { state.customized = false; state.version++; state.ids = ['bookings', 'attention', 'nextBookingRate', 'paidAmount', 'newBookings']; return profile() })
})
afterEach(cleanup)

it('未選択は呼び戻し・無断率を保ち、変更した数だけ版付き保存して再読込後も順番を復元する', async () => {
  const view = render(<StyleDashboard style="salon" />)
  await waitFor(() => expect(labels()).toEqual(['今日の予約', '対応待ち', '次回予約率', '呼び戻し待ち', '無断キャンセル率']))
  const drawer = await open()
  fireEvent.click(within(drawer).getByRole('switch', { name: '数の帯：無断キャンセル率' }))
  fireEvent.click(within(drawer).getByRole('switch', { name: '数の帯：来店数' }))
  fireEvent.click(within(drawer).getByRole('button', { name: '数の帯：来店数を上へ' }))
  fireEvent.click(within(drawer).getByRole('button', { name: '保存する', exact: true }))
  await waitFor(() => expect(state.save).toHaveBeenCalledWith('a', 2, cards, ['bookings', 'attention', 'nextBookingRate', 'visits', 'recall']))
  await waitFor(() => expect(labels()).toEqual(['今日の予約', '対応待ち', '次回予約率', '来店数', '呼び戻し待ち']))
  expect(state.summary.mock.calls.length).toBeGreaterThan(1)
  view.unmount(); render(<StyleDashboard style="salon" />)
  await waitFor(() => expect(labels()).toEqual(['今日の予約', '対応待ち', '次回予約率', '来店数', '呼び戻し待ち']))
})

it('明示customがserver defaultと同値でも保持し、カードのみ保存でmetricIdsを送らない', async () => {
  state.customized = true
  render(<StyleDashboard style="salon" />)
  await waitFor(() => expect(labels()).toEqual(['今日の予約', '対応待ち', '次回予約率', '入金額', '新着予約']))
  const drawer = await open()
  fireEvent.click(within(drawer).getByRole('switch', { name: '分析', exact: true }))
  fireEvent.click(within(drawer).getByRole('button', { name: '保存する', exact: true }))
  await waitFor(() => expect(state.save).toHaveBeenCalledWith('a', 2, [{ ...cards[0] }, { ...cards[1] }, { id: 'analytics', visible: false }], undefined))
  expect(state.customized).toBe(true)
  expect(state.ids).toEqual(['bookings', 'attention', 'nextBookingRate', 'paidAmount', 'newBookings'])
})

it('metadata省略時はdefaultと推測せず数編集を止め、カード保存で既存選択を上書きしない', async () => {
  state.customized = undefined
  render(<StyleDashboard style="salon" />)
  const drawer = await open()
  await within(drawer).findByText(/数の表示設定を確認できない/)
  expect(within(drawer).queryByRole('switch', { name: '数の帯：呼び戻し待ち' })).toBeNull()
  expect(screen.getByText(/保存した表示設定を確認できないため/)).toBeTruthy()
  expect(labels()).toContain('呼び戻し待ち')
  fireEvent.click(within(drawer).getByRole('switch', { name: '分析', exact: true }))
  fireEvent.click(within(drawer).getByRole('button', { name: '保存する', exact: true }))
  await waitFor(() => expect(state.save).toHaveBeenCalledWith('a', 2, [{ ...cards[0] }, { ...cards[1] }, { id: 'analytics', visible: false }], undefined))
  expect(state.ids).toContain('paidAmount')
})

it('取消・破棄は0保存、409後も選択入力を保持する', async () => {
  render(<StyleDashboard style="salon" />)
  let drawer = await open()
  fireEvent.click(within(drawer).getByRole('switch', { name: '数の帯：呼び戻し待ち' }))
  fireEvent.click(within(drawer).getByRole('button', { name: 'キャンセル', exact: true }))
  fireEvent.click(await screen.findByRole('button', { name: '破棄する', exact: true }))
  expect(state.save).not.toHaveBeenCalled()
  drawer = await open()
  expect(within(drawer).getByRole('switch', { name: '数の帯：呼び戻し待ち' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(within(drawer).getByRole('switch', { name: '数の帯：呼び戻し待ち' }))
  state.error = { status: 409, code: 'version_conflict' }
  fireEvent.click(within(drawer).getByRole('button', { name: '保存する', exact: true }))
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1))
  await waitFor(() => expect((within(drawer).getByRole('button', { name: '保存する', exact: true }) as HTMLButtonElement).disabled).toBe(false))
  expect(within(drawer).getByRole('switch', { name: '数の帯：呼び戻し待ち' }).getAttribute('aria-checked')).toBe('false')
  expect(state.customized).toBe(false)
})

it('resetだけdefaultへ戻し、空のcustomを未選択へ読み替えない', async () => {
  state.customized = true; state.ids = []
  render(<StyleDashboard style="salon" />)
  await waitFor(() => expect(state.get).toHaveBeenCalled())
  await waitFor(() => expect(labels()).toEqual([]))
  const drawer = await open()
  fireEvent.click(within(drawer).getByRole('button', { name: '型に戻す', exact: true }))
  await waitFor(() => expect(state.reset).toHaveBeenCalledWith('a', 2))
  await waitFor(() => expect(labels()).toContain('呼び戻し待ち'))
  expect(labels()).toContain('無断キャンセル率')
  expect(state.customized).toBe(false)
  expect(state.save).not.toHaveBeenCalled()
})

it('アカウント切替後の遅いGETと保存応答を新しい選択へ適用しない', async () => {
  let finishGet!: (value: unknown) => void
  state.get.mockImplementationOnce(() => new Promise(resolve => { finishGet = resolve }))
  const view = render(<StyleDashboard style="salon" />)
  state.account = 'b'; view.rerender(<StyleDashboard style="salon" />)
  await waitFor(() => expect(state.get).toHaveBeenCalledWith('b'))
  await waitFor(() => expect(labels()).toContain('呼び戻し待ち'))
  await act(async () => finishGet({ data: { ...profile().data, metricsCustomized: true, metricIds: [] } }))
  await waitFor(() => expect(labels()).toContain('呼び戻し待ち'))
  const drawer = await open()
  fireEvent.click(within(drawer).getByRole('switch', { name: '数の帯：呼び戻し待ち' }))
  let finishSave!: (value: unknown) => void
  state.save.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve }))
  fireEvent.click(within(drawer).getByRole('button', { name: '保存する', exact: true }))
  await waitFor(() => expect(state.save).toHaveBeenCalled())
  state.account = 'c'; view.rerender(<StyleDashboard style="salon" />)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /表示を変える/ })).toBeNull())
  await act(async () => finishSave({ data: { ...profile().data, version: 9, metricsCustomized: true, metricIds: [] } }))
  await waitFor(() => expect(labels()).toContain('呼び戻し待ち'))
  expect(state.get).toHaveBeenCalledWith('c')
})

it('閲覧のみには表示設定の変更入口を出さず、保存もしない', async () => {
  state.role = 'viewer'; state.customized = true; state.ids = ['recall', 'bookings']
  render(<StyleDashboard style="salon" />)
  await waitFor(() => expect(labels()).toEqual(['呼び戻し待ち', '今日の予約']))
  expect(screen.queryByRole('button', { name: '表示を変える' })).toBeNull()
  expect(state.save).not.toHaveBeenCalled()
})

it('5超の既存customを切り捨てず共通の複数段へ復元する', async () => {
  state.customized = true; state.ids = ['bookings', 'attention', 'nextBookingRate', 'recall', 'noShowRate', 'visits']
  render(<StyleDashboard style="salon" />)
  await waitFor(() => expect(labels()).toEqual(['今日の予約', '対応待ち', '次回予約率', '呼び戻し待ち', '無断キャンセル率', '来店数']))
  const rows = document.querySelectorAll('[data-style-dashboard] > [data-kpi-strip]')
  expect(Array.from(rows).map(row => row.children.length)).toEqual([5, 1])
  expect(state.save).not.toHaveBeenCalled()
})

it('32項目の閲覧だけでも内容と順序を保ち、未取得を0にせず変更操作を出さない', async () => {
  state.role = 'viewer'; state.customized = true; state.ids = [...STYLE_METRIC_IDS]
  render(<StyleDashboard style="salon" />)
  await waitFor(() => expect(labels()).toHaveLength(32))
  const rows = document.querySelectorAll('[data-style-dashboard] > [data-kpi-strip]')
  expect(Array.from(rows).map(row => row.children.length)).toEqual([5, 5, 5, 5, 5, 5, 2])
  const pending = screen.getByRole('button', { name: '支払い待ちの説明' }).closest('[data-design-version]')!
  expect(within(pending as HTMLElement).getByText('—', { exact: true })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '表示を変える' })).toBeNull()
  expect(state.save).not.toHaveBeenCalled()
})

it('旧応答の非保存fallbackから明示した再読込で真のcustomへ戻る', async () => {
  state.customized = undefined
  render(<StyleDashboard style="salon" />)
  await screen.findByText(/保存した表示設定を確認できないため/)
  expect(labels()).toContain('呼び戻し待ち')
  state.customized = true; state.ids = ['visits', 'bookings']
  fireEvent.click(screen.getByRole('button', { name: '表示設定を読み直す' }))
  await waitFor(() => expect(labels()).toEqual(['来店数', '今日の予約']))
  expect(screen.queryByText(/保存した表示設定を確認できないため/)).toBeNull()
  expect(state.save).not.toHaveBeenCalled()
})
