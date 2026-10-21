// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import UrlClicksV8 from './url-clicks'
import { flushListUrlState } from '@/components/shared/list-url-state'

const net = vi.hoisted(() => ({ overview: vi.fn() }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, analytics: { ...actual.api.analytics, urlClicksOverview: net.overview } } }
})
const metric = (value: number) => ({ value, state: 'available', reason: null })
const link = (name: string, isActive: boolean) => ({ trackedLinkId: name, name, originalUrl: `https://example.test/${name}`, isActive, clicks: metric(3), knownClickPeople: metric(2), deliveredPeople: metric(20), clickRate: metric(10), usageLocations: ['一斉配信'] })
beforeEach(() => {
  flushListUrlState()
  window.history.replaceState(null, '', '/')
  window.dispatchEvent(new PopStateEvent('popstate'))
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T03:00:00Z'))
  net.overview.mockReset().mockResolvedValue({ success: true, data: { period: { from: '2026-09-22', to: '2026-10-21' }, dataCutoffAt: null, data: { stateReason: null, hasMore: false, clickRateDefinition: '中継URL', links: [link('リンクA', true), link('リンクB', false)] } } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); window.history.replaceState(null, '', '/') })

it('共通ツールバーで検索・状態・指定期間を維持し、同じ対象をCSVへ出す', async () => {
  let csv: Blob | undefined
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { csv = blob as Blob; return 'blob:csv' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const view = render(<UrlClicksV8 accountId="account-1" />)
  await screen.findByText('リンクA')
  expect(view.container.querySelector('[data-toolbar-search] #url-click-search')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'CSVで書き出す' }).closest('[data-toolbar-end]')).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox', { name: 'URL・配信名・リンク名で探す' }), { target: { value: 'リンク' } })
  await waitFor(() => expect(net.overview).toHaveBeenLastCalledWith('account-1', expect.objectContaining({ query: 'リンク' })))
  fireEvent.click(screen.getByRole('button', { name: 'URLの状態' }))
  fireEvent.click(within(screen.getByRole('option', { name: '計測中' })).getByRole('button'))
  expect(screen.getByRole('button', { name: 'URLの状態' }).textContent).toContain('計測中')
  fireEvent.click(screen.getByRole('button', { name: '過去7日' }))
  fireEvent.click(screen.getByRole('button', { name: '期間を指定' }))
  fireEvent.click(screen.getByRole('button', { name: '期間の始まり' }))
  fireEvent.click(screen.getByRole('button', { name: /2026年10月14日/ }))
  fireEvent.click(screen.getByRole('button', { name: '期間の終わり' }))
  fireEvent.click(screen.getByRole('button', { name: /2026年10月15日/ }))
  await waitFor(() => expect(net.overview).toHaveBeenLastCalledWith('account-1', expect.objectContaining({ from: '2026-10-14', to: '2026-10-15', query: 'リンク', limit: 200 })))
  await screen.findByText('リンクA')
  expect(screen.queryByText('リンクB')).toBeNull()
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('リンク')
  expect(screen.getByRole('button', { name: '期間を指定' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'CSVで書き出す' }))
  const body = await csv!.text()
  expect(body).toContain('リンクA')
  expect(body).not.toContain('リンクB')
})

it('未取得と取得失敗のときはCSVを実行できず、期間の入口は残る', async () => {
  net.overview.mockResolvedValue({ success: false, error: '読取失敗' })
  render(<UrlClicksV8 accountId="account-1" />)
  expect(screen.getByRole('button', { name: 'CSVで書き出す' }).hasAttribute('disabled')).toBe(true)
  await screen.findByText('読取失敗')
  expect(screen.getByRole('button', { name: 'CSVで書き出す' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: '期間を指定' })).toBeTruthy()
})
