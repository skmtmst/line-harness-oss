// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import NenCampaignsList, { type NenCampaignsListProps } from '@/v8/nen-campaigns/list'

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/lib/staff-role', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/staff-role')>()), useStaffRole: () => 'owner' }))

const noop = () => {}
const base: NenCampaignsListProps = {
  tab: 'auto', onTabChange: noop, settings: [], columns: [], columnsTotal: null, kpis: null,
  flowMetrics: null, columnMetrics: null, deliveryList: null, deliveryDetail: null, friends: [],
  testFriendId: '', onTestFriendChange: noop, accountId: null, loading: false, notice: null,
  saving: null, testing: null, previewCampaignKey: null, onPreviewCampaign: noop,
  onToggleSetting: noop, onTestSend: noop, coupon: { isEnabled: false, codePrefix: '', benefitLabel: '', discountAmount: 0, validityDays: 0, leapYearPolicy: 'feb28' },
  couponOpen: false, onCouponOpenChange: noop, onCouponChange: noop, onSaveCoupon: noop, savingCoupon: false,
  selectedColumnId: null, onSelectColumn: noop, audienceCount: null, plan: { when: 'now', scheduledAt: '' },
  onPlanChange: noop, introDraft: '', onIntroChange: noop, onSaveIntro: noop, savingColumnId: null,
  onDeliverColumn: noop, onDuplicateColumn: noop, onTestColumn: noop, onShowDelivery: noop,
  onRetryDelivery: noop, onChangeDeliveryView: noop,
}
function draw(overrides: Partial<NenCampaignsListProps>) {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(React.createElement(NenCampaignsList, { ...base, ...overrides }))
  return host
}

/* 旧の骨格を読む4件を、現役を描いて未取得と0を区別する検査へ移す。 */
describe('NEN配信 ゼロ件の表示', () => {
  it('自動配信の数は読み込み中・失敗中は「—」', () => {
    for (const overrides of [{ loading: true }, { tabError: 'failed' }]) {
      const host = draw(overrides)
      expect(host.querySelectorAll('[data-kpi-number]')[0]?.textContent).toBe('—')
      expect(host.textContent).not.toContain('自動配信 0')
    }
    expect(draw({}).querySelectorAll('[data-kpi-number]')[0]?.textContent).toBe('0')
  })
  it('コラムの数は読み込み中・失敗中は「—」', () => {
    for (const overrides of [{ loading: true }, { tabError: 'failed' }]) {
      const host = draw({ tab: 'columns', ...overrides })
      expect(host.querySelectorAll('[data-kpi-number]')[3]?.textContent).toBe('—')
      expect(host.textContent).not.toContain('コラム 0')
    }
    expect(draw({ tab: 'columns' }).querySelectorAll('[data-kpi-number]')[3]?.textContent).toBe('0')
  })
  it('送った履歴の件数とページ送りは一覧が無い間は出さない', () => {
    const host = draw({ tab: 'history', loading: true })
    expect(host.querySelector('nav[aria-label="ページ送り"]')).toBeNull()
    expect(host.querySelector('button[aria-label="次のページ"]')).toBeNull()
    expect(host.textContent).not.toContain('0 件中')
    expect(host.querySelector('[aria-busy="true"][aria-label="送った履歴を読み込んでいます"]')).toBeTruthy()
  })
  it('履歴のチップは取れない数を「—」で出す', () => {
    const host = draw({ tab: 'history' })
    for (const label of ['送りました', 'これから', '届きませんでした', '送りませんでした']) {
      expect(host.textContent).toContain(`${label} —`)
      expect(host.textContent).not.toContain(`${label} 0`)
    }
  })
})
