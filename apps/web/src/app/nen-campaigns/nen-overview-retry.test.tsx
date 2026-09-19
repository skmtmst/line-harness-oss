// @vitest-environment happy-dom
/*
 * NEN概要の履歴タブを本物の React で描画し、再送ボタンの出し分けを確かめる(#733)。
 * 見る筋書き:
 *   1. 上限まで失敗した記録は「再送待ちへ戻す」が出て、理由を書いて押すと再送が呼ばれる。
 *   2. 直せる理由で止まった記録(skipped + campaign_disabled)はボタンが出て、押すと再送が呼ばれる。
 *   3. 直せない理由の記録(skipped + friend_unavailable / campaign_form_already_submitted)は
 *      ボタンが出ず、理由別の説明だけ出る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NenDelivery, NenDeliveryDetail, NenDeliveryList } from '@/lib/api'
import { NenOverview, type NenTab } from './nen-overview'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function delivery(overrides: Partial<NenDelivery> & { id: string }): NenDelivery {
  return {
    campaignKey: 'arrival_check',
    label: '到着確認',
    friendId: 'friend-a',
    friendName: '愛犬家A',
    lineAccountName: 'NEN本店',
    scheduledAt: '2026-09-01T01:00:00.000Z',
    sentAt: null,
    status: 'skipped',
    attempts: 0,
    unmetReason: '止まった理由',
    unmetReasonCode: null,
    reaction: { state: 'unavailable', value: null, reason: '反応は取得できません' },
    version: 1,
    updatedAt: '2026-09-01T01:00:00.000Z',
    ...overrides,
  }
}

function detailFor(row: NenDelivery): NenDeliveryDetail {
  const { reaction: _reaction, ...rest } = row
  return {
    ...rest,
    trigger: '注文が確定',
    content: {
      title: '到着確認のお知らせ',
      bodyText: '本文',
      buttonLabel: null,
      buttonUrl: null,
      imageUrl: null,
      state: 'available',
      reason: null,
    },
  }
}

function listWith(rows: NenDelivery[]): NenDeliveryList {
  return {
    range: { days: 30, from: '2026-08-02', to: '2026-09-01' },
    summary: {
      pending: 0, processing: 0, sent: 0, skipped: rows.length, failed: 0,
      cancelled: 0, retryRequired: 0, unmetReasons: {},
    },
    deliveries: rows,
    pagination: { total: rows.length, limit: 50, cursor: '0', nextCursor: null },
  }
}

let container: HTMLDivElement
let root: Root

function noop() {}

function renderHistory(rows: NenDelivery[], detail: NenDeliveryDetail | null, onRetry: (id: string, version: number, reason: string) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
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
        deliveryList={listWith(rows)}
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
        onRetryDelivery={onRetry}
        onChangeDeliveryView={noop}
      />,
    )
  })
}

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function queryButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
}

describe('NEN概要の再送ボタン出し分け(#733)', () => {
  it('上限まで失敗した記録は理由を書いて再送できる', () => {
    const onRetry = vi.fn()
    const row = delivery({ id: 'job-failed', status: 'failed', attempts: 5, unmetReasonCode: null })
    renderHistory([row], detailFor(row), onRetry)
    const retryButton = queryButtons().find((button) => button.textContent === '再送待ちへ戻す')
    expect(retryButton).toBeDefined()
    expect(retryButton?.disabled).toBe(true)
    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    // React の textarea は代入を見ないため、native setter で値を入れて input を配る。
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'お客様確認後に再送')
      textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const enabled = queryButtons().find((button) => button.textContent === '再送待ちへ戻す')
    expect(enabled?.disabled).toBe(false)
    act(() => {
      enabled!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onRetry).toHaveBeenCalledWith('job-failed', 1, 'お客様確認後に再送')
  })

  it('直せる理由で止まった記録は再送できる', () => {
    const onRetry = vi.fn()
    const row = delivery({
      id: 'job-fixable', status: 'skipped', attempts: 0,
      unmetReason: '配信の決めごとが停止中です', unmetReasonCode: 'campaign_disabled',
    })
    renderHistory([row], detailFor(row), onRetry)
    expect(queryButtons().some((button) => button.textContent === '再送待ちへ戻す')).toBe(true)
  })

  it('直せない理由の記録はボタンを出さず理由別の説明を出す', () => {
    const onRetry = vi.fn()
    const friendRow = delivery({
      id: 'job-friend', status: 'skipped', attempts: 0,
      unmetReason: '友だちが配信対象ではありません', unmetReasonCode: 'friend_unavailable',
    })
    renderHistory([friendRow], detailFor(friendRow), onRetry)
    expect(queryButtons().some((button) => button.textContent === '再送待ちへ戻す')).toBe(false)
    expect(container.textContent).toContain('友だち側の事情のため、この記録は再送できません。')
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('回答済みの記録はボタンを出さず回答済みの説明を出す', () => {
    const onRetry = vi.fn()
    const answeredRow = delivery({
      id: 'job-answered', status: 'skipped', attempts: 0,
      unmetReason: 'すでに回答済みのため送りません', unmetReasonCode: 'campaign_form_already_submitted',
    })
    renderHistory([answeredRow], detailFor(answeredRow), onRetry)
    expect(queryButtons().some((button) => button.textContent === '再送待ちへ戻す')).toBe(false)
    expect(container.textContent).toContain('すでに回答済みのため、この記録は再送しません。')
    expect(onRetry).not.toHaveBeenCalled()
  })
})
