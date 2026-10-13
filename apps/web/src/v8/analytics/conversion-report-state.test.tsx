// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ report: vi.fn(), range: { from: '2026-10-01', to: '2026-10-12' } }))
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), api: { conversions: { definitionReport: m.report } } }))
vi.mock('@/components/shared/period-picker', () => ({ useReportPeriod: () => ({ days: 30, range: m.range, setDays: vi.fn(), setRange: vi.fn(), customRange: null }) }))
vi.mock('./routes', () => ({ RoutesFrame: ({ children }: {children: () => React.ReactNode}) => <div>{children()}</div> }))
import ConversionReport from './conversion-report'
import { ApiError } from '@/lib/api'
beforeEach(() => m.report.mockReset())
afterEach(cleanup)
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
