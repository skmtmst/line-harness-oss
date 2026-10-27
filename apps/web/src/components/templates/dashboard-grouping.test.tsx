// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DashboardAsideSection, DashboardColumns, DashboardPage, DashboardRow } from './dashboard-page'

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
afterEach(cleanup)

function page(grouping?: 'cards') {
  return render(<DashboardPage title="ダッシュボード" grouping={grouping}>
    <DashboardRow variant="trend" aside={<div><DashboardAsideSection>送信枠</DashboardAsideSection><DashboardAsideSection>運用アラート</DashboardAsideSection></div>}>推移</DashboardRow>
    <DashboardColumns layout="overview">{[<DashboardAsideSection key="a">今月の配信</DashboardAsideSection>, <p key="b">最近の成果</p>]}</DashboardColumns>
  </DashboardPage>).container
}

describe('段のまとまりの見せ方', () => {
  it('cards では段の中身・右の列の段・横並びのマスを共通のカードに1つずつ入れ、カードを入れ子にしない', () => {
    const root = page('cards')
    const cards = [...root.querySelectorAll('[data-design-part="card"]')].map((card) => card.textContent)
    expect(cards).toEqual(['推移', '送信枠', '運用アラート', '今月の配信', '最近の成果'])
    expect(root.querySelector('[data-design-part="card"] [data-design-part="card"]')).toBeNull()
    expect(root.querySelectorAll('[data-grouping="cards"]')).toHaveLength(2)
  })

  it('省くと今までどおり線で区切り、カードに入れない', () => {
    const root = page()
    expect(root.querySelector('[data-design-part="card"]')).toBeNull()
    expect(root.querySelector('[data-grouping]')).toBeNull()
  })
})
