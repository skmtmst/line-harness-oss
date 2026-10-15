// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushListUrlState } from '@/components/shared/list-url-state'
import { AffiliateShell, type AffiliateTabKey } from './frame'
import OffersTab from './offers'
import ApprovalsTab from './approvals'
import ReportTab from './report'

const data = vi.hoisted(() => ({ size: 1, exportCsv: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/affiliates',
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', loading: false }) }))
vi.mock('./display', async original => ({ ...await original<typeof import('./display')>(), downloadCsv: data.exportCsv }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  const people = () => Array.from({ length: data.size }, (_, i) => ({ id: `af-${i}`, name: `紹介者${i + 1}`, referralCode: `code-${i}` }))
  return { ...actual, api: { ...actual.api,
    folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
    affiliateOffers: { ...actual.api.affiliateOffers, list: async () => ({ success: true, data: [{ id: 'of-1', name: '案件A', isActive: true, rewardAmount: 100, rewardMiles: 0, createdAt: '2026-10-01T00:00:00Z' }] }) },
    affiliates: { ...actual.api.affiliates, list: async () => ({ success: true, data: people() }), allReport: async () => ({ success: true, data: [] }) },
    conversionApprovals: { ...actual.api.conversionApprovals, holdDays: async () => ({ success: true, data: { holdDays: 7 } }), list: async (params: { status?: string }) => ({ success: true, data: params.status === 'approved' ? people().map((p, i) => ({ eventId: `e-${i}`, affiliateId: p.id, affiliateName: p.name, friendName: p.name, lineAccountId: 'account-a', offerId: 'of-1', offerName: '案件A', approvalStatus: 'approved', value: 100, rewardAmount: 10, createdAt: '2026-10-01T00:00:00Z' })) : params.status === 'pending' ? [{ eventId: 'pending-1', friendName: '成果A', lineAccountId: 'account-a', approvalStatus: 'pending', createdAt: '2026-10-01T00:00:00Z' }] : [] }) },
    lineAccounts: { ...actual.api.lineAccounts, list: async () => ({ success: true, data: [] }) },
    tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) },
    scenarios: { ...actual.api.scenarios, list: async () => ({ success: true, data: [] }) },
  } }
})
const setCount = () => {}
function draw(tab: AffiliateTabKey, query = '') {
  window.history.replaceState(null, '', `/affiliates?tab=${tab}${query}`)
  return render(<AffiliateShell.Provider value={{ tab, readonly: false, narrow: false, accountId: 'account-a', counts: {}, setCount, focusAffiliateId: null }}>
    {tab === 'offers' ? <OffersTab /> : tab === 'approvals' ? <ApprovalsTab /> : <ReportTab />}
  </AffiliateShell.Provider>)
}
beforeEach(() => {
  flushListUrlState(); window.localStorage.clear(); data.size = 1; data.exportCsv.mockClear()
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T00:00:00Z'))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('成果一覧の接続', () => {
  it.each(['offers', 'approvals', 'report'] as const)('%sは1ページでも件数と前後のページ送りがある', async tab => {
    draw(tab)
    const pager = await screen.findByRole('navigation', { name: 'ページ送り' })
    expect(pager.querySelector('[data-pagination-summary]')?.textContent).toBe('1件中 1〜1件')
    expect(within(pager).getByRole('button', { name: '前のページ' }).hasAttribute('disabled')).toBe(true)
    expect(within(pager).getByRole('button', { name: '次のページ' }).hasAttribute('disabled')).toBe(true)
  })
  it.each(['offers', 'approvals', 'report'] as const)('%sの常設説明は題から開閉できる', async tab => {
    draw(tab)
    const toggle = await screen.findByRole('button', { name: 'この画面の説明' })
    const id = toggle.getAttribute('aria-controls')!
    const body = document.getElementById(id)!
    expect(body.textContent?.length).toBeGreaterThan(20)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'))
    expect(body.hidden).toBe(true)
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'))
    expect(body.hidden).toBe(false)
  })
  it('レポートへ直接戻った時はURLのページを保つ', async () => {
    data.size = 21
    const { container } = draw('report', '&page=2')
    const pager = await screen.findByRole('navigation', { name: 'ページ送り' })
    await waitFor(() => expect(pager.querySelector('[data-pagination-summary]')?.textContent).toBe('21件中 21〜21件'))
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(container.querySelector('tbody')?.textContent).toContain('紹介者21')
  })
  it('レポートの後ろの行へ移り、CSVは現在の検索に合う全件を保つ', async () => {
    data.size = 21
    const { container } = draw('report')
    const pager = await screen.findByRole('navigation', { name: 'ページ送り' })
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(20))
    fireEvent.click(within(pager).getByRole('button', { name: '次のページ' }))
    await waitFor(() => expect(pager.querySelector('[data-pagination-summary]')?.textContent).toBe('21件中 21〜21件'))
    expect(container.querySelector('tbody')?.textContent).toContain('紹介者21')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'CSVで書き出す' }))
    expect(data.exportCsv.mock.calls.at(-1)?.[1]).toHaveLength(22)
    fireEvent.change(screen.getByPlaceholderText('名前で探す'), { target: { value: '紹介者21' } })
    await waitFor(() => expect(pager.querySelector('[data-pagination-summary]')?.textContent).toBe('1件中 1〜1件'))
    await waitFor(() => expect(window.location.search).not.toContain('page=2'))
    fireEvent.click(screen.getByRole('button', { name: 'CSVで書き出す' }))
    expect(data.exportCsv.mock.calls.at(-1)?.[1]).toHaveLength(2)
  })
})
