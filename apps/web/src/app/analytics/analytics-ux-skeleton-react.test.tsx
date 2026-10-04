// @vitest-environment happy-dom
/*
 * 分析 V8 の骨組み（サクサク感 A）と書き出し中の表示（サクサク感 B）。
 * 読み始め0.3秒は場所だけ取り、超えたら数の帯・グラフ・表の骨組みを出す。
 * 「読み込み中」の文言は出さない（読み上げ用の aria-label は残す）。
 */
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  definitionReport: vi.fn(),
  exportDefinitions: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    conversions: {
      definitionReport: apiMock.definitionReport,
      exportDefinitions: apiMock.exportDefinitions,
    },
  },
}))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

import ConversionReportV8 from './conversion-report-v8'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

const REPORT = {
  kpis: { netCount: 5, netValue: 50000, previousNetCount: 3, averageNetValue: 10000 },
  previousRange: { from: '2026-08-01', to: '2026-08-30' },
  range: { from: '2026-09-01', to: '2026-09-30' },
  byDefinition: [
    { conversionPointId: 'p1', conversionPointName: '購入', netCount: 5, previousNetCount: 3, countChange: 2, routes: [{ label: '配信→購入' }] },
  ],
  daily: [{ day: '2026-09-01', netCount: 5 }],
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('成果レポートV8の骨組み', () => {
  it('0.3秒を超えたら帯・グラフ・表の骨組みを出す', async () => {
    apiMock.definitionReport.mockReturnValue(new Promise(() => {}))
    render(<ConversionReportV8 accountId="acc-1" />)
    await flush()
    /* 読み始め直後は骨組みを出さない（場所だけ取る）。 */
    expect(document.querySelector('[data-skeleton]')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(350) })
    const busy = document.querySelector('[aria-busy="true"]')
    expect(busy?.getAttribute('aria-label')).toContain('成果レポートを読み込んでいます')
    const table = busy?.querySelector('table')
    expect(table?.querySelectorAll('thead th').length).toBe(6)
    expect(table?.querySelectorAll('tbody tr').length).toBe(5)
    expect(busy?.querySelector('[data-skeleton]'), '骨組みがある').toBeTruthy()
    expect(document.body.textContent).not.toContain('読み込み中')
  })

  it('書き出し中はボタンの内側だけで分かる', async () => {
    apiMock.definitionReport.mockResolvedValue({ success: true, data: REPORT })
    apiMock.exportDefinitions.mockReturnValue(new Promise(() => {}))
    render(<ConversionReportV8 accountId="acc-1" />)
    for (let i = 0; i < 10; i += 1) await flush()
    expect(screen.getByText('購入'), '表が出る').toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'CSVで書き出す' }))
    await flush()
    expect(screen.getByRole('button', { name: /書き出し中/ }), '書き出し中がボタンの内側に出る').toBeTruthy()
  })
})
