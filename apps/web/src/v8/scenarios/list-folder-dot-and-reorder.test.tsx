// @vitest-environment happy-dom
/*
 * 並び替えのつまみ（オーナー点検 2026-10-08）：絞り込み中・2ページ以上のときは、
 * つまみを出さず理由を言う（一部の行だけで番号を振り直さない）。
 */
import React from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

const scenario = (id: string, name: string, folderId: string | null) => ({
  id,
  name,
  description: null,
  triggerType: 'friend_add',
  triggerTagId: null,
  isActive: true,
  deliveryMode: 'relative',
  allowConcurrent: true,
  displayOrder: 0,
  folderId,
  lineAccountId: 'account-a',
  subscriberCount: 10,
  completedCount: 2,
  stepCount: 3,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
})

const total = vi.hoisted(() => ({ value: null as number | null }))
const items = [
  scenario('s-filed', '新規登録7日間フォロー', 'sf-onboarding'),
  scenario('s-unfiled', '会員更新リマインド', null),
]

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => 'owner' }
})

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const api = (actual as unknown as { api: Record<string, object> }).api
  return {
    ...actual,
    api: {
      ...api,
      scenarios: {
        ...api.scenarios,
        listPage: () => Promise.resolve({ success: true, data: { items, total: total.value ?? items.length, limit: 20, sort: [] } }),
      },
      folders: {
        ...api.folders,
        list: () => Promise.resolve({
          success: true,
          data: [{ id: 'sf-onboarding', kind: 'scenario', name: '初回案内', parentId: null, displayOrder: 0, itemCount: 1, color: '#2f6fde' }],
          unfiledCount: 1,
        }),
      },
      listStats: { get: () => Promise.resolve({ success: false }) },
    },
  }
})

import ScenariosListV8 from './list'

afterEach(() => {
  cleanup()
})

describe('V8 シナリオ一覧の並び替えのつまみ', () => {
  test('絞り込みが無く全件が1ページなら、つまみを出す', async () => {
    total.value = null
    const view = render(<ScenariosListV8 />)
    await view.findByText('新規登録7日間フォロー')
    await waitFor(() => expect(view.container.querySelectorAll('button[data-reorder-handle]')).toHaveLength(2))
  })

  test('2ページ以上あるときは、つまみを出さず理由を言う', async () => {
    total.value = 30
    const view = render(<ScenariosListV8 />)
    await view.findByText('新規登録7日間フォロー')
    await waitFor(() => expect(view.container.querySelector('[data-reorder-disabled]')?.getAttribute('title')).toBe('全件が1ページに収まる表示件数にすると動かせます'))
    expect(view.container.querySelector('button[data-reorder-handle]')).toBeNull()
    expect(view.container.querySelector('td[draggable="true"]')).toBeNull()
    total.value = null
  })
})

describe('V8 シナリオ一覧のフォルダの丸', () => {
  test('行の名前の前に、左のフォルダの列と同じ色の丸が付く（未分類は輪）', async () => {
    const view = render(<ScenariosListV8 />)
    const filedRow = (await view.findByText('新規登録7日間フォロー')).closest('tr') as HTMLElement
    await waitFor(() => expect(filedRow.querySelector('[data-folder-dot]')?.getAttribute('data-folder-dot')).toBe('filed'))
    expect(filedRow.querySelectorAll('[data-folder-dot]')).toHaveLength(1)
    expect(filedRow.querySelector('[data-folder-dot]')?.getAttribute('aria-label')).toBe('フォルダ：初回案内')
    const unfiledRow = view.getByText('会員更新リマインド').closest('tr') as HTMLElement
    expect(unfiledRow.querySelectorAll('[data-folder-dot]')).toHaveLength(1)
    expect(unfiledRow.querySelector('[data-folder-dot]')?.getAttribute('data-folder-dot')).toBe('unfiled')
  })
})
