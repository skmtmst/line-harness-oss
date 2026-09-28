// @vitest-environment happy-dom
/*
 * m21o: タグ一覧のフォルダ欄のかぶりと件数の置き場所を、本物の React で確かめる。
 *
 * - フォルダの列は文字だけ。行ごとの選び直し欄（`未分類 ▼`）を置かない。
 *   欄の幅が列を超えて隣の「付け方」へ重なっていたため。
 * - 件数（表示件数の選び口と `1–2 / 2件`）は絞り込みと同じ折り返しの
 *   流れの末尾（右端）に置く。件数だけの行を作らない。
 * - 主な状態（正常・空・読み込み中・失敗）を言い分ける。
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { Tag, TagGroup } from '@line-crm/shared'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const state = vi.hoisted(() => ({
  tags: null as null | (() => Promise<unknown>),
  groups: null as null | (() => Promise<unknown>),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      tags: {
        ...actual.api.tags,
        list: (...args: unknown[]) => state.tags!(),
        reorder: vi.fn(async () => ({ success: true as const, data: null })),
        update: vi.fn(async () => ({ success: true as const, data: null })),
      },
      tagGroups: {
        ...actual.api.tagGroups,
        list: (...args: unknown[]) => state.groups!(),
      },
      listStats: {
        ...actual.api.listStats,
        get: vi.fn(async () => ({ success: false as const, error: 'unused' })),
      },
      featureSettings: {
        ...actual.api.featureSettings,
        visibility: vi.fn(async () => ({
          success: true as const,
          data: { features: { friend_fields: true, support_marks: true, saved_searches: true } },
        })),
      },
    },
  }
})

import TagsPageV4 from './tags-page-v4'

const LONG_FOLDER = 'とても長いフォルダ名のテスト用フォルダ0123456789'

const ITEMS: Tag[] = [
  {
    id: 't1', name: 'EC顧客連携済み', color: '#3B82F6', groupId: 'g1',
    friendCount: 5, assignSource: 'ec', createdAt: '2026-01-13T00:00:00.000Z',
    lineAccountId: 'account-a', status: 'active',
  },
  {
    id: 't2', name: '未契約', color: '#8b938d', groupId: null,
    friendCount: 0, createdAt: '2026-01-13T00:00:00.000Z',
    lineAccountId: 'account-a', status: 'active',
  },
]

const GROUPS: TagGroup[] = [
  { id: 'g1', accountId: 'account-a', name: LONG_FOLDER, sortOrder: 0, color: '#3B82F6', createdAt: '', updatedAt: '' },
]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('m21o タグ一覧のフォルダ欄と件数', () => {
  it('フォルダは文字だけで、選び直し欄を行に置かない', () => {
    render(<TagsPageV4 accountId="account-a" fixture={{ items: ITEMS, groups: GROUPS }} />)
    // 長い名前は全文を重ねて読める（title）。表と狭幅カードの両方に出る。
    const titled = screen.getAllByTitle(LONG_FOLDER)
    expect(titled.length).toBeGreaterThan(0)
    expect(titled[0].textContent).toContain(LONG_FOLDER)
    // 未分類も文字で出る。
    expect(screen.getAllByTitle('未分類').length).toBeGreaterThan(0)
    // 行ごとの選び直し欄は無い。編集画面の「所属フォルダ」で変える。
    expect(screen.queryByRole('button', { name: 'EC顧客連携済み のフォルダ' })).toBeNull()
    expect(screen.queryByRole('button', { name: '未契約 のフォルダ' })).toBeNull()
  })

  it('付け方は1行で、全文は重ねて読める', () => {
    render(<TagsPageV4 accountId="account-a" fixture={{ items: ITEMS, groups: GROUPS }} />)
    const labeled = screen.getAllByTitle('EC連携')
    expect(labeled.length).toBeGreaterThan(0)
    expect(labeled[0].textContent).toContain('EC連携')
  })

  it('件数は絞り込みと同じ流れの末尾（右端）にあり、単独の行を作らない', () => {
    render(<TagsPageV4 accountId="account-a" fixture={{ items: ITEMS, groups: GROUPS }} />)
    const pager = screen.getByRole('button', { name: '表示件数' })
    expect(screen.getByText(/1.2 \/ 2件/)).toBeTruthy()
    const chip = screen.getByRole('button', { name: '未使用のタグ' })
    // 件数の包みと札がいちばん近くで交わる場所が、札の親そのもの。
    // 間に件数だけの行の包みが入らない。
    let node: HTMLElement | null = pager
    let shared: HTMLElement | null = null
    while (node) {
      if (node.contains(chip)) { shared = node; break }
      node = node.parentElement
    }
    expect(shared).toBe(chip.parentElement)
  })

  it('空のときは「まだタグがありません」と出す', () => {
    // 表と狭幅カードの両方に同じ案内が出る。
    render(<TagsPageV4 accountId="account-a" fixture={{ items: [], groups: [] }} />)
    expect(screen.getAllByText('まだタグがありません').length).toBeGreaterThan(0)
  })

  it('読み込み中と失敗を言い分ける', async () => {
    let resolveList!: (value: unknown) => void
    state.tags = () => new Promise((resolve) => { resolveList = resolve })
    state.groups = async () => ({ success: true, data: [] })
    render(<TagsPageV4 accountId="account-a" />)
    expect((await screen.findAllByText('読み込んでいます')).length).toBeGreaterThan(0)
    resolveList({ success: true, data: [] })
    expect((await screen.findAllByText('まだタグがありません')).length).toBeGreaterThan(0)
    cleanup()

    state.tags = async () => ({ success: false, error: 'boom' })
    render(<TagsPageV4 accountId="account-a" />)
    expect((await screen.findAllByText('表示できませんでした')).length).toBeGreaterThan(0)
    await waitFor(() => {
      expect(screen.queryByText('まだタグがありません')).toBeNull()
    })
  })
})
