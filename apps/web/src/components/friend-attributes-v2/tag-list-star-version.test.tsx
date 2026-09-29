// @vitest-environment happy-dom
/*
 * v2一覧の★切替も版付き(#715)。送る内容だけ見る。
 * Required PR gate の `pnpm --filter web test` で必ず実行される。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ update: vi.fn(), list: vi.fn(), groups: vi.fn(), stats: vi.fn() }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      tags: { ...actual.api.tags, update: apiMocks.update, list: apiMocks.list },
      tagGroups: { ...actual.api.tagGroups, list: apiMocks.groups },
      listStats: { ...actual.api.listStats, get: apiMocks.stats },
    },
  }
})

const update = apiMocks.update

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

import FriendAttributesV2TagList from './tag-list-v2'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const item = {
  id: 't1',
  name: '通常タグ',
  color: '#9ca3af',
  createdAt: '2026-09-01T00:00:00+09:00',
  lineAccountId: 'a1',
  version: 3,
  isStarred: false,
  friendCount: 0,
}

async function render() {
  apiMocks.list.mockResolvedValue({ success: true, data: [item] })
  apiMocks.groups.mockResolvedValue({ success: true, data: [] })
  apiMocks.stats.mockResolvedValue({
    success: true,
    data: { tags: { total: 1, unused: 1, taggedFriends: 0, assignedThisMonth: 0 } },
  })
  await act(async () => {
    root.render(React.createElement(FriendAttributesV2TagList, {}))
  })
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

beforeEach(() => {
  vi.clearAllMocks()
  update.mockResolvedValue({ success: true, data: { version: 4 } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

describe('v2一覧の★切替は版付き(#715)', () => {
  it('一覧行の版と担当を送る', async () => {
    await render()
    const button = Array.from(host.querySelectorAll('button')).find((el) => el.textContent === '—')
    if (!button) throw new Error('★ボタンが見つかりません')
    await click(button as HTMLElement)
    expect(update).toHaveBeenCalledWith('t1', { lineAccountId: 'a1', expectedVersion: 3, isStarred: true })
  })
})
