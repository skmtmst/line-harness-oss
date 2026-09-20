/*
 * #934 N-294: 配信履歴の検索がサーバー側へ渡ることを画面で固定する。
 *  1. 検索語を入れて確定すると onChangeDeliveryView へ q が渡る
 *  2. 絞り込みチップやページ送りでも検索語が消えない
 */
// @vitest-environment happy-dom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenDelivery, NenDeliveryList } from '../../lib/api'
import { NenOverview, type NenTab } from './nen-overview'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const noop = () => {}
const detail = null

const delivery = (over: Partial<NenDelivery> = {}): NenDelivery => ({
  id: 'job-1',
  campaignKey: 'arrival_check',
  label: '到着確認',
  friendId: 'friend-1',
  friendName: '山田 太郎',
  lineAccountName: '然',
  scheduledAt: '2026-09-10 10:00:00',
  sentAt: '2026-09-10 10:00:01',
  status: 'sent',
  attempts: 1,
  unmetReason: null,
  unmetReasonCode: null,
  reaction: { value: null, state: 'unavailable', reason: '取得できません' },
  version: 1,
  updatedAt: '2026-09-10 10:00:01',
  ...over,
})

const listWith = (rows: NenDelivery[]): NenDeliveryList => ({
  range: { days: 30, from: '2026-08-12T00:00:00.000Z', to: '2026-09-11T00:00:00.000Z' },
  summary: {
    pending: 0, processing: 0, sent: rows.length, skipped: 0, failed: 0, cancelled: 0,
    retryRequired: 0, unmetReasons: { blocked: 0, unfollowed: 0, other: 0 }, skippedReasons: {},
  },
  deliveries: rows,
  pagination: { total: 25, limit: 20, cursor: '0', nextCursor: '20' },
})

function renderHistory(list: NenDeliveryList, onChangeDeliveryView: (status?: string, cursor?: string, q?: string) => void = noop) {
  act(() => {
    root.render(
      <NenOverview
        tab={'history' as NenTab}
        topAction={null}
        onTabChange={noop}
        settings={[]}
        columns={[]}
        columnsTotal={0}
        kpis={null}
        flowMetrics={null}
        columnMetrics={null}
        deliveryList={list}
        deliveryDetail={detail}
        friends={[]}
        testFriendId=""
        onTestFriendChange={noop}
        accountId={null}
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
        onChangeDeliveryView={onChangeDeliveryView}
      />,
    )
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
})

function typeSearch(value: string) {
  const field = container.querySelector('input[aria-label="友だちの名前・配信の名前で検索"]')
  expect(field).not.toBeNull()
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(field, value)
    field!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function submitSearch() {
  const form = container.querySelector('form')
  expect(form).not.toBeNull()
  act(() => {
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('NEN配信履歴の検索(#934 N-294)', () => {
  it('検索語を確定すると q がサーバー側へ渡る', () => {
    const onChangeView = vi.fn()
    renderHistory(listWith([delivery()]), onChangeView)
    typeSearch('珍名')
    submitSearch()
    expect(onChangeView).toHaveBeenCalledWith(undefined, undefined, '珍名')
  })

  it('絞り込みチップを切り替えても確定済みの検索語が消えない', () => {
    const onChangeView = vi.fn()
    renderHistory(listWith([delivery()]), onChangeView)
    typeSearch('珍名')
    submitSearch()
    onChangeView.mockClear()
    const chip = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.startsWith('届きませんでした'))
    expect(chip).toBeDefined()
    act(() => { chip!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onChangeView).toHaveBeenCalledWith('failed', undefined, '珍名')
  })

  it('ページ送りでも確定済みの検索語が消えない', () => {
    const onChangeView = vi.fn()
    renderHistory(listWith([delivery()]), onChangeView)
    typeSearch('珍名')
    submitSearch()
    onChangeView.mockClear()
    const next = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '次へ')
    expect(next).toBeDefined()
    act(() => { next!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onChangeView).toHaveBeenCalledWith(undefined, '20', '珍名')
  })
})
