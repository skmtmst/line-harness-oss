// @vitest-environment happy-dom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ query: '' }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', useStaffIdentity: () => ({ id: 'banner-qa', role: 'owner' }), canManageRole: () => true }))
vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  api: {
    hqBanners: {
      presets: vi.fn(async () => ({ success: true, data: { presets: [], usage: null } })),
      stats: vi.fn(async () => ({ success: true, data: { projects: { active: 0, archived: 0 }, deliveredImages: 0, deliveredAccounts: 0 } })),
      projects: { list: vi.fn(async () => ({ success: true, data: [] })) },
      images: { list: vi.fn(async () => ({ success: true, data: [] })) },
    },
    lineAccounts: { list: vi.fn(async () => ({ success: true, data: [] })) },
  },
}))

import HqBannersListV8 from '@/v8/hq-banners/list'
import { flushListUrlState } from '@/components/shared/list-url-state'

beforeEach(() => {
  flushListUrlState()
  navigation.query = ''
  window.history.replaceState(null, '', '/hq/banners')
  document.documentElement.dataset.theme = 'v8'
})
afterEach(() => {
  cleanup()
  flushListUrlState()
  delete document.documentElement.dataset.theme
})

describe('バナー生成の検索行（U017）', () => {
  it('プロジェクト検索は共通の検索スロットへ置く', async () => {
    render(createElement(HqBannersListV8))
    await screen.findByText('まだプロジェクトがありません')
    expect(screen.getByRole('searchbox', { name: 'プロジェクト名・説明で探す' }).closest('[data-toolbar-search]')).not.toBeNull()
  })
  it('プロジェクトの並び順は検索スロットの外に置く', async () => {
    render(createElement(HqBannersListV8))
    await screen.findByText('まだプロジェクトがありません')
    const search = screen.getByRole('searchbox', { name: 'プロジェクト名・説明で探す' })
    const sort = screen.getByRole('button', { name: '並び', exact: true })
    const searchSlot = search.closest('[data-toolbar-search]')
    const toolbar = search.closest('[data-list-toolbar]')

    // U017は描画した検索の口と並びの口の関係で守る。画面固有のCSS名には依存しない。
    expect(searchSlot).not.toBeNull()
    expect(toolbar).not.toBeNull()
    expect(sort.closest('[data-list-sort]')).not.toBeNull()
    expect(sort.closest('[data-list-toolbar]')).toBe(toolbar)
    expect(searchSlot!.contains(sort)).toBe(false)
    expect(sort.closest('[data-toolbar-search]')).toBeNull()
    expect(sort.closest('[data-toolbar-end]')).not.toBeNull()
  })
  it('画像検索と札・用途を同じ道具の段に置き、動かない並びを出さない', async () => {
    navigation.query = 'tab=library'
    render(createElement(HqBannersListV8))
    const search = await screen.findByRole('searchbox', { name: 'テキスト・指示で探す' })
    const chips = screen.getByRole('group', { name: '見るもので絞り込む' })
    const shape = screen.getByRole('group', { name: '用途' })
    const searchSlot = search.closest('[data-toolbar-search]')
    const toolbar = search.closest('[data-list-toolbar]')
    expect(searchSlot).not.toBeNull()
    expect(toolbar).not.toBeNull()
    for (const control of [chips, shape]) {
      expect(control.closest('[data-list-toolbar]')).toBe(toolbar)
      expect(searchSlot!.contains(control)).toBe(false)
    }
    expect(screen.queryByText('並び：作成が新しい順')).toBeNull()
  })
})
/*
 * タブ行：作成の口が型の作成の場所へ渡ることとタブは v8/hq-banners/list.test.tsx
 * 「数・タブ・説明とフォルダなしの作成入口を型へ接続する」が描いて見る。狭い幅の折り返しは
 * v8-screen-guard（1152/1440/1920 のはみ出し0）が見る。
 */
