// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * V8「サクサク感」C①②・D・E：NEN配信（自動配信）の一覧の行パネル。
 * 行を押すと右に詳細パネル（↑↓で次の行）。「編集する」は編集画面へ進む。
 * 名前のその場の書き換えは無し（名前は編集画面で変えるため）。
 */

const pushes: string[] = []
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push(url: string) { pushes.push(url) }, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/nen-campaigns',
  useSearchParams: () => new URLSearchParams(),
}))

import { NenOverview } from './nen-overview'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const setting = (campaignKey: string, label: string, isEnabled: boolean) => ({
  campaignKey,
  label,
  category: 'follow_up' as const,
  triggerEvent: 'order_created',
  delayDays: 3,
  deliveryTime: '10:00',
  isEnabled,
  title: `${label}の文面`,
  bodyText: '本文',
  buttonLabel: null,
  buttonUrl: null,
  imageUrl: null,
  dedupWindowDays: 7,
  excludeFormRespondents: false,
  afterActions: [],
  formIssue: null,
  updatedAt: '2026-09-01',
})

const noop = () => {}

function renderAuto() {
  render(
    <NenOverview
      tab="auto"
      topAction={null}
      onTabChange={noop}
      settings={[setting('order-thanks', '注文お礼', true), setting('shipping-notice', '発送案内', true)]}
      columns={[]}
      columnsTotal={0}
      kpis={null}
      flowMetrics={null}
      columnMetrics={null}
      deliveryList={null}
      deliveryDetail={null}
      friends={[]}
      testFriendId="friend-1"
      onTestFriendChange={noop}
      accountId="acc-1"
      loading={false}
      notice={null}
      saving={null}
      testing={null}
      previewCampaignKey={null}
      onPreviewCampaign={noop}
      onToggleSetting={noop}
      onTestSend={noop}
      coupon={{ isEnabled: false, codePrefix: '', benefitLabel: '', discountAmount: 0, validityDays: 0, leapYearPolicy: 'feb28' }}
      couponOpen={false}
      onCouponOpenChange={noop}
      onCouponChange={noop}
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
}

async function eventually(check: () => void, timeout = 3000) {
  const started = Date.now()
  while (true) {
    try { check(); return } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

beforeEach(() => {
  pushes.length = 0
  document.documentElement.dataset.theme = 'v8'
})
afterEach(() => {
  cleanup()
})

async function openFirstRow() {
  renderAuto()
  await eventually(() => {
    if (!document.body.textContent?.includes('注文お礼')) throw new Error('row not loaded')
  })
  const rows = [...document.body.querySelectorAll('tbody tr')]
  const firstRow = rows.find((tr) => tr.textContent?.includes('注文お礼'))
  if (!firstRow) throw new Error('no rows')
  await act(async () => {
    firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => { await Promise.resolve() })
}

describe('NEN配信V8の行パネル（C・D・E）', () => {
  it('行を押すと詳細パネルが開き、次の行へ移れる', async () => {
    await openFirstRow()
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel || !panel.textContent?.includes('注文お礼')) throw new Error('panel not open')
    })
    const next = document.body.querySelector('button[aria-label="次の行"]') as HTMLButtonElement
    await act(async () => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await eventually(() => {
      const panel = document.body.querySelector('[data-design-part="detail-panel"]')
      if (!panel?.textContent?.includes('発送案内')) throw new Error('did not move')
    })
  })

  it('パネルの「編集する」は編集画面へ進む', async () => {
    await openFirstRow()
    await eventually(() => {
      if (!document.body.querySelector('[data-design-part="detail-panel"]')) throw new Error('panel not open')
    })
    const edit = [...document.body.querySelectorAll('button')].find((b) => b.textContent === '編集する')
    if (!edit) throw new Error('no edit button')
    await act(async () => { edit.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(pushes).toEqual(['/nen-campaigns/edit?key=order-thanks'])
  })
})
