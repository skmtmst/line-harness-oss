// @vitest-environment happy-dom
/*
 * V8 友だち詳細（src/v8/friend-detail）の動きの試験。BEHAVIOR.md の主要な動きを守る。
 * 概要が出る・閲覧のみは変える操作を置かない・鍵のある運用担当は対応を変えられる・
 * 履歴の切り替えと続き・情報欄は変えた欄だけ送る・404 と 403 を分ける。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const getFriend = vi.hoisted(() => vi.fn())
const fetchApi = vi.hoisted(() => vi.fn())
const forFriend = vi.hoisted(() => vi.fn())
const saveForFriend = vi.hoisted(() => vi.fn())
const role = vi.hoisted(() => ({ current: 'owner' as string | null }))
const params = vi.hoisted(() => ({ current: new URLSearchParams('id=friend-1') }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchApi,
    api: {
      ...actual.api,
      friends: {
        ...actual.api.friends,
        get: getFriend,
        upcoming: async () => ({
          success: true,
          data: {
            nextBooking: { kind: 'booking', id: 'bk-1', title: 'トリミング', startsAt: '2026-10-04T10:00:00+09:00', status: 'confirmed' },
            nextBookingError: false,
            nextAutoDelivery: { kind: 'scenario', id: 'sc-1', name: '新規登録7日間フォロー', scheduledAt: '2026-10-10T10:00:00+09:00' },
            nextAutoDeliveryError: false,
          },
        }),
        mileage: async () => ({
          success: true,
          data: {
            summary: { programId: 'p', programName: 'p', available: 2450, pending: 0, lifetimeEarned: 0, spent: 0 },
            history: [],
            insights: { accountCount: 1 },
            connections: [],
          },
        }),
        richMenu: async () => ({ success: true, data: { id: 'rm', name: '基本メニュー（会員）', isDefault: false } }),
        formSubmissions: async () => ({ success: true, data: { items: [], total: 0, nextCursor: null } }),
      },
      friendFields: { ...actual.api.friendFields, forFriend, saveForFriend },
      folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { role: role.current } }) },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', rest, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => params.current,
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '本店' }, accounts: [], loading: false }),
}))

vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ enabled: () => true }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.current }
})

import { ApiError } from '@/lib/api'
import FriendDetailV8 from './detail'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const store = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
  },
})

const friend = {
  id: 'friend-1',
  lineUserId: 'U1',
  displayName: '山田 花子',
  pictureUrl: null,
  statusMessage: null,
  isFollowing: true,
  createdAt: '2025-04-03T00:00:00.000Z',
  updatedAt: '2025-04-03T00:00:00.000Z',
  tags: [{ id: 't1', name: 'VIP', color: '#000', createdAt: '2025-04-03T00:00:00.000Z' }],
  formSubmissions: [],
  formSubmissionTotal: 0,
  support: { status: 'resolved', operatorName: 'Kenta', notes: '定期便を月2回' },
}

const timeline = [
  { id: 'a', type: 'message_received', summary: '『秋の新商品はいつ届きますか？』', status: null, source: { kind: 'message', id: 'm1', parentId: null, url: null }, occurredAt: '2026-10-01T10:12:00+09:00', lineAccount: { id: 'x', name: '然-NEN-TEST' } },
  { id: 'b', type: 'message_sent', summary: '『10月5日に発送予定です』', status: null, source: { kind: 'message', id: 'm2', parentId: null, url: null }, occurredAt: '2026-10-01T10:20:00+09:00', lineAccount: { id: 'x', name: '然-NEN-TEST' } },
  { id: 'c', type: 'tag_change', summary: 'タグ『VIP』が付いた', status: null, source: null, occurredAt: '2026-09-26T12:40:00+09:00', lineAccount: { id: 'x', name: '然-NEN-TEST' } },
]

const field = (id: string, name: string, value: string, isPersonal = false) => ({
  id, folderId: null, name, fieldKey: id, type: 'text', options: null, defaultValue: null, source: 'manual',
  ecFieldPath: null, ecIsMaster: false, isPersonal, isStarred: false, displayOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', value,
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  role.current = 'owner'
  store.clear()
  params.current = new URLSearchParams('id=friend-1')
  getFriend.mockImplementation(async () => ({ success: true, data: friend }))
  fetchApi.mockImplementation(async (path: string) => ({
    success: true,
    data: { items: path.includes('cursor=') ? [] : timeline, nextCursor: path.includes('cursor=') ? null : 'next-1' },
  }))
  forFriend.mockImplementation(async () => ({ success: true, data: { items: [field('f-name', '本名', '山田 花子', true), field('f-dog', '犬の名前', 'こむぎ')], hiddenPersonalCount: 0 } }))
  saveForFriend.mockImplementation(async () => ({ success: true, data: { updated: 1 } }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
})

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

async function render() {
  act(() => { root.render(<FriendDetailV8 />) })
  await flush()
}

const links = (text: string) => [...host.querySelectorAll('a, button')].filter((el) => el.textContent?.trim() === text)

describe('V8 友だち詳細（src/v8）の動き', () => {
  it('概要に名前・札・本名・タグ・マイル・次の配信・最近の履歴が出る', async () => {
    await render()
    const text = host.textContent ?? ''
    expect(text).toContain('山田 花子')
    expect(text).toContain('対応済み')
    expect(text).toContain('VIP')
    expect(text).toContain('2,450')
    expect(text).toContain('基本メニュー（会員）')
    expect(text).toContain('新規登録7日間フォロー')
    expect(text).toContain('『秋の新商品はいつ届きますか？』')
    expect(host.querySelectorAll('[role="tab"]').length).toBe(10)
    // 履歴は概要を開いたときに8件だけ取る。
    expect(fetchApi).toHaveBeenCalledWith(expect.stringContaining('/api/friends/friend-1/timeline?limit=8'), expect.anything())
  })

  it('鍵の無い運用担当（閲覧のみ）は帯が出て、変える操作を置かない', async () => {
    role.current = 'staff'
    await render()
    expect(host.textContent).toContain('閲覧のみで見ています')
    expect(links('編集')).toHaveLength(0)
    expect(links('＋ 追加')).toHaveLength(0)
    expect(links('変更')).toHaveLength(0)
    expect(host.textContent).not.toContain('シナリオに登録する')
  })

  it("'/chats' の鍵を持つ運用担当は対応・タグ・メモを編集でき、帯は出ない", async () => {
    role.current = 'staff'
    store.set('lh_staff_permissions', JSON.stringify(['/chats']))
    await render()
    expect(host.textContent).not.toContain('閲覧のみで見ています')
    expect(links('編集').length).toBeGreaterThanOrEqual(3)
    // シナリオ登録はオーナー・管理者だけ。
    expect(host.textContent).not.toContain('シナリオに登録する')
  })

  it('履歴タブ：受信だけに絞れて、さらに読み込むは続きの印を渡す', async () => {
    params.current = new URLSearchParams('id=friend-1&tab=history')
    await render()
    expect(host.textContent).toContain('『10月5日に発送予定です』')
    act(() => { (links('受信')[0] as HTMLButtonElement).click() })
    await flush()
    expect(host.textContent).toContain('『秋の新商品はいつ届きますか？』')
    expect(host.textContent).not.toContain('『10月5日に発送予定です』')
    act(() => { (links('さらに読み込む')[0] as HTMLButtonElement).click() })
    await flush()
    expect(fetchApi).toHaveBeenLastCalledWith(expect.stringContaining('cursor=next-1'), expect.anything())
  })

  it('情報欄タブ：変えた欄だけを送る', async () => {
    params.current = new URLSearchParams('id=friend-1&tab=info')
    await render()
    const input = host.querySelector('#ff-f-dog') as HTMLInputElement
    expect(input, '犬の名前の欄がありません').toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, 'もも')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()
    act(() => { (links('保存する')[0] as HTMLButtonElement).click() })
    await flush()
    expect(saveForFriend).toHaveBeenCalledWith('friend-1', { 'f-dog': 'もも' })
    expect(host.textContent).toContain('1 件を保存しました')
  })

  it('404 は「見つかりません」、403 は「権限がありません」で、再試行を出さない', async () => {
    getFriend.mockImplementation(async () => { throw new ApiError(404, 'not found') })
    await render()
    expect(host.textContent).toContain('この友だちは見つかりません')
    act(() => root.unmount())
    root = createRoot(host)
    getFriend.mockImplementation(async () => { throw new ApiError(403, 'forbidden') })
    await render()
    expect(host.textContent).toContain('この友だちを見る権限がありません')
    expect(host.textContent).not.toContain('もう一度')
  })
})
