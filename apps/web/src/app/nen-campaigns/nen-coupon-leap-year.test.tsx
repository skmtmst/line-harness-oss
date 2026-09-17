// @vitest-environment happy-dom
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NenOverview, type NenCoupon, type NenTab } from './nen-overview'

/*
 * 419: 誕生日クーポン設定の「2月29日生まれの子」3択が
 * 保存値を表示し、変更がそのまま onCouponChange へ流れること。
 */

let container: HTMLDivElement
let root: Root
function noop() {}

function renderPets(coupon: NenCoupon, onCouponChange: (coupon: NenCoupon) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <NenOverview
        tab={'pets' as NenTab}
        topAction={null}
        onTabChange={noop}
        settings={[]}
        columns={[]}
        pets={[]}
        flowMetrics={null}
        columnMetrics={null}
        petMetrics={null}
        deliveryList={{ deliveries: [], pagination: { total: 0, limit: 50, cursor: '0', nextCursor: null } }}
        deliveryDetail={null}
        coupon={coupon}
        friends={[]}
        testFriendId=""
        previewCampaignKey={null}
        previewColumnId={null}
        editingColumnId={null}
        saving={null}
        testing={null}
        savingColumnId={null}
        petDraft={{ friendId: '', name: '', animalType: '', gender: '', birthday: '' }}
        notice={null}
        onTestFriendChange={noop}
        onPreviewCampaign={noop}
        onPreviewColumn={noop}
        onEditColumn={noop}
        onUpdateColumn={noop}
        onSaveColumn={noop}
        onDeliverColumn={noop}
        onDuplicateColumn={noop}
        onTestColumn={noop}
        onToggleSetting={noop}
        onTestSend={noop}
        onPetDraftChange={noop}
        onAddPet={noop}
        onDeletePet={noop}
        onCouponChange={onCouponChange}
        onSaveCoupon={noop}
        savingCoupon={false}
        onShowDelivery={noop}
        onRetryDelivery={noop}
        onChangeDeliveryView={noop}
        renderCampaignPreview={() => null}
        renderColumnPreview={() => null}
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
  it('保存されている方針が選ばれた状態で出る', () => {
    renderPets(coupon, noop)
    const select = container.querySelector('select[aria-label="2月29日生まれの子への平年の扱い"]') as HTMLSelectElement
    expect(select).not.toBeNull()
    expect(select.value).toBe('skip')
    const labels = [...select.options].map((option) => option.textContent)
    expect(labels).toEqual(['2月28日に送る', '3月1日に送る', 'その年は送らない'])
  })

  it('方針を変えると coupon 全体ごと onCouponChange へ流れる', () => {
    const onCouponChange = vi.fn()
    renderPets(coupon, onCouponChange)
    const select = container.querySelector('select[aria-label="2月29日生まれの子への平年の扱い"]') as HTMLSelectElement
    act(() => {
      select.value = 'feb28'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onCouponChange).toHaveBeenCalledWith({ ...coupon, leapYearPolicy: 'feb28' })
  })
})
