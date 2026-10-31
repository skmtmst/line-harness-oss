// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ report: vi.fn(), range: { from: '2026-10-01', to: '2026-10-12' } }))
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), api: { conversions: { definitionReport: m.report } } }))
vi.mock('@/components/shared/period-picker', () => ({ useReportPeriod: () => ({ days: 30, range: m.range, setDays: vi.fn(), setRange: vi.fn(), customRange: null }) }))
vi.mock('./routes', () => ({ RoutesFrame: ({ children }: {children: () => React.ReactNode}) => <div>{children()}</div> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
import ConversionReport from './conversion-report'
import { ApiError } from '@/lib/api'
beforeEach(() => { m.report.mockReset(); m.range = { from: '2026-10-01', to: '2026-10-12' } })
afterEach(cleanup)
it('成果地点の操作は共通の印ボタンから開き、日ごとの表へ絞り込める', async () => {
  m.report.mockResolvedValue({ success: true, data: { daily: [], kpis: { netCount: 4, previousNetCount: 2 }, byDefinition: [
    { conversionPointId: 'cp-1', conversionPointName: '申込', netCount: 4, previousNetCount: 2, countChange: 2, routes: [] },
  ] } })
  const { container } = render(<ConversionReport accountId="a" />)
  const menu = await screen.findByRole('button', { name: '成果地点「申込」の操作' })
  expect(menu.getAttribute('data-design-node')).toBe('H0V8EK')
  expect(menu.className).not.toContain('rowMenuButton')
  fireEvent.click(menu)
  fireEvent.click(screen.getByRole('menuitem', { name: '日ごとの表を見る' }))
  expect(screen.getByText('日ごとの成果（申込）')).toBeTruthy()
  expect(container.querySelector('[role="menu"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'すべてに戻す' }))
  expect(screen.getByText('日ごとの成果（成果地点すべて）')).toBeTruthy()
  expect(screen.getByText('この期間 4 件・前の期間 2 件')).toBeTruthy()
})
it('E2：404は未集計、500は失敗。再試行の連打で要求を増やさない', async () => {
  m.report.mockRejectedValueOnce(new ApiError(404, 'Not found'))
  const { container } = render(<ConversionReport accountId="a" />)
  await waitFor(() => expect(container.querySelector('[data-aggregation-state=empty]')).toBeTruthy())
  expect(screen.queryByText('成果レポートを読み込めませんでした')).toBeNull()
  let reject!: (error: unknown) => void
  m.report.mockImplementationOnce(() => new Promise((_resolve, r) => { reject = r }))
  const retry = screen.getByRole('button', { name: '集計する' })
  fireEvent.click(retry); fireEvent.click(retry)
  await waitFor(() => expect(m.report).toHaveBeenCalledTimes(2))
  expect(container.querySelector('[data-aggregation-state=running]')?.textContent).toContain('始めた時刻')
  expect(screen.queryByRole('button', { name: '集計する' })).toBeNull()
  reject(new ApiError(500, 'fixture'))
  await waitFor(() => expect(container.querySelector('[data-aggregation-state=failed]')?.textContent).toContain('成果レポートを読み込めませんでした'))
  expect(screen.getAllByText('成果レポートを読み込めませんでした')).toHaveLength(1)
  expect(container.querySelectorAll('[data-list-state="error"]')).toHaveLength(0)
  expect(screen.getAllByRole('button', { name: 'もう一度', exact: true })).toHaveLength(1)
})

it('選んだ期間と異なる応答をグラフとして出さない', async () => {
  m.report.mockResolvedValue({ success: true, data: { range: { from: '2026-09-01', to: '2026-09-30' }, daily: [{ day: '2026-09-20', netCount: 5 }], byDefinition: [], kpis: {} } })
  const { container } = render(<ConversionReport accountId="a" />)
  await waitFor(() => expect(container.querySelector('[data-aggregation-state=failed]')).toBeTruthy())
  expect(screen.queryByText('日ごとの成果（成果地点すべて）')).toBeNull()
})

it('取得できた時刻を表示し、成功した集計を未取得とは呼ばない', async () => {
  m.report.mockResolvedValue({ success: true, data: { range: m.range, daily: [], byDefinition: [], kpis: { netCount: 0, previousNetCount: 0 } } })
  const { container } = render(<ConversionReport accountId="a" />)
  await waitFor(() => expect(container.querySelector('[data-aggregation-state=complete]')).toBeTruthy())
  expect(container.querySelector('[data-aggregation-state=complete]')?.textContent).not.toContain('未取得')
})

it('期間を替えた最初の描画から、前の期間のグラフを隠す', async () => {
  m.report.mockResolvedValue({ success: true, data: { range: m.range, daily: [], byDefinition: [], kpis: { netCount: 9, previousNetCount: 0 } } })
  let observed = ''
  function Probe() {
    React.useLayoutEffect(() => { observed = document.body.textContent ?? '' })
    return <ConversionReport accountId="a" />
  }
  const view = render(<Probe />)
  await screen.findByText('日ごとの成果（成果地点すべて）')
  m.report.mockImplementation(() => new Promise(() => {}))
  m.range = { from: '2026-10-13', to: '2026-10-14' }
  view.rerender(<Probe />)
  expect(observed).not.toContain('日ごとの成果（成果地点すべて）')
})

it('日本時間の日時で返った期間は、同じ暦日なら正しい応答として出す', async () => {
  m.report.mockResolvedValue({ success: true, data: { range: { from: '2026-10-01 00:00:00', to: '2026-10-12 23:59:59' }, daily: [{ day: '2026-10-12', conversionPointId: 'cp', netCount: 1 }], byDefinition: [], kpis: { netCount: 1, previousNetCount: 0 } } })
  const { container } = render(<ConversionReport accountId="a" />)
  await waitFor(() => expect(container.querySelector('[data-aggregation-state=complete]')).toBeTruthy())
  expect(screen.getByText('日ごとの成果（成果地点すべて）')).toBeTruthy()
  expect(screen.getByText('この期間 1 件・前の期間 0 件')).toBeTruthy()
})
