// @vitest-environment happy-dom
/*
 * ★V8-B w1W8h 会員のつき合わせ：候補の行・候補なしの行・決める窓・集計だけの失敗。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  operations: vi.fn(), overview: vi.fn(), select: vi.fn(), openDialog: vi.fn(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('next/navigation', () => ({ usePathname: () => '/ec-commerce/identity-candidates', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, api: { ecCommerce: { operationIdentityCandidates: fixture.operations, overview: fixture.overview } } }
})
const subject = (label: string, detail: string | null) => ({ kind: 'ec_event', id: label, label, detail, lineAccountId: null, lineAccountName: null, shopKey: null, attributes: [] })
const items = [
  { id: 'c-1', kind: 'ec_member', status: 'pending', version: 1, confidence: { score: 94, label: 'high' }, left: subject('高橋 直人', 'EC-10422'), right: subject('高橋 なおと', '友だち追加 9/12'), evidenceSummary: ['姓', '郵便番号'], detectedAt: '2026-10-01T00:00:00Z', reviewedAt: null },
  { id: 'c-2', kind: 'ec_member', status: 'pending', version: 1, confidence: { score: 0, label: 'low' }, left: subject('中村 彩', 'EC-10377'), right: subject('', null), evidenceSummary: [], detectedAt: '2026-10-01T00:00:00Z', reviewedAt: null },
]
vi.mock('@/components/identity/identity-review', () => ({
  useIdentityReview: () => ({ state: 'ready', items, detail: null, failure: null, decideError: '', deciding: false, loadingMore: false, hasMore: false, selectedId: null, dialogOpen: false, select: fixture.select, openDialog: fixture.openDialog, closeDialog: vi.fn(), reload: vi.fn(), loadMore: vi.fn(), decide: vi.fn() }),
}))
import EcIdentityCandidatesScreen from './identity'

beforeEach(() => {
  fixture.overview.mockResolvedValue({ success: true, data: { total: 0 } })
  fixture.operations.mockResolvedValue({ success: true, data: { items: [{ id: 'c-1', impact: [{ key: 'orders', value: 3, unit: '件' }] }], summary: { unmatched: 24, candidates: 6, candidateExternalCustomers: 6, withoutCandidates: 18, duplicateSuspicions: 2, linked: 1128, potentialRevenue: 84300 } } })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('候補の行は「候補を見る」「決める」、候補なしの行は「友だちを探す」', async () => {
  render(<EcIdentityCandidatesScreen />)
  const table = await screen.findByRole('table', { name: '会員のつき合わせの候補' })
  const rows = within(table).getAllByRole('row')
  fireEvent.click(within(rows[1]).getByRole('button', { name: '候補を見る' }))
  expect(fixture.select).toHaveBeenCalledWith('c-1')
  fireEvent.click(within(rows[1]).getByRole('button', { name: '決める' }))
  expect(fixture.openDialog).toHaveBeenCalledWith('c-1')
  expect(within(rows[2]).getByRole('link', { name: '友だちを探す' }).getAttribute('href')).toBe('/friends?q=%E4%B8%AD%E6%9D%91%20%E5%BD%A9')
  expect(within(rows[2]).queryByRole('button', { name: '決める' })).toBeNull()
  await waitFor(() => expect(within(rows[1]).getByText(/EC-10422・注文 3/)).toBeTruthy())
})

it('集計だけが読めないときも候補の表は残し、数は 0 と書かない', async () => {
  fixture.operations.mockRejectedValue(new Error('down'))
  render(<EcIdentityCandidatesScreen />)
  expect(await screen.findByRole('table', { name: '会員のつき合わせの候補' })).toBeTruthy()
  await waitFor(() => expect(screen.getAllByText('読み込めませんでした').length).toBeGreaterThan(0))
  // 表の候補なしの行と、表の下の件数（読めていないので —）の2つ
  expect(screen.getAllByText('結びついていない —')).toHaveLength(2)
})
