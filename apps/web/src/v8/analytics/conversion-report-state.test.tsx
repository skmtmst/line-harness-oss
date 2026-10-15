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
beforeEach(() => m.report.mockReset())
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
})
