// @vitest-environment happy-dom
/*
 * 86: 店の切り替えは［店舗：…］の選ぶ欄1つに統一（下線のタブは使わない）。
 * 店が1つしか無い時は選ぶ欄を出さない。対象：Googleビジネス。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const connectionFn = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('tab=settings') }))
vi.mock('@/lib/use-same-page-url', () => ({ useSamePageUrl: () => ({ replace: vi.fn(), push: vi.fn() }) }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'a', setSelectedAccountId: vi.fn(), accounts: [], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/restaurant-google-api', () => ({ restaurantGoogleApi: { connection: (...args: unknown[]) => connectionFn(...args) } }))

import GoogleV8 from './google'

function connection(stores: Array<{ id: string; name: string; line_account_id: string | null }>) {
  return {
    success: true,
    store: { id: 's1', name: '渋谷店', lineAccountId: 'a' },
    connection: { status: 'connected', locationTitle: '渋谷店', locationMapsUrl: null },
    stores,
    candidates: [],
    summary: { unrepliedCount: 0, draftCount: 0, attentionCount: 0, newCount: 0, storedCount: 0, postsAttentionCount: 0, syncStale: false },
    writeEnabled: true,
    oauthConfigured: true,
    aiAvailable: false,
    permissions: { canManageConnection: true, canPublishReply: true },
  }
}

afterEach(cleanup)

describe('86 Googleビジネス：店の切り替えは選ぶ欄1つ', () => {
  it('2店以上の時は［店舗：…］の選ぶ欄を出し、下線のタブは出さない', async () => {
    connectionFn.mockResolvedValue(connection([
      { id: 's1', name: '渋谷店', line_account_id: 'a' },
      { id: 's2', name: '新宿店', line_account_id: 'b' },
    ]))
    render(<GoogleV8 />)
    expect(await screen.findByRole('button', { name: '店舗' })).toBeTruthy()
    expect(screen.queryByRole('tablist', { name: '店舗で絞り込む' })).toBeNull()
  })

  it('店が1つしか無い時は選ぶ欄を出さない', async () => {
    connectionFn.mockResolvedValue(connection([{ id: 's1', name: '渋谷店', line_account_id: 'a' }]))
    render(<GoogleV8 />)
    expect(await screen.findByRole('heading', { name: 'Googleビジネス' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '店舗' })).toBeNull()
    expect(screen.queryByRole('tablist', { name: '店舗で絞り込む' })).toBeNull()
  })
})
