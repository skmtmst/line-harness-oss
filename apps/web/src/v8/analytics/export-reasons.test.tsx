// @vitest-environment happy-dom
import React, { useLayoutEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { flushListUrlState } from '@/components/shared/list-url-state'
import type { ExportAction } from './parts'

const m = vi.hoisted(() => ({
  tab: 'friends', account: 'account-a', register: null as ((action: ExportAction | null) => void) | null,
  friends: vi.fn(), reactions: vi.fn(), routes: vi.fn(), usage: vi.fn(), urls: vi.fn(),
  saved: vi.fn(), snapshots: vi.fn(), fields: vi.fn(), funnels: vi.fn(), latest: vi.fn(),
  report: vi.fn(), exportReport: vi.fn(), runCross: vi.fn(), crossResult: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/analytics', useSearchParams: () => new URLSearchParams(`tab=${m.tab}`) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: m.account, loading: false, accounts: [] }) }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('./parts', async original => {
  const actual = await original<typeof import('./parts')>()
  return { ...actual, useRegisterExport: (...args: Parameters<typeof actual.useRegisterExport>) => {
    // Observe the real parent's callback; the real registration hook still runs unchanged.
    m.register = React.useContext(actual.AnalyticsExportContextV8)
    actual.useRegisterExport(...args)
  } }
})
vi.mock('@/lib/api/helpers/gap3', () => ({ customerSegmentsApi: { get: () => new Promise(() => {}) } }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    friendFields: { ...actual.api.friendFields, list: m.fields },
    featureSettings: { ...actual.api.featureSettings, visibility: async () => ({ success: true, data: { features: {} } }) },
    conversions: { ...actual.api.conversions, definitionReport: m.report, exportDefinitions: m.exportReport },
    analytics: { ...actual.api.analytics, friendsOverview: m.friends, reactionsOverview: m.reactions, routesOverview: m.routes,
      usageOverview: m.usage, urlClicksOverview: m.urls, runCross: m.runCross, crossResult: m.crossResult,
      saved: { ...actual.api.analytics.saved, list: m.saved, snapshots: m.snapshots },
      v6Funnels: { ...actual.api.analytics.v6Funnels, list: m.funnels, latestRun: m.latest },
      reportSchedules: { ...actual.api.analytics.reportSchedules, list: async () => ({ success: true, data: { items: [], recentOneTime: [] } }) },
    },
  } }
})
import AnalyticsV8 from './analytics'
import { ApiError } from '@/lib/api'

const metric = (value = 0) => ({ value, state: 'available', reason: null })
const metrics = (keys: string[]) => Object.fromEntries(keys.map(key => [key, metric()]))
const envelope = (data: object) => ({ success: true, data: { lineAccountId: 'account-a', timeZone: 'Asia/Tokyo', period: { from: '2026-10-01', to: '2026-10-31' }, dataCutoffAt: '2026-10-31T00:00:00Z', data } })
const friends = (state = 'available', stateReason: string | null = null) => envelope({ state, stateReason, metrics: metrics(['added', 'removed', 'net', 'currentFriends', 'firstTime', 'returning']), days: [], campaigns: [], historyAvailableFrom: null })
const routes = () => envelope({ routes: [], attributionModel: 'first_touch', attributionLabel: '初回', searchConsoleHref: 'https://example.test' })
const saved = () => ({ id: 'saved-1', name: '保存した分析A', kind: 'cross', createdByName: '担当者', currentVersionNumber: 1, updatedAt: '2026-10-01T00:00:00Z', latestSnapshot: null, snapshotCount: 0 })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const header = () => document.querySelector('[data-page-heading-actions]') as HTMLElement
const csvs = () => screen.getAllByRole('button', { name: 'CSVで書き出す' }) as HTMLButtonElement[]
const headerCsv = () => within(header()).getByRole('button', { name: 'CSVで書き出す' }) as HTMLButtonElement
function blocked(button: HTMLButtonElement, reason: string) {
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-description')).toBe(reason)
  expect(within(button.parentElement!).getAllByRole('status').filter(node => node.textContent === reason)).toHaveLength(1)
  fireEvent.click(button)
}
function enabled(button: HTMLButtonElement) {
  expect(button.disabled).toBe(false)
  expect(button.hasAttribute('aria-description')).toBe(false)
  expect(within(button.parentElement!).queryByRole('status')).toBeNull()
}
beforeEach(() => {
  m.tab = 'friends'; m.account = 'account-a'; m.register = null
  verifiedStaffRole('owner'); sessionStorage.clear(); flushListUrlState()
  window.history.replaceState(null, '', '/analytics'); window.dispatchEvent(new PopStateEvent('popstate'))
  for (const mock of [m.friends, m.reactions, m.routes, m.usage, m.urls, m.saved, m.snapshots, m.fields, m.funnels, m.latest, m.report, m.exportReport, m.runCross, m.crossResult]) mock.mockReset().mockImplementation(() => new Promise(() => {}))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { cleanup(); verifiedStaffRole(null); vi.restoreAllMocks() })

it.each([
  ['friends', '集計結果を読み込んでいます。'], ['reactions', '集計結果を読み込んでいます。'],
  ['routes', '集計結果を読み込んでいます。'], ['usage', '集計結果を読み込んでいます。'],
  ['url-clicks', '集計結果を読み込んでいます。'], ['saved', '保存した分析を読み込んでいます。'],
  ['cross', '友だち情報欄を読み込んでいます。'], ['funnel', 'ファネルを読み込んでいます。'],
  ['conversion-report', '成果レポートを読み込んでいます。'],
])('%s：本物の親と子で取得中の理由を登録し、書き出さない', (tab, reason) => {
  m.tab = tab; render(<AnalyticsV8 />)
  csvs().forEach(button => blocked(button, reason))
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(m.exportReport).not.toHaveBeenCalled()
})

it.each(['friends', 'reactions', 'routes', 'usage', 'url-clicks', 'saved', 'cross', 'funnel', 'conversion-report'])('%s：同じ無効状態のまま取得失敗へ理由を更新する', async tab => {
  const pending = deferred<never>()
  const request = ({ friends: m.friends, reactions: m.reactions, routes: m.routes, usage: m.usage, 'url-clicks': m.urls, saved: m.saved, cross: m.fields, funnel: m.funnels, 'conversion-report': m.report })[tab]!
  request.mockReturnValue(pending.promise); m.tab = tab; render(<AnalyticsV8 />)
  const initial = headerCsv().getAttribute('aria-description')
  await act(async () => { pending.reject(new Error('模擬の取得失敗')) })
  await waitFor(() => expect(headerCsv().getAttribute('aria-description')).not.toBe(initial))
  const expected = tab === 'saved' ? '模擬の取得失敗' : tab === 'cross' ? '友だち情報欄を読み込めませんでした'
    : tab === 'funnel' ? 'ファネルを読み込めませんでした' : tab === 'conversion-report' ? '成果レポートを読み込めませんでした'
      : tab === 'url-clicks' ? '集計結果を取得できず、CSVを書き出せません。' : '分析を表示できませんでした。時間をおいて、もう一度お試しください。'
  expect(headerCsv().getAttribute('aria-description')).toBe(expected)
  csvs().forEach(button => blocked(button, headerCsv().getAttribute('aria-description')!))
  expect(request).toHaveBeenCalledTimes(1); expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it.each(['pending', 'insufficient', 'unavailable', 'failed'])('友だち：%sの既存理由を出し、同じ可否でも新しい理由に替える', async state => {
  m.friends.mockResolvedValue(friends(state, '日別の結果を確認できません。'))
  const view = render(<AnalyticsV8 />)
  await waitFor(() => blocked(headerCsv(), '日別の結果を確認できません。'))
  // Exercise re-registration while disabled remains true, through the actual parent callback.
  act(() => m.register?.({ disabled: true, disabledReason: '集計の完了を待っています。', onClick: vi.fn() }))
  blocked(headerCsv(), '集計の完了を待っています。')
  view.unmount()
})

it.each(['available', 'partial'])('友だち：%sの日別0件は引き続き許可し、既存の列だけを書き出す', async state => {
  m.friends.mockResolvedValue(friends(state)); m.routes.mockResolvedValue(routes())
  render(<AnalyticsV8 />)
  await waitFor(() => enabled(headerCsv()))
  fireEvent.click(headerCsv())
  const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
  expect(await blob.text()).toBe('\uFEFF"日付","増えた","減った","差し引き"')
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
})

it.each([
  ['reactions', 'この期間に書き出せる配信はありません。'], ['routes', 'この期間に書き出せる経路はありません。'],
  ['usage', '書き出せる機能の集計はありません。'], ['url-clicks', 'この期間に書き出せるURLはありません。'],
  ['saved', '保存した分析はまだありません。'], ['funnel', 'ファネルを選んでください。'], ['cross', '集計してから書き出してください。'],
])('%s：取得成功の0件・未選択・未集計を失敗と呼ばない', async (tab, reason) => {
  m.tab = tab
  m.reactions.mockResolvedValue(envelope({ metrics: metrics(['sent', 'delivered', 'opened', 'lineClicked', 'trackedClicks', 'unavailableCampaigns']), campaigns: [], campaignsTruncation: { limit: 50, broadcast: false, scenario: false }, trackedClickHours: [], clickDefinition: '' }))
  m.routes.mockResolvedValue(routes())
  m.usage.mockResolvedValue(envelope({ state: 'available', stateReason: null, checkedAt: '2026-10-31', summary: metrics(['unusedItems', 'brokenReferences', 'automaticRuns', 'manualSends', 'estimatedHoursSaved']), categories: [], features: [] }))
  m.urls.mockResolvedValue(envelope({ state: 'available', stateReason: null, links: [], hasMore: false, clickRateDefinition: '' }))
  m.saved.mockResolvedValue({ success: true, data: [] }); m.funnels.mockResolvedValue({ success: true, data: [] }); m.fields.mockResolvedValue({ success: true, data: [] })
  render(<AnalyticsV8 />)
  await waitFor(() => blocked(headerCsv(), reason))
  csvs().forEach(button => blocked(button, reason))
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(m.runCross).not.toHaveBeenCalled()
})

it('保存した分析：一覧CSVは有効のまま、履歴CSVだけ取得中→失敗→空を区別する', async () => {
  m.tab = 'saved'; m.saved.mockResolvedValue({ success: true, data: [saved()] })
  const pending = deferred<never>(); m.snapshots.mockReturnValue(pending.promise)
  render(<AnalyticsV8 />)
  await waitFor(() => expect(csvs()).toHaveLength(2))
  await waitFor(() => enabled(headerCsv())); blocked(csvs()[1], '結果の履歴を読み込んでいます。')
  await act(async () => pending.reject(new Error('履歴の模擬失敗')))
  await waitFor(() => expect(csvs()[1].getAttribute('aria-description')).not.toBe('結果の履歴を読み込んでいます。'))
  enabled(headerCsv())
  m.snapshots.mockResolvedValue({ success: true, data: [] })
  fireEvent.click(screen.getByRole('button', { name: 'もう一度', exact: true }))
  await waitFor(() => blocked(csvs()[1], '保存された結果はありません。'))
  enabled(headerCsv()); expect(m.snapshots).toHaveBeenCalledTimes(2)
})

it('保存した分析：検索0件は未登録と区別し、検索を戻すと理由が消える', async () => {
  m.tab = 'saved'; m.saved.mockResolvedValue({ success: true, data: [saved()] }); m.snapshots.mockResolvedValue({ success: true, data: [] })
  render(<AnalyticsV8 />); await waitFor(() => enabled(headerCsv()))
  fireEvent.change(screen.getByRole('searchbox', { name: '分析名・作った人で探す' }), { target: { value: '該当なし' } })
  await waitFor(() => blocked(headerCsv(), '条件に合う分析がありません。'))
  fireEvent.change(screen.getByRole('searchbox', { name: '分析名・作った人で探す' }), { target: { value: '' } })
  await waitFor(() => enabled(headerCsv())); expect(m.saved).toHaveBeenCalledTimes(1)
})

it('成果：404の未集計と、成功0件・書き出し中を経路の状態から独立して示す', async () => {
  m.tab = 'conversion-report'; m.routes.mockResolvedValue(routes()); m.report.mockRejectedValue(new ApiError(404, 'Not found'))
  render(<AnalyticsV8 />)
  await waitFor(() => csvs().forEach(button => blocked(button, 'まだ集計していません。')))
  m.report.mockResolvedValue({ success: true, data: { daily: [], byDefinition: [], kpis: { netCount: 0, previousNetCount: 0 } } })
  fireEvent.click(screen.getByRole('button', { name: '集計する' }))
  await waitFor(() => csvs().forEach(enabled))
  const pending = deferred<Blob>(); m.exportReport.mockReturnValue(pending.promise)
  fireEvent.click(headerCsv())
  csvs().forEach(button => blocked(button, 'CSVを書き出しています。'))
  expect(m.exportReport).toHaveBeenCalledTimes(1)
  await act(async () => pending.resolve(new Blob(['fixture'])))
  await waitFor(() => csvs().forEach(enabled)); expect(m.report).toHaveBeenCalledTimes(2)
})

it('ファネル：選択済みで結果取得中と未集計を分ける', async () => {
  m.tab = 'funnel'; m.funnels.mockResolvedValue({ success: true, data: [{ id: 'f1', name: '模擬', status: 'active', steps: [] }] })
  const pending = deferred<never>(); m.latest.mockReturnValue(pending.promise)
  render(<AnalyticsV8 />)
  await waitFor(() => blocked(headerCsv(), '書き出す集計結果を確認しています。'))
  await act(async () => pending.reject(new ApiError(404, 'Not found')))
  await waitFor(() => blocked(headerCsv(), 'まだ集計していません。'))
  expect(m.latest).toHaveBeenCalledTimes(1)
})

it('未対応の見かたは現時点の事実を出す', () => {
  m.tab = 'segments'; render(<AnalyticsV8 />)
  blocked(headerCsv(), 'この見かたではCSVを書き出せません。')
})

it.each(['account', 'tab'])('%s切替の最初の描画と遅い旧登録に、前の理由を流用しない', async change => {
  m.friends.mockResolvedValue(friends('pending', '前の対象の理由'))
  let first = ''
  function Probe() { useLayoutEffect(() => { first = headerCsv().getAttribute('aria-description') ?? '' }); return <AnalyticsV8 /> }
  const view = render(<Probe />)
  await waitFor(() => blocked(headerCsv(), '前の対象の理由'))
  const oldRegister = m.register!
  if (change === 'account') { m.account = 'account-b'; m.friends.mockImplementation(() => new Promise(() => {})) }
  else m.tab = 'usage'
  view.rerender(<Probe />)
  expect(first).toBe('書き出す集計結果を確認しています。')
  expect(document.body.textContent).not.toContain('前の対象の理由')
  act(() => oldRegister({ disabled: true, disabledReason: '遅い旧対象の理由', onClick: vi.fn() }))
  blocked(headerCsv(), '書き出す集計結果を確認しています。')
  expect(document.body.textContent).not.toContain('遅い旧対象の理由')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})


it('URL：検索0件を通常0件と区別し、本文と上部へ同じ理由を出す', async () => {
  m.tab = 'url-clicks'
  m.urls.mockResolvedValue(envelope({ state: 'available', stateReason: null, links: [], hasMore: false, clickRateDefinition: '' }))
  render(<AnalyticsV8 />)
  await waitFor(() => blocked(headerCsv(), 'この期間に書き出せるURLはありません。'))
  fireEvent.change(screen.getByRole('searchbox', { name: 'URL・配信名・リンク名で探す' }), { target: { value: '見つからないURL' } })
  await waitFor(() => csvs().forEach(button => blocked(button, '条件に合うURLがありません。')))
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it.each(['pending', 'running'])('クロス：既存の%s結果待ちを示し、自動確認の要求を増やさない', async state => {
  m.tab = 'cross'; m.fields.mockResolvedValue({ success: true, data: [] })
  m.runCross.mockResolvedValue({ success: true, data: { id: 'run-1', state } })
  m.crossResult.mockResolvedValue({ success: true, data: { id: 'run-1', state, result: null } })
  render(<AnalyticsV8 />)
  await waitFor(() => blocked(headerCsv(), '集計してから書き出してください。'))
  fireEvent.click(screen.getByRole('button', { name: '集計する', exact: true }))
  await waitFor(() => blocked(headerCsv(), state === 'running' ? '集計しています。' : '集計の完了を待っています。'))
  await waitFor(() => expect(m.crossResult).toHaveBeenCalledTimes(1))
  expect(m.runCross).toHaveBeenCalledTimes(1); expect(URL.createObjectURL).not.toHaveBeenCalled()
})


it('ファネル：取得成功しても段の結果が無い場合は取得中と呼ばない', async () => {
  m.tab = 'funnel'; m.funnels.mockResolvedValue({ success: true, data: [{ id: 'f1', name: '模擬', status: 'active', steps: [] }] })
  m.latest.mockResolvedValue({ success: true, data: { groups: [], state: 'available', dataCutoffAt: '2026-10-31' } })
  render(<AnalyticsV8 />)
  await waitFor(() => blocked(headerCsv(), '書き出せる段の集計結果がありません。'))
  expect(m.latest).toHaveBeenCalledTimes(1); expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('上部のCSVは文字ボタンのまま、レポートの主操作より前に並ぶ', () => {
  render(<AnalyticsV8 />)
  const csv = headerCsv()
  const report = within(header()).getByRole('link', { name: 'レポートを作る' })
  expect(csv.getAttribute('data-variant')).toBe('text')
  expect(report.getAttribute('data-variant')).toBe('primary')
  expect(csv.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
