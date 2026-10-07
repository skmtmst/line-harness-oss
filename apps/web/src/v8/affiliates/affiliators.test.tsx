// @vitest-environment happy-dom
/*
 * V8 成果とアフィリエイト「アフィリエイター」（src/v8）の動きの試験。BEHAVIOR.md の主要な動きを守る。
 * 行が成果の多い順に並ぶ・閲覧のみでは作る／選ぶ／編集を出さない（帯は出す）・行の「…」に変える操作が出る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const role = vi.hoisted(() => ({ manage: true }))
const affiliatesList = vi.hoisted(() => vi.fn())
const allReport = vi.hoisted(() => vi.fn())
const settlementPreview = vi.hoisted(() => vi.fn())
const approvalsList = vi.hoisted(() => vi.fn())
const offersList = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      affiliates: { ...actual.api.affiliates, list: affiliatesList, allReport, settlementPreview },
      affiliateOffers: { ...actual.api.affiliateOffers, list: offersList },
      conversionApprovals: { ...actual.api.conversionApprovals, list: approvalsList },
      accountSettings: { ...actual.api.accountSettings, getLinkBaseUrl: async () => ({ success: true, data: null }) },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => (role.manage ? 'owner' : 'staff'), canManageRole: () => role.manage }
})

import AffiliatesV8 from './affiliates'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const affiliates = [
  { id: 'af-1', name: '少ない人', code: 'few', commissionRate: 0, isActive: true, createdAt: '2026-09-01T00:00:00Z', friendId: null },
  { id: 'af-2', name: '多い人', code: 'many', commissionRate: 10, isActive: true, createdAt: '2026-08-01T00:00:00Z', friendId: null },
]
const report = [
  { affiliateId: 'af-1', totalClicks: 1, totalConversions: 2, totalRevenue: 0, confirmedReward: 3000, linkCount: 1, friendAdds: 4 },
  { affiliateId: 'af-2', totalClicks: 1, totalConversions: 9, totalRevenue: 100000, confirmedReward: 0, linkCount: 2, friendAdds: 8 },
]

async function render() {
  await act(async () => { root.render(React.createElement(AffiliatesV8)) })
  for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

beforeEach(() => {
  role.manage = true
  affiliatesList.mockResolvedValue({ success: true, data: affiliates })
  allReport.mockResolvedValue({ success: true, data: report })
  settlementPreview.mockResolvedValue({ success: true, data: { totalAmount: 13000, conversionCount: 11, affiliates: [], periodFrom: '', periodTo: '' } })
  approvalsList.mockResolvedValue({ success: true, data: [] })
  offersList.mockResolvedValue({ success: true, data: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('V8 アフィリエイター', () => {
  it('成果が多い順に並べ、作るボタンと選ぶチェックを出す', async () => {
    await render()
    const names = [...host.querySelectorAll('tbody tr')].map((row) => row.querySelector('button')?.textContent)
    expect(names).toEqual(['多い人', '少ない人'])
    expect(host.textContent).toContain('アフィリエイターを作る')
    expect(host.querySelector('[aria-label="多い人を選ぶ"]')).not.toBeNull()
    expect(host.textContent).not.toContain('閲覧のみで見ています')
  })

  it('閲覧のみでは作る・選ぶを出さず、帯を出す。「…」には変える操作を出さない', async () => {
    role.manage = false
    await render()
    expect(host.textContent).toContain('閲覧のみで見ています')
    expect(host.textContent).not.toContain('アフィリエイターを作る')
    expect(host.querySelector('[aria-label="多い人を選ぶ"]')).toBeNull()
    const menu = host.querySelector('[aria-label="多い人の操作"]') as HTMLButtonElement
    await act(async () => { fireEvent.click(menu) })
    expect(document.body.textContent).toContain('紹介リンクをコピー')
    expect(document.body.textContent).not.toContain('紹介を止める')
  })
})
