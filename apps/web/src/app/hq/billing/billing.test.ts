// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingPlanView, BillingSummary } from '@/lib/hq-billing'
import HqBillingPage from './page'

const calls = vi.hoisted(() => ({ summary: vi.fn(), invoices: vi.fn(), checkout: vi.fn(), portal: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { hqBilling: calls }, ApiError: class extends Error {} }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))

const plans: BillingPlanView[] = [
  { key: 'light', name: 'ライト', monthlyYen: 9800, yearlyYen: 99000 },
  { key: 'standard', name: 'スタンダード', monthlyYen: 29800, yearlyYen: 303000 },
  { key: 'pro', name: 'プロ', monthlyYen: 59800, yearlyYen: 609000 },
].map((p) => ({ ...p, key: p.key as BillingPlanView['key'], description: '', cta: 'checkout', priceFromStripe: false, yearlyPriceFromStripe: false,
  monthlyImages: 50, maxStaff: 3, features: [], recommended: p.key === 'standard', available: true, yearlyAvailable: true, current: false }))
const summary: BillingSummary = {
  state: 'trialing', planKey: null, planInterval: null, planName: null, planStatus: 'trialing',
  trialEndsAt: null, trialEndsLabel: '10/12', trialDaysLeft: 25, trialMonthlyImages: 20,
  currentPeriodEndsAt: null, currentPeriodEndsLabel: null, canSend: true, canGenerate: true,
  blockedReason: null, dataRetentionDays: 90, stripeReady: true, portalAvailable: false, plans,
}
beforeEach(() => {
  vi.clearAllMocks()
  /*
   * この環境の happy-dom は localStorage を用意しない（document と window は
   * 入る）。ほかの画面試験と同じく、Map 仕掛けの最小の器を当てる。
   */
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size },
    key: (i: number) => [...store.keys()][i] ?? null,
  })
  localStorage.clear()
  localStorage.setItem('lh_staff_role', 'owner')
  calls.summary.mockResolvedValue({ success: true, data: summary })
  calls.invoices.mockResolvedValue({ success: true, data: [] })
  // 外部へ移動せず、送信した周期と申込みエラーからの復帰を確認する。
  calls.checkout.mockResolvedValue({ success: false, error: 'テスト用の申込み停止' })
})
afterEach(cleanup)

async function openPage() {
  render(createElement(HqBillingPage))
  return screen.findByRole('switch', { name: '年払い' })
}

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const page = read('./page.tsx')
const menu = read('../../../components/hq/account-menu.tsx')
const limit = read('../../../components/hq/banners/limit-state.tsx')

/** ★V6 36-2 / 36-2-A 課金プランの構造と実際の切り替え。 */
describe('課金プラン（36-2）', () => {
  it('帯 → プラン3枚 → 注記 → 支払い履歴の順で、画面名はトップバーだけ', () => {
    const order = ['data-design="Status"', 'data-design="Interval"', 'data-design="Plans"', 'data-design="Note"', 'data-design="History"']
    const positions = order.map((n) => page.indexOf(n))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(page).toContain("usePageTitle('課金プラン')")
    expect(page).not.toContain('<h1')
  })

  it('申込は Stripe Checkout、支払い方法と解約は Stripe のポータルへ任せる', () => {
    expect(page).toContain('api.hqBilling.checkout(plan.key, selectedInterval)')
    expect(page).toContain('api.hqBilling.portal()')
    expect(page).toContain('window.location.href = res.data.url')
    expect(page).not.toMatch(/card_number|cardNumber|cvc/i)
  })

  it('金額の取得元を持ち、設計の価格単位を保つ', () => {
    expect(page).toContain("data-price-source={price.fromStripe ? 'stripe' : 'fallback'}")
    expect(page).toContain('税込')
  })

  it('プロもCheckoutへ、契約中のプランは「変更する」でポータルへ', () => {
    expect(page).not.toContain('相談する')
    expect(page).toContain('変更する')
    expect(page).toContain('利用中')
  })

  it('Checkout から戻ったら Webhook を待って読み直す', () => {
    expect(page).toContain("params.get('checkout')")
    expect(page).toContain('setTimeout(() => void load(), 4000)')
  })

  it('左下のアカウントメニューにプランの札と「課金プラン」が出る', () => {
    expect(menu).toContain('api.hqBilling.summary()')
    expect(menu).toContain('billingChip(billing)')
    expect(menu).toContain('href="/hq/billing"')
  })

  it('35-4 の上限・停止の状態から課金プランへ行ける', () => {
    expect(limit).toContain('href="/hq/billing"')
    expect(limit).toContain('課金プランを見る')
  })

  it('既定は月払い。年払いで3つの札・月あたり・年額に切り替わり、戻すと月額になる', async () => {
    const toggle = await openPage()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    for (const amount of ['¥9,800', '¥29,800', '¥59,800']) expect(screen.getByText(amount)).toBeTruthy()
    expect(screen.queryAllByText('約15% OFF')).toHaveLength(0)
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getAllByText('約15% OFF')).toHaveLength(3)
    for (const amount of ['¥8,250', '¥25,250', '¥50,750']) expect(screen.getByText(amount)).toBeTruthy()
    for (const amount of ['¥99,000', '¥303,000', '¥609,000']) expect(screen.getByText(`年額 ${amount}（税込）`)).toBeTruthy()
    fireEvent.click(toggle)
    expect(screen.getByText('¥9,800')).toBeTruthy()
    expect(screen.queryByText('年額 ¥99,000（税込）')).toBeNull()
    fireEvent.click(toggle)
    cleanup()
    expect((await openPage()).getAttribute('aria-checked')).toBe('false')
  })

  it.each([['light', 0], ['standard', 1], ['pro', 2]] as const)('%s の年払いボタンはyearで申込み、月払いに戻すとmonthで申し込む', async (key, index) => {
    const toggle = await openPage()
    fireEvent.click(toggle)
    fireEvent.click(screen.getAllByRole('button', { name: 'このプランにする' })[index])
    await waitFor(() => expect(calls.checkout).toHaveBeenLastCalledWith(key, 'year'))
    await screen.findByRole('alert')
    fireEvent.click(toggle)
    fireEvent.click(screen.getAllByRole('button', { name: 'このプランにする' })[index])
    await waitFor(() => expect(calls.checkout).toHaveBeenLastCalledWith(key, 'month'))
  })

  it('年のPrice未設定は該当ボタンだけ無効にし、月払いは止めない', async () => {
    calls.summary.mockResolvedValue({ success: true, data: { ...summary, plans: plans.map((p) => ({ ...p, yearlyAvailable: p.key !== 'light' })) } })
    const toggle = await openPage()
    fireEvent.click(toggle)
    const buttons = screen.getAllByRole('button', { name: 'このプランにする' }) as HTMLButtonElement[]
    expect(buttons.map((b) => b.disabled)).toEqual([true, false, false])
    expect(screen.getByText('価格がまだ設定されていません')).toBeTruthy()
    fireEvent.click(buttons[0])
    expect(calls.checkout).not.toHaveBeenCalled()
    fireEvent.click(toggle)
    expect(buttons[0].disabled).toBe(false)
  })

  it('Stripe由来の年額を12で割り、端数を切り捨てる', async () => {
    calls.summary.mockResolvedValue({ success: true, data: { ...summary, plans: [{ ...plans[0], yearlyYen: 100001, yearlyPriceFromStripe: true }] } })
    fireEvent.click(await openPage())
    expect(screen.getByText('¥8,333')).toBeTruthy()
    expect(screen.getByText('年額 ¥100,001（税込）')).toBeTruthy()
    expect(document.querySelector('[data-price-source="stripe"]')).toBeTruthy()
  })
})
