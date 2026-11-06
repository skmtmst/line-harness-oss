// @vitest-environment happy-dom
/*
 * 統括の請求（/hq/billing → src/v8/hq/billing.tsx）の申込・支払い方法の管理と、その失敗の案内（M023/M024）。
 * 申込は Stripe Checkout、支払い方法と解約は Stripe のポータルへ任せ、返った住所へ移る。
 * 決済サービスへ届かない 502 は内部文を出さず決済サービスの案内にし、ほかは再試行の言葉つきにする。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingPlanView, BillingSummary } from '@/lib/hq-billing'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const mocks = vi.hoisted(() => ({ summary: vi.fn(), invoices: vi.fn(), checkout: vi.fn(), portal: vi.fn(), metrics: vi.fn(), title: vi.fn() }))
vi.mock('@/lib/api/helpers/hq-billing', () => ({ fetchHqBillingMetrics: mocks.metrics }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, hqBilling: { summary: mocks.summary, invoices: mocks.invoices, checkout: mocks.checkout, portal: mocks.portal } } }
})
vi.mock('@/lib/staff-role', async (original) => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq/billing',
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: mocks.title, usePageCrumbs: () => {} }))

import { ApiError } from '@/lib/api'
import { BILLING_UNREACHABLE, billingFailureMessage } from '@/v8/hq/billing-failure'
import HqBillingPage from './page'

const plans: BillingPlanView[] = (['light', 'standard', 'pro'] as const).map((key, index) => ({
  key, name: ['ライト', 'スタンダード', 'プロ'][index], description: '', cta: 'checkout', monthlyYen: 9800 * (index + 1), yearlyYen: 99000 * (index + 1),
  priceFromStripe: true, yearlyPriceFromStripe: true, monthlyImages: 50, maxStaff: 3, features: [], recommended: key === 'standard',
  available: true, yearlyAvailable: true, current: false,
}))
const summary: BillingSummary = {
  state: 'trialing', planKey: null, planInterval: null, planName: null, planStatus: 'trialing',
  trialEndsAt: null, trialEndsLabel: '10/12', trialDaysLeft: 25, trialMonthlyImages: 20,
  currentPeriodEndsAt: null, currentPeriodEndsLabel: null, canSend: true, canGenerate: true,
  blockedReason: null, dataRetentionDays: 90, stripeReady: true, portalAvailable: true, plans,
}

const realLocation = window.location
let location: { href: string }
beforeEach(() => {
  vi.clearAllMocks()
  location = { href: 'http://localhost/hq/billing' }
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, search: '', pathname: '/hq/billing', origin: 'http://localhost', get href() { return location.href }, set href(next: string) { location.href = next } } })
  mocks.summary.mockResolvedValue({ success: true, data: summary })
  mocks.invoices.mockResolvedValue({ success: true, data: [] })
  mocks.metrics.mockResolvedValue({ success: true, data: { thisMonthBilledYen: null, contractCount: 0, activeAccountCount: 0, trialCount: 1, unpaidInvoiceCount: null, nextBillingAt: null } })
  mocks.checkout.mockResolvedValue({ success: true, data: { url: 'https://checkout.stripe.test/session' } })
  mocks.portal.mockResolvedValue({ success: true, data: { url: 'https://billing.stripe.test/portal' } })
})
afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

const open = async () => {
  render(<HqBillingPage />)
  await screen.findByRole('button', { name: '支払い方法を管理' })
}
const planButton = (index: number) => screen.getAllByRole('button', { name: 'このプランにする' })[index]

describe('請求：並びと画面名', () => {
  it('帯 → 周期 → プラン → 支払い履歴の順に並べ、画面名はトップバーへ渡して、型の見出しのほかに h1 を足さない', async () => {
    await open()
    const order = [...document.querySelectorAll('[data-design]')].map((node) => node.getAttribute('data-design'))
      .filter((name) => ['Status', 'Interval', 'Plans', 'History'].includes(name!))
    expect([...new Set(order)]).toEqual(['Status', 'Interval', 'Plans', 'History'])
    expect(mocks.title).toHaveBeenCalledWith('請求')
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(document.querySelector('input[autocomplete^="cc-"], input[name*="card" i]')).toBeNull()
  })
})

describe('請求：Stripe へ渡す', () => {
  it('プランを選ぶと選んだ周期で申込を作り、返った Checkout の住所へ移る', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /年払い/ }))
    await act(async () => { fireEvent.click(planButton(2)) })
    expect(mocks.checkout).toHaveBeenCalledWith('pro', 'year')
    expect(location.href).toBe('https://checkout.stripe.test/session')
  })

  it('「支払い方法を管理」はポータルを作り、返った住所へ移る', async () => {
    await open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '支払い方法を管理' })) })
    expect(mocks.portal).toHaveBeenCalledTimes(1)
    expect(location.href).toBe('https://billing.stripe.test/portal')
  })
})

describe('M023/M024 課金の失敗表示', () => {
  it('申込で決済サービスへ届かない（502）ときは内部文を出さず、決済サービスの案内にして移らない', async () => {
    mocks.checkout.mockRejectedValueOnce(new ApiError(502, 'API error: 502'))
    await open()
    await act(async () => { fireEvent.click(planButton(0)) })
    await screen.findByText(BILLING_UNREACHABLE)
    expect(document.body.textContent).not.toContain('API error')
    expect(location.href).toBe('http://localhost/hq/billing')
    expect((planButton(0) as HTMLButtonElement).disabled).toBe(false)
  })

  it('ポータルの通信断は、再試行の言葉つきの案内にする', async () => {
    const failure = new TypeError('Failed to fetch')
    mocks.portal.mockRejectedValueOnce(failure)
    await open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '支払い方法を管理' })) })
    const message = billingFailureMessage(failure, '支払い方法の管理画面の表示', '')
    expect(message).toContain('もう一度お試しください')
    await screen.findByText(message)
    expect(screen.queryByText('支払い方法の管理画面へ進めませんでした。')).toBeNull()
  })

  it('履歴の 502 も決済サービスの案内にし、読み直しの口を残す', async () => {
    mocks.invoices.mockRejectedValueOnce(new ApiError(502, 'API error: 502'))
    await open()
    const history = screen.getByRole('heading', { name: '支払い履歴' }).closest('section')!
    expect(within(history).getByText('決済サービスにつながりませんでした')).toBeTruthy()
    expect(within(history).getByText('少し待って、もう一度読み込んでください。')).toBeTruthy()
    expect(within(history).queryByText('支払い履歴を読み込めませんでした')).toBeNull()
    expect(within(history).getByRole('button', { name: 'もう一度読み込む' })).toBeTruthy()
  })
})
