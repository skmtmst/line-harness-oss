// @vitest-environment happy-dom
import React from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AffiliateDrawer from '@/v8/affiliates/drawer'
import { asReportV2, type ReportV2 } from '@/v8/affiliates/display'

const fixture = vi.hoisted(() => ({ report: vi.fn(), links: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: fixture.replace, push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ children, prefetch: _prefetch, ...props }: React.ComponentProps<'a'> & { prefetch?: boolean }) => React.createElement('a', props, children),
}))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    affiliates: { ...actual.api.affiliates,
      reportV2: fixture.report, links: fixture.links,
      journeys: async () => ({ success: true, data: [], nextCursor: null }),
      settlementPreview: async () => ({ success: true, data: { affiliates: [] } }),
    },
    conversionApprovals: { ...actual.api.conversionApprovals, list: async () => ({ success: true, data: [] }) },
  } }
})

const validReport: ReportV2 = {
  affiliateId: 'affiliate', affiliateName: '紹介者', code: 'code', commissionRate: 10,
  clicks: 2, linkClicks: 2, friendAdds: 1, conversions: 1, conversionsApproved: 1,
  conversionsPending: 0, conversionsRejected: 0, confirmedReward: 100, revenue: 1000,
  byOffer: [], conversionsByPoint: [], duplicateFlags: [],
}
const affiliate = {
  id: 'affiliate', name: '紹介者', code: 'code', commissionRate: 10, isActive: true,
  createdAt: '2026-10-01T00:00:00Z', friendId: null,
  totalClicks: 2, totalConversions: 1, totalRevenue: 1000, rewardAmount: 100, linkCount: 1, friendAdds: 1,
}
const invalidReports: Array<[string, unknown]> = [
  ['null', null], ['配列', []],
  ['数値欠落', { ...validReport, clicks: undefined }],
  ['数値がnull', { ...validReport, conversions: null }],
  ['非有限数', { ...validReport, confirmedReward: Infinity }],
  ['NaN', { ...validReport, friendAdds: NaN }],
  ['案件の配列欠落', { ...validReport, byOffer: undefined }],
  ['成果地点の配列欠落', { ...validReport, conversionsByPoint: null }],
]
function draw() {
  return render(React.createElement(AffiliateDrawer, {
    affiliate, accountId: 'account', readonly: true, startInEdit: false, linkBaseUrl: null,
    onClose: vi.fn(), onChanged: vi.fn(), onStopRequest: vi.fn(),
  }))
}
beforeEach(() => {
  window.history.replaceState(null, '', '/affiliates')
  fixture.report.mockReset()
  fixture.links.mockReset().mockResolvedValue({ success: true, data: [] })
  fixture.replace.mockClear()
})
afterEach(cleanup)

describe('紹介者の内訳は、集計が読めないときに落ちない', () => {
  it.each(invalidReports)('%sの応答を0件として描かず、記録を残す案内を出す', async (_label, raw) => {
    expect(asReportV2(raw)).toBeNull()
    fixture.report.mockResolvedValue({ success: true, data: raw })
    draw()
    fireEvent.click(await screen.findByRole('tab', { name: '内訳' }))
    await screen.findByText('この期間の集計を読み込めませんでした')
    expect(screen.getByText(/リンクと成果の記録は消えていません/)).toBeTruthy()
    expect(screen.queryByText('今月は案件ごとの成果がありません。')).toBeNull()
    expect(fixture.report).toHaveBeenCalledWith('affiliate', expect.any(Object))
  })

  it('不正な集計の後に読み直すと、正しい集計へ復帰する', async () => {
    fixture.report.mockResolvedValueOnce({ success: true, data: null })
      .mockResolvedValueOnce({ success: true, data: validReport })
    draw()
    fireEvent.click(await screen.findByRole('tab', { name: '内訳' }))
    await screen.findByText('この期間の集計を読み込めませんでした')
    fireEvent.click(screen.getByRole('button', { name: /もう一度/ }))
    await screen.findByText('今月は案件ごとの成果がありません。')
    await waitFor(() => expect(fixture.report).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('この期間の集計を読み込めませんでした')).toBeNull()
    expect(screen.getByText('クリック 2・友だち追加 1・認めなかった 0')).toBeTruthy()
  })

  it('集計の型を検査なしで偽装しない', () => {
    const source = ['drawer.tsx', 'display.ts'].map(name =>
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../v8/affiliates', name), 'utf8')).join('\n')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(source).not.toContain('as unknown as ReportV2')
  })
})
