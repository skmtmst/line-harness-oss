// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mutations = vi.hoisted(() => ({ remove: vi.fn(), restore: vi.fn(), notify: vi.fn() }))
vi.mock('@/components/shared/toast', () => ({ notifyToast: mutations.notify, notifySaved: mutations.notify }))
const net = vi.hoisted(() => ({ tags: vi.fn(), groups: vi.fn(), marks: vi.fn(), searches: vi.fn() }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'A' }) }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    tags: { ...actual.api.tags, list: net.tags, restore: mutations.restore }, tagGroups: { ...actual.api.tagGroups, list: net.groups },
    supportMarks: { ...actual.api.supportMarks, list: net.marks }, savedSearches: { ...actual.api.savedSearches, list: net.searches, delete: mutations.remove },
    listStats: { get: async () => ({ success: false }) },
    scenarios: { list: async () => ({ success: true, data: [] }) }, friendFields: { list: async () => ({ success: true, data: [] }) },
  } }
})
import TagsTab from './tags-tab'
import { ApiError } from '@/lib/api'
import { ListNavigationAccount } from '@/components/shared/list-navigation'

beforeEach(() => {
  vi.useFakeTimers()
  net.tags.mockReset().mockReturnValue(new Promise(() => {}))
  net.groups.mockReset().mockResolvedValue({ success: true, data: [] })
  window.history.replaceState(null, '', '/tags')
  document.documentElement.dataset.theme = 'v8'
})
afterEach(() => { cleanup(); vi.useRealTimers(); delete document.documentElement.dataset.theme })
it('タグ初回の保留中は共通の読み込み状態を出し、0件の空とは分ける', async () => {
  render(<TagsTab accountId="A" canEdit={false} narrow={false} csvOpen={false} onCsvClose={() => {}} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  expect(document.querySelector('[data-list-state="loading"]')).not.toBeNull()
  const loading = document.querySelector('[data-list-state="loading"][aria-busy="true"][aria-label="タグを読み込んでいます"]')
  expect(loading).not.toBeNull()
  const bones = loading?.querySelectorAll('[data-skeleton]')
  expect(bones?.length).toBeGreaterThan(0)
  for (const bone of bones ?? []) {
    expect(bone.closest('[data-skeleton-reserve]')).toBeNull()
    expect(getComputedStyle(bone).visibility).not.toBe('hidden')
    expect(getComputedStyle(bone).display).not.toBe('none')
  }
  expect(document.querySelector('[data-list-state="error"]')).toBeNull()
  expect(screen.queryByText('まだタグがありません')).toBeNull()
})

const answer = (data: unknown[]) => ({ success: true, data })
const tick = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const hint = () => screen.queryByText('時間がかかっています')
const tags = (accountId = 'A') => <ListNavigationAccount.Provider value={accountId}><TagsTab accountId={accountId} canEdit={false} narrow={false} csvOpen={false} onCsvClose={() => {}} /></ListNavigationAccount.Provider>

it('タグを8秒待っても失敗や空にせず、取得できた0件だけを空と表示する', async () => {
  let resolve!: (value: ReturnType<typeof answer>) => void
  net.tags.mockReturnValueOnce(new Promise(done => { resolve = done }))
  render(tags())
  await tick(7999)
  expect(hint()).toBeNull()
  await tick(1)
  expect(hint()).not.toBeNull()
  expect(document.querySelector('[data-list-state="error"]')).toBeNull()
  expect(screen.queryByText('まだタグがありません')).toBeNull()
  expect(net.tags).toHaveBeenCalledTimes(1)
  await act(async () => { resolve(answer([])) })
  expect(hint()).toBeNull()
  expect(screen.queryByText('まだタグがありません')).not.toBeNull()
})

it('タグの失敗後に読み直すと前の8秒を持ち越さない', async () => {
  net.tags.mockRejectedValueOnce(new ApiError(500, 'private error'))
  render(tags())
  await tick(0)
  expect(screen.queryByText('タグを読み込めませんでした')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  await tick(7999)
  expect(hint()).toBeNull()
  await tick(1)
  expect(hint()).not.toBeNull()
  expect(net.tags).toHaveBeenCalledTimes(2)
})

it('タグのアカウントを替えると案内を消し、新しい8秒を数える', async () => {
  const view = render(tags('A'))
  await tick(8000)
  expect(hint()).not.toBeNull()
  view.rerender(tags('B'))
  expect(hint()).toBeNull()
  await tick(7999)
  expect(hint()).toBeNull()
  await tick(1)
  expect(hint()).not.toBeNull()
  expect(net.tags).toHaveBeenCalledTimes(2)
})
