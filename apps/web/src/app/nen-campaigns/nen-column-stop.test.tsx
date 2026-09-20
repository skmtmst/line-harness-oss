/*
 * #934 N-295: コラム配信の停止・再開が画面からできることを固定する。
 * コラムの決めごとは自動配信タブの表に出ない（自分のタブを持つ）ため、
 * コラム画面の「誰に・いつ送るか」に状態と制御を置く。
 */
// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenCampaignSetting } from '../../lib/api'
import { NenOverview, type NenTab } from './nen-overview'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const noop = () => {}

const columnSetting = (isEnabled: boolean): NenCampaignSetting => ({
  campaignKey: 'column',
  label: 'NENコラム',
  category: 'column',
  triggerEvent: null,
  delayDays: 0,
  deliveryTime: '10:00',
  isEnabled,
  title: 'コラム',
  bodyText: '本文',
  buttonLabel: 'コラムを読む',
  buttonUrl: null,
  imageUrl: null,
  dedupWindowDays: 0,
  excludeFormRespondents: false,
  afterActions: [],
})

function renderColumns(setting: NenCampaignSetting, onToggleSetting: (s: NenCampaignSetting) => void = noop) {
  act(() => {
    root.render(
      <NenOverview
        tab={'columns' as NenTab}
        topAction={null}
        onTabChange={noop}
        settings={[setting]}
        columns={[]}
        columnsTotal={0}
        kpis={null}
        flowMetrics={null}
        columnMetrics={null}
        deliveryList={null}
        deliveryDetail={null}
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
        onToggleSetting={onToggleSetting}
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

describe('NENコラム配信の停止・再開(#934 N-295)', () => {
  it('配信中は「止める」が見え、押すと決めごとの切替を呼ぶ', () => {
    const onToggle = vi.fn()
    renderColumns(columnSetting(true), onToggle)
    const stop = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '止める')
    expect(stop).toBeDefined()
    act(() => { stop!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ campaignKey: 'column', isEnabled: true }))
  })

  it('停止中は「動かす」と停止の案内が見える', () => {
    const onToggle = vi.fn()
    renderColumns(columnSetting(false), onToggle)
    const start = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '動かす')
    expect(start).toBeDefined()
    expect(container.textContent).toContain('停止中')
    expect(container.textContent).toContain('いまは送れません')
    act(() => { start!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ campaignKey: 'column', isEnabled: false }))
  })
})
