// @vitest-environment happy-dom
/*
 * 設定 › SNS 連携の Instagram のカード（★V8-B `YINmJ`・`DFnll`／2026-10-07 利用者承認）。
 * 守るのは BEHAVIOR.md に書いた決めごと：
 *  - 状態のことばは4つ（接続しています／未接続／認可が切れています／設定がありません）。
 *  - 未接続・認可切れは注記＋［Instagram にログインして接続］。ページを選ぶ段は出さない。
 *  - 接続済みは `@ユーザー名（ビジネス）`・「写真つき投稿の同時公開」＋［接続を確かめる］［接続を解除する］。
 *  - 「設定がありません」は注記だけ。押せないボタンは置かない。
 *  - 閲覧のみにはボタンを置かない。
 *  - 戻り先 `?instagram=connected|failed` の帯。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InstagramConnectionStatus } from '@line-crm/shared'
import type { GoogleConnectionData } from '@/lib/restaurant-google-api'
import SnsSettingsPage from './sns'

const fixture = vi.hoisted(() => ({
  googleConnection: vi.fn(),
  googleDisconnect: vi.fn(),
  igConnection: vi.fn(),
  igStart: vi.fn(),
  igRefresh: vi.fn(),
  igDisconnect: vi.fn(),
  replace: vi.fn(),
  role: { value: 'owner' as string | null },
  search: { value: '' },
}))

vi.mock('@/lib/restaurant-google-api', () => ({
  restaurantGoogleApi: { connection: fixture.googleConnection, disconnect: fixture.googleDisconnect },
}))

vi.mock('@/lib/api', () => ({
  api: {
    instagram: {
      connection: fixture.igConnection,
      start: fixture.igStart,
      refresh: fixture.igRefresh,
      disconnect: fixture.igDisconnect,
    },
  },
  ApiError: class ApiError extends Error {},
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: fixture.replace }),
  usePathname: () => '/settings/sns',
  useSearchParams: () => new URLSearchParams(fixture.search.value),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', accounts: [] }),
}))

vi.mock('@/lib/staff-role', () => ({
  useStaffRole: () => fixture.role.value,
  canManageRole: (role: string | null) => role === 'owner' || role === 'admin',
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
  useHideSettingsNav: () => {},
}))

function googleData(): GoogleConnectionData {
  return {
    success: true,
    store: { id: 'store-1', name: '然カフェ 本店', lineAccountId: 'acc-1' },
    connection: { status: 'disconnected', locationTitle: null },
    candidates: [],
    summary: {
      unrepliedCount: 0, draftCount: 0, attentionCount: 0, newCount: 0,
      storedCount: 0, postsAttentionCount: 0, syncStale: false,
    },
    writeEnabled: true,
    oauthConfigured: true,
    aiAvailable: false,
    permissions: { canManageConnection: true, canPublishReply: true },
  }
}

function status(state: InstagramConnectionStatus['state'], connection?: InstagramConnectionStatus['connection']): InstagramConnectionStatus {
  return { state, replyEnabled: false, ...(connection ? { connection } : {}) }
}

const CONNECTED = {
  pageId: 'page-1',
  instagramId: 'ig-1',
  pageName: '然カフェ',
  username: 'nen_cafe',
  expiresAt: '2026-12-31T00:00:00.000Z',
  dataAccessExpiresAt: null,
  version: 3,
  syncedAt: '2026-10-07T01:00:00.000Z',
}

function setup(state: InstagramConnectionStatus['state'], connection?: InstagramConnectionStatus['connection']) {
  fixture.googleConnection.mockResolvedValue(googleData())
  fixture.igConnection.mockResolvedValue({ success: true, data: status(state, connection) })
  render(<SnsSettingsPage />)
}

/* Googleのカードにも同じことば（「未接続」など）が出るので、Instagramのカードの中だけを見る。 */
function igCard() {
  return within(screen.getByRole('region', { name: 'Instagram' }))
}

afterEach(() => {
  cleanup()
  fixture.role.value = 'owner'
  fixture.search.value = ''
  vi.resetAllMocks()
})

describe('Instagram のカード（★V8-B `YINmJ`・`DFnll`）', () => {
  it('未接続では注記と［Instagram にログインして接続］を出し、ページを選ぶ段は出さない', async () => {
    setup('disconnected')

    expect(await igCard().findByText('未接続')).toBeTruthy()
    expect(screen.getByText('Instagram のビジネスアカウント（またはクリエイターアカウント）でログインしてください。個人のアカウントは接続できません。')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Instagram にログインして接続' })).toBeTruthy()
    // ページを選ぶ段（利用者の決めで出さない）
    expect(screen.queryByText(/ページを選/)).toBeNull()
    // 未接続では解除・確認のボタンは出ない。
    expect(screen.queryByRole('button', { name: '接続を確かめる' })).toBeNull()
  })

  it('接続済みではアカウント名とできることを出し、確かめる・解除のボタンを出す', async () => {
    setup('connected', CONNECTED)

    expect(await screen.findByText('接続しています')).toBeTruthy()
    expect(screen.getByText('接続しているアカウント')).toBeTruthy()
    expect(screen.getByText('@nen_cafe（ビジネス）')).toBeTruthy()
    expect(screen.getByText('できること')).toBeTruthy()
    expect(screen.getByText('写真つき投稿の同時公開')).toBeTruthy()
    expect(screen.getByRole('button', { name: /接続を確かめる/ })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '接続を解除する' }).length).toBeGreaterThan(0)
    // 接続済みにはログインを促す注記を出さない。
    expect(screen.queryByText(/個人のアカウントは接続できません/)).toBeNull()
  })

  it('認可が切れているときはログインのボタンと解除のボタンを並べる', async () => {
    setup('expired', CONNECTED)

    expect(await screen.findByText('認可が切れています')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Instagram にログインして接続' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '接続を解除する' }).length).toBeGreaterThan(0)
  })

  it('「設定がありません」のときは注記だけで、押せるボタンを置かない', async () => {
    setup('unconfigured')

    expect(await screen.findByText('設定がありません')).toBeTruthy()
    expect(screen.getByText('この環境には Instagram 接続の設定がありません。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Instagram にログインして接続' })).toBeNull()
    expect(screen.queryByRole('button', { name: /接続を確かめる/ })).toBeNull()
  })

  it('閲覧のみには接続・解除・確認のボタンを置かない', async () => {
    fixture.role.value = 'staff'
    setup('connected', CONNECTED)

    expect(await screen.findByText('接続しています')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /接続を確かめる/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '接続を解除する' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Instagram にログインして接続' })).toBeNull()
  })

  it('［接続を確かめる］で確かめの口を呼び、読み直す', async () => {
    setup('connected', CONNECTED)

    fireEvent.click(await screen.findByRole('button', { name: /接続を確かめる/ }))
    await waitFor(() => expect(fixture.igRefresh).toHaveBeenCalledWith('acc-1'))
    await waitFor(() => expect(fixture.igConnection.mock.calls.length).toBeGreaterThan(1))
  })

  it('［接続を解除する］は確認の小窓をはさみ、いまの版の番号を渡す', async () => {
    fixture.igDisconnect.mockResolvedValue({ success: true })
    setup('connected', CONNECTED)

    fireEvent.click((await screen.findAllByRole('button', { name: '接続を解除する' }))[0])
    expect(await screen.findByText('Instagram の接続を解除しますか？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '解除する' }))
    await waitFor(() => expect(fixture.igDisconnect).toHaveBeenCalledWith('acc-1', 3))
  })
})

describe('Instagram のログインから戻ったときの帯', () => {
  it('うまくいったことを知らせ、閉じると印を消す', async () => {
    fixture.search.value = 'instagram=connected'
    setup('connected', CONNECTED)

    expect(await screen.findByText('Instagram とつながりました。Googleビジネスの投稿を Instagram にも出せます。')).toBeTruthy()
  })

  it('失敗したときはビジネスアカウントでのログインを促す', async () => {
    fixture.search.value = 'instagram=failed'
    setup('disconnected')

    expect(await screen.findByText('Instagram とつなげませんでした。ビジネスアカウント（またはクリエイターアカウント）でログインして、もう一度お試しください。')).toBeTruthy()
  })
})
