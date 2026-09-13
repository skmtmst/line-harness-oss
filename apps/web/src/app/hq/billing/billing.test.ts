import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const page = read('./page.tsx')
const menu = read('../../../components/hq/account-menu.tsx')
const limit = read('../../../components/hq/banners/limit-state.tsx')

/** ★V6 36-2 課金プラン（`q7FP5k`）の見張り。 */
describe('課金プラン（36-2）', () => {
  it('帯 → プラン3枚 → 注記 → 支払い履歴の順で、画面名はトップバーだけ', () => {
    const order = ['data-design-node="G8n7TD"', 'data-design-node="na3K3"', 'data-design-node="Fopep"', 'data-design-node="UhUtX"']
    const positions = order.map((n) => page.indexOf(n))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(page).toContain("usePageTitle('課金プラン')")
    expect(page).not.toContain('<h1')
  })

  it('申込は Stripe Checkout、支払い方法と解約は Stripe のポータルへ任せる', () => {
    expect(page).toContain('api.hqBilling.checkout(plan.key)')
    expect(page).toContain('api.hqBilling.portal()')
    expect(page).toContain('window.location.href = res.data.url')
    expect(page).not.toMatch(/card_number|cardNumber|cvc/i)
  })

  it('金額は Stripe の価格が取れたときだけ「仮」を外す', () => {
    expect(page).toContain("plan.priceFromStripe ? '' : '・仮'")
    expect(page).toContain('税込')
  })

  it('プロは「相談する」でお問い合わせへ、契約中のプランは「変更する」でポータルへ', () => {
    expect(page).toContain("plan.cta === 'contact'")
    expect(page).toContain('href="/hq/support"')
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
})
