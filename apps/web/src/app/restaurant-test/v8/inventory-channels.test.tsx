// @vitest-environment happy-dom
/*
 * ★V8-B 予約枠・在庫の予約経路の連携タブ（hQQlt）。
 * 取り込みアドレス・媒体のつながり・読めなかったものを実データで出す。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InventoryChannels from './inventory-channels'

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
    return jsonResponse({ success: true, data: [{ id: 'a1', storeId: 'store-1', localPart: 'r-abc', address: 'r-abc@in.musubo.jp', status: 'active', createdAt: '2026-10-01T00:00:00+09:00', revokedAt: null }] })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const connectors = [
  { id: 'c1', store_id: 'store-1', provider: 'restaurant_board', mode: 'inbound_only', status: 'active', last_synced_at: '2026-10-02T18:51:00+09:00', last_error: null },
]

describe('hQQlt 予約経路の連携', () => {
  it('アドレス・媒体・読めなかったものを出す', async () => {
    render(<InventoryChannels accountId="account-1" storeId="store-1" connectors={connectors} />)
    expect(await screen.findByText('r-abc@in.musubo.jp')).toBeTruthy()
    expect(document.querySelector('[data-design-node="hQQlt"]')).toBeTruthy()
    expect(screen.getByText('restaurant_board')).toBeTruthy()
    expect(screen.getByText('読めなかったものが 1 件あります。')).toBeTruthy()
    expect(screen.getByText('食べログ')).toBeTruthy()
  })
})
