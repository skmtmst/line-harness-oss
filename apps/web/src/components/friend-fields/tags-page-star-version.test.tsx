// @vitest-environment happy-dom
/*
 * ★切替の版付き化(#715)を本物のReactで動かす試験。
 *
 * 見るのは3つだけ: 版と担当を送ること、返った版へ進むこと（2回目は
 * 進んだ版で送る）、409では元に戻して理由を出すこと。
 * Required PR gate の `pnpm --filter web test` で必ず実行される。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const update = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: { ...actual.api, tags: { ...actual.api.tags, update } },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

import TagsPageV4 from './tags-page-v4'
import { ApiError } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const item = {
  id: 't1',
  name: '通常タグ',
  color: '#9ca3af',
  createdAt: '2026-09-01T00:00:00+09:00',
  lineAccountId: 'a1',
  version: 1,
  isStarred: false,
}

async function render() {
  await act(async () => {
    root.render(React.createElement(TagsPageV4, { fixture: { items: [item], groups: [] } }))
  })
}

function starButton(): HTMLButtonElement {
  const el = host.querySelector('button[aria-label="友だち一覧に表示する"], button[aria-label="友だち一覧に表示しない"]')
  if (!el) throw new Error('★ボタンが見つかりません')
  return el as HTMLButtonElement
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

beforeEach(() => {
  vi.clearAllMocks()
  update.mockResolvedValue({ success: true, data: { version: 2 } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

describe('タグ一覧の★切替は版付き(#715)', () => {
  it('版と担当を送り、返った版へ進む', async () => {
    await render()
    await click(starButton())
    expect(update).toHaveBeenCalledWith('t1', { lineAccountId: 'a1', expectedVersion: 1, isStarred: true })
    // 返った版へ進んでいれば、2回目は版2で送る。進んでいなければ版1のまま。
    await click(starButton())
    expect(update).toHaveBeenLastCalledWith('t1', { lineAccountId: 'a1', expectedVersion: 2, isStarred: false })
  })

  it('409では元に戻して理由を出す', async () => {
    await render()
    update.mockRejectedValueOnce(new ApiError(409, '別の人が先にタグを更新しました'))
    await click(starButton())
    // 押した瞬間の楽観表示が取り消され、押す前の表示に戻る
    expect(starButton().getAttribute('aria-label')).toBe('友だち一覧に表示する')
    expect(host.textContent).toContain('別の人が先にタグを更新しました')
  })
})
