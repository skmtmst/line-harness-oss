// @vitest-environment happy-dom
/*
 * 監査 WEB207/210：案件の決まり（数える期間・上限・受付の期間）。
 * - 207：読み込みが失敗したら黙らず、読めるまで決まりの欄を触らせない
 * - 210：複製は決まりも写す（読めなければ複製しない）
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

const net = vi.hoisted(() => ({ capStatus: vi.fn(), create: vi.fn(), approvalsFull: false }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      affiliateOffers: {
        ...actual.api.affiliateOffers,
        capStatus: (...args: unknown[]) => net.capStatus(...args),
        create: (...args: unknown[]) => net.create(...args),
        list: async () => ({ success: true, data: [{ id: 'of-1', name: '紹介A', description: null, rewardAmount: 1000, rewardMiles: 0, lineAccountId: null, tagId: null, scenarioId: null, isActive: true, createdAt: '2026-10-01T00:00:00Z' }] }),
      },
      affiliates: { ...actual.api.affiliates, allReport: async () => ({ success: true, data: [] }) },
      conversionApprovals: {
        ...actual.api.conversionApprovals,
        list: async () => ({
          success: true,
          data: net.approvalsFull
            ? Array.from({ length: 200 }, (_, i) => ({ eventId: `e${i}`, affiliateId: 'af', offerId: 'of-1', friendId: `f${i}`, value: 100, status: 'approved', createdAt: new Date().toISOString() }))
            : [],
        }),
      },
      lineAccounts: { ...actual.api.lineAccounts, list: async () => ({ success: true, data: [] }) },
      tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) },
      scenarios: { ...actual.api.scenarios, list: async () => ({ success: true, data: [] }) },
    },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/affiliates',
}))
vi.mock('@/components/shared/toast', () => ({ notifyToast: vi.fn() }))

import OfferFormModal from './offer-form'
import OffersTab from './offers'
afterEach(() => { cleanup(); vi.clearAllMocks(); net.approvalsFull = false })

const offer = { id: 'of-1', name: '紹介A', description: null, rewardAmount: 1000, rewardMiles: 0, lineAccountId: null, tagId: null, scenarioId: null, isActive: true }

test('案件の入力の誤りは欄に一度だけ出し、保存せずその欄へ移る', async () => {
  render(<OfferFormModal accounts={[]} tags={[]} scenarios={[]} onClose={() => undefined} onSaved={() => undefined} />)
  const name = screen.getByLabelText(/案件名/) as HTMLInputElement
  const scroll = vi.fn()
  name.scrollIntoView = scroll
  fireEvent.click(screen.getByRole('button', { name: '作成' }))
  await waitFor(() => expect(document.activeElement).toBe(name))
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getAllByText('案件名は必須です')).toHaveLength(1)
  expect(scroll).toHaveBeenCalledWith({ block: 'center' })
  expect(net.create).not.toHaveBeenCalled()

  fireEvent.input(name, { target: { value: '紹介B' } })
  const windowDays = screen.getByLabelText('数える期間（日）') as HTMLInputElement
  fireEvent.change(windowDays, { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: '作成' }))
  await waitFor(() => expect(document.activeElement).toBe(windowDays))
  expect(windowDays.getAttribute('aria-invalid')).toBe('true')
  expect(name.getAttribute('aria-invalid')).not.toBe('true')
  expect(net.create).not.toHaveBeenCalled()
})

test('207：決まりが読めなかったら知らせ、決まりの欄は触れない', async () => {
  net.capStatus.mockRejectedValue(new Error('down'))
  render(<OfferFormModal initial={offer as never} accounts={[]} tags={[]} scenarios={[]} onClose={() => undefined} onSaved={() => undefined} />)
  await waitFor(() => expect(screen.getByText(/読み込めませんでした。このまま保存しても/)).toBeTruthy())
  expect((screen.getByLabelText('数える期間（日）') as HTMLInputElement).disabled).toBe(true)
})

test('207：読み直して読めたら、決まりの欄を触れる', async () => {
  net.capStatus.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ success: true, data: { version: { windowDays: 14, capTotal: 5, capMonthlyPerAffiliate: null, receptionFrom: null, receptionTo: null } } })
  render(<OfferFormModal initial={offer as never} accounts={[]} tags={[]} scenarios={[]} onClose={() => undefined} onSaved={() => undefined} />)
  await screen.findByText(/読み込めませんでした。このまま保存しても/)
  const again = [...document.querySelectorAll('button')].find((b) => b.textContent === '読み直す') as HTMLButtonElement
  await act(async () => { again.click() })
  await waitFor(() => expect((screen.getByLabelText('数える期間（日）') as HTMLInputElement).value).toBe('14'))
  expect((screen.getByLabelText('数える期間（日）') as HTMLInputElement).disabled).toBe(false)
})

test('210：複製は数える期間・上限・受付の期間も写す', async () => {
  net.capStatus.mockResolvedValue({ success: true, data: { version: { windowDays: 14, capTotal: 5, capMonthlyPerAffiliate: 2, receptionFrom: '2026-10-01', receptionTo: '2026-10-31' } } })
  net.create.mockResolvedValue({ success: true, data: {} })
  render(<OffersTab />)
  const menu = await screen.findByRole('button', { name: '紹介Aの操作' })
  await act(async () => { menu.click() })
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes('複製')) as HTMLElement
  await act(async () => { item.click() })
  await waitFor(() => expect(net.create).toHaveBeenCalledWith(expect.objectContaining({ windowDays: 14, capTotal: 5, capMonthlyPerAffiliate: 2, receptionFrom: '2026-10-01', receptionTo: '2026-10-31', isActive: false })))
})

test('209：承認を読み切れなかったときは、平均報酬を言い切らない', async () => {
  net.approvalsFull = true
  net.capStatus.mockResolvedValue({ success: true, data: { version: null } })
  render(<OffersTab />)
  await waitFor(() => expect(screen.getByText('件数が多く、全部は数えられませんでした')).toBeTruthy())
})
