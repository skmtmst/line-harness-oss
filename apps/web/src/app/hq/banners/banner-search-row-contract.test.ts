// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
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
  window.history.replaceState(null, '', '/hq/banners')
  document.documentElement.dataset.theme = 'v8'
})
afterEach(() => {
  cleanup()
  flushListUrlState()
  delete document.documentElement.dataset.theme
})

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8')
const LIST = read('../../../v8/hq-banners/list.tsx')
const TOOLBAR = read('../../../components/shared/list-toolbar.tsx')
const TOOLBAR_CSS = read('../../../components/shared/list-toolbar.module.css')
const project = LIST.slice(LIST.indexOf('function ProjectsView'), LIST.indexOf('function LibraryView'))
const library = LIST.slice(LIST.indexOf('function LibraryView'))

describe('バナー生成の検索行（U017）', () => {
  it('プロジェクト検索は共通の幅を持つ検索スロットへ置く', () => {
    expect(project).toMatch(/<ListToolbarSearchSlot>[\s\S]*?<SearchField/)
    expect(project).toContain('プロジェクト名・説明で探す')
    expect(TOOLBAR).toContain('export function ListToolbarSearchSlot')
    expect(TOOLBAR_CSS).toMatch(/\.searchSlot > \*\s*\{[^}]*min-width:\s*0/s)
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
  it('画像検索も共通の検索スロットへ置き、並びはその外へ置く', () => {
    expect(library).toMatch(/<ListToolbarSearchSlot>[\s\S]*?<SearchField/)
    expect(library).toContain('テキスト・指示で探す')
    expect(library.indexOf('並び：作成が新しい順')).toBeGreaterThan(library.indexOf('</ListToolbarSearchSlot>'))
  })
})
describe('バナー生成のタブ行（U032）', () => {
  it('共通の道具の段は狭い幅で折り返せる', () => {
    expect(TOOLBAR_CSS).toMatch(/\.row[12]\s*\{[^}]*flex-wrap:\s*wrap/s)
    expect(TOOLBAR_CSS).toMatch(/\.searchSlot\s*\{[^}]*max-width:\s*100%/s)
  })
  it('V8の操作はフォルダの列に置き、タブ行と分ける', () => {
    expect(project).toContain('createAction={createProject}')
    expect(library).toContain('createAction={uploadImage}')
    expect(LIST).toContain('<Tabs')
  })
})
