// @vitest-environment happy-dom
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NenOverview, type NenCoupon, type NenTab } from './nen-overview'

/*
 * 419: 誕生日クーポン設定の「2月29日生まれの子」3択が
 * 保存値を表示し、変更がそのまま onCouponChange へ流れること。
 * ★V6 37-6 では誕生日配信の行から開く右パネル（Drawer は body 直下に描く）。
 */

let container: HTMLDivElement
let root: Root
function noop() {}

function renderCoupon(coupon: NenCoupon, onCouponChange: (coupon: NenCoupon) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <NenOverview
        tab={'auto' as NenTab}
        topAction={null}
        onTabChange={noop}
        settings={[]}
        columns={[]}
        kpis={null}
        flowMetrics={null}
        columnMetrics={null}
        deliveryList={null}
        deliveryDetail={null}
        friends={[]}
        testFriendId=""
        onTestFriendChange={noop}
        loading={false}
        notice={null}
        saving={null}
        testing={null}
        previewCampaignKey={null}
        onPreviewCampaign={noop}
        onToggleSetting={noop}
        onTestSend={noop}
        coupon={coupon}
        couponOpen={true}
        onCouponOpenChange={noop}
        onCouponChange={onCouponChange}
        onSaveCoupon={noop}
        savingCoupon={false}
        selectedColumnId={null}
        onSelectColumn={noop}
        audienceCount={null}
        plan={{ when: 'now', scheduledAt: '' }}
        onPlanChange={noop}
        introDraft=""
        onIntroChange={noop}
        onSaveIntro={noop}
        savingColumnId={null}
        onDeliverColumn={noop}
        onDuplicateColumn={noop}
        onTestColumn={noop}
        onShowDelivery={noop}
        onRetryDelivery={noop}
        onChangeDeliveryView={noop}
      />,
    )
  })
}

const coupon: NenCoupon = {
  isEnabled: true, codePrefix: 'NENBDAY', benefitLabel: '特典',
  discountAmount: 500, validityDays: 31, leapYearPolicy: 'skip',
}

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

describe('誕生日クーポン: 2月29日生まれの扱い（3択）', () => {
  const trigger = () => document.querySelector('button[aria-label="2月29日生まれの子への平年の扱い"]') as HTMLButtonElement

  it('保存されている方針が選ばれた状態で出る', () => {
    renderCoupon(coupon, noop)
    expect(trigger()).not.toBeNull()
    expect(trigger().textContent).toContain('その年は送らない')
    act(() => { trigger().dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const labels = [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent)
    expect(labels).toEqual(['2月28日に送る', '3月1日に送る', 'その年は送らない'])
  })

  it('方針を変えると coupon 全体ごと onCouponChange へ流れる', () => {
    const onCouponChange = vi.fn()
    renderCoupon(coupon, onCouponChange)
    act(() => { trigger().dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const option = [...document.querySelectorAll('[role="option"] button')].find((button) => button.textContent === '2月28日に送る') as HTMLButtonElement
    expect(option).toBeDefined()
    act(() => { option.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onCouponChange).toHaveBeenCalledWith({ ...coupon, leapYearPolicy: 'feb28' })
  })
})
