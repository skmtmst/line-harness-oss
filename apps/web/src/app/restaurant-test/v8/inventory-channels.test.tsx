// @vitest-environment happy-dom
/*
 * ★V8-B 予約枠・在庫の予約経路の連携タブ（hQQlt）。
 * 取り込みアドレス・媒体のつながり・読めなかったものを実データで出す。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InventoryChannels from '@/v8/restaurant/inventory/channels'
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/inbound-emails')) {
      return jsonResponse({
        success: true,
        data: [{ id: 'm1', storeId: 'store-1', receivedAt: '2026-10-02T18:20:00+09:00', status: 'quarantined', reason: '人数の欄が読めませんでした', mediaCode: 'tabelog', mediaName: '食べログ' }],
        total: 1,
      })
    }
    if(String(url).includes('/channels')) return jsonResponse({success:true,data:[{id:'c1',code:'restaurant_board',name:'restaurant_board',receiveMethod:'email_forward',status:'receiving',todayCount:1,lastReceivedAt:null,unreadableCount:0,daysWithoutReceipt:0}]})
    return jsonResponse({ success: true, data: [{ id: 'a1', storeId: 'store-1', localPart: 'r-abc', address: 'r-abc@in.musubo.jp', status: 'active', createdAt: '2026-10-01T00:00:00+09:00', revokedAt: null }] })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const connectors = [
  { id: 'c1', store_id: 'store-1', provider: 'restaurant_board', mode: 'inbound_only', status: 'active', last_synced_at: '2026-10-02T18:51:00+09:00', last_error: null },
]

describe('hQQlt 予約経路の連携', () => {
  it('アドレス・媒体・読めなかったものを出す', async () => {
    render(<InventoryChannels accountId="account-1" storeId="store-1" date="2026-10-02" canEdit />)
    const address = await screen.findByRole('textbox', { name: '取り込みアドレス' }) as HTMLInputElement
    expect(address.value).toBe('r-abc@in.musubo.jp')
    expect(address.readOnly).toBe(true)
    expect(document.querySelector('[data-design-node="hQQlt"]')).toBeTruthy()
    expect(screen.getByText('restaurant_board')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '読めなかったもの' })).toBeTruthy()
    const unreadLabel = document.querySelector('[data-kpi-label][title="読めなかった"]')!
    expect(unreadLabel.closest('[data-kpi-presentation]')?.querySelector('[data-kpi-number]')?.textContent).toBe('1')
    expect(screen.getByText(/食べログ ・ 人数の欄が読めませんでした/)).toBeTruthy()
  })
})
