// @vitest-environment happy-dom
/**
 * ★V8 タグの一覧の並び替え（オーナー点検 2026-10-08）。
 * 直す前: 並び順の保存が例外（通信の失敗）で落ちると、動かした見た目のまま残り、
 * 保存できていないことが分からなかった。失敗の返事と同じく、元の順へ戻して「もう一度」を出す。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const narrow = vi.hoisted(() => ({ value: false }))

vi.mock('next/link', () => ({
  default: ({ children, href, className, title }: { children: React.ReactNode; href: string; className?: string; title?: string }) =>
    React.createElement('a', { href, className, title }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/tags',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', () => ({
  useStaffRole: () => role.value,
  canManageRole: (value: string | null | undefined) => value === 'owner' || value === 'admin',
}))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => narrow.value }))
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label'?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

const reorder = vi.hoisted(() => vi.fn())
const toasts = vi.hoisted(() => [] as Array<{ message: string; actionLabel?: string }>)
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const api = (actual as unknown as { api: Record<string, object> }).api
  return { ...actual, api: { ...api, tags: { ...api.tags, reorder } } }
})
vi.mock('@/components/shared/toast', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  notifyToast: (message: string, options?: { actionLabel?: string }) => { toasts.push({ message, actionLabel: options?.actionLabel }) },
}))

import { FRIEND_ATTRIBUTES_QA_GROUPS, FRIEND_ATTRIBUTES_QA_TAGS } from '@/components/friend-fields/tags-page-v4'
import TagsList from './list'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  role.value = 'owner'
  narrow.value = false
  reorder.mockReset()
  toasts.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const order = () => [...container.querySelectorAll<HTMLElement>('tr[data-reorder-id]')].map((row) => row.dataset.reorderId)

async function moveFirstDown() {
  await act(async () => { root.render(<TagsList fixture={{ items: FRIEND_ATTRIBUTES_QA_TAGS, groups: FRIEND_ATTRIBUTES_QA_GROUPS }} />) })
  const before = order()
  const grip = container.querySelector<HTMLButtonElement>('button[data-reorder-handle]')
  expect(grip).toBeTruthy()
  await act(async () => { fireEvent.keyDown(grip!, { key: 'ArrowDown' }) })
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve() })
  return before
}

describe('V8 タグの並び替えの保存の失敗', () => {
  it('通信が例外で落ちたら、元の順へ戻して「もう一度」を出す', async () => {
    reorder.mockRejectedValue(new Error('network down'))
    const before = await moveFirstDown()
    expect(reorder).toHaveBeenCalledTimes(1)
    expect(order()).toEqual(before)
    expect(toasts.at(-1)).toEqual({ message: '並び順を保存できませんでした。通信を確かめて、もう一度お試しください。', actionLabel: 'もう一度' })
  })

  it('失敗の返事でも同じく元へ戻す', async () => {
    reorder.mockResolvedValue({ success: false, error: 'conflict' })
    const before = await moveFirstDown()
    expect(order()).toEqual(before)
    expect(toasts.at(-1)?.actionLabel).toBe('もう一度')
  })

  it('保存できたら動かした順のまま', async () => {
    reorder.mockResolvedValue({ success: true, data: null })
    const before = await moveFirstDown()
    expect(order()).toEqual([before[1], before[0], ...before.slice(2)])
    expect(toasts).toEqual([])
  })
})
