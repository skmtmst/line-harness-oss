// @vitest-environment happy-dom
/*
 * 統括の友だち属性（絵 DzdC3・y0sapC・Qgjmc）：上の4つのタブ・?tab= の読み書き・受け口の無いタブの1行・
 * タグの数の帯（未使用・整理の候補）と使用状態・付け方の絞り込み。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq/friend-attributes',
}))

import HqStoreList, { type HqStoreListProps } from './store-list'
import { attributeTabOf, cleanupTagCount, matchesTagFilters, unusedTagCount } from './attribute-tabs'
import type { HqTemplate } from '@/lib/hq-templates-api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tag = (id: string, name: string, friends: number | null, method: string | null = '手動'): HqTemplate => ({
  id, name, description: null, template_type: 'tag', folder_id: null, revision: 1, updated_at: '2026-09-30T01:00:00.000Z',
  content_summary: 'タグ 1', distributed_account_count: 1, distributed_account_names: ['本店'], distributed_account_more: 0,
  friend_count: friends, assignment_method: method,
})
const ROWS = [tag('t-1', 'VIP', 64, '手動・自動'), tag('t-2', '新規', 0), tag('t-3', 'ｖｉｐ', 3)]

let host: HTMLDivElement
let root: Root
async function render(extra: Partial<HqStoreListProps> = {}) {
  const props: HqStoreListProps = {
    type: 'tag', rows: ROWS, ready: true, busy: false, canEdit: true, accountTotal: 4, folders: [], folderLoadFailed: false, folderFilter: 'all',
    onFolderFilter: vi.fn(), onAddFolder: vi.fn(async () => {}), onRenameFolder: vi.fn(async () => {}), onDeleteFolder: vi.fn(async () => {}),
    onCreate: vi.fn(), onEdit: vi.fn(), onDistribute: vi.fn(), onDuplicate: vi.fn(), onRemove: vi.fn(), ...extra,
  }
  await act(async () => { root.render(<HqStoreList {...props} />) })
}
const tabButton = (label: string) => [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent?.trim() === label) as HTMLElement | undefined

beforeEach(() => {
  replace.mockClear()
  window.history.replaceState(null, '', '/hq/friend-attributes')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('統括の友だち属性の上のタブ', () => {
  it('店と同じ4つのタブを出し、タグのタブでは一覧を出す', async () => {
    await render()
    for (const label of ['タグ', '友だち情報欄', '対応マーク', '保存した検索']) expect(tabButton(label)).toBeTruthy()
    expect(tabButton('タグ')?.getAttribute('aria-selected')).toBe('true')
    expect(document.body.textContent).toContain('VIP')
  })

  it('友だち情報欄を押すと ?tab=fields に替え（履歴を積まない）、いまどこで作るかの1行と入る口を出す', async () => {
    await render()
    await act(async () => { tabButton('友だち情報欄')?.click() })
    expect(replace).toHaveBeenCalledWith('/hq/friend-attributes?tab=fields', { scroll: false })
    expect(document.body.textContent).toContain('友だち情報欄は、いまは各アカウントの友だち属性で作ります')
    expect(document.body.textContent).not.toContain('準備中')
    expect(document.querySelector('a[href="/hq/open?target=tags"]')).toBeTruthy()
    expect(document.body.textContent).not.toContain('VIP')
  })

  it('開いたときの ?tab=marks を読む', async () => {
    window.history.replaceState(null, '', '/hq/friend-attributes?tab=marks')
    await render()
    expect(tabButton('対応マーク')?.getAttribute('aria-selected')).toBe('true')
    expect(document.body.textContent).toContain('対応マークは、いまは各アカウントの友だち属性で作ります')
  })

  it('テンプレートなどほかの種類には友だち属性のタブを出さない', async () => {
    await render({ type: 'form', rows: [] })
    expect(tabButton('友だち情報欄')).toBeUndefined()
  })

  it('知らない ?tab= はタグ', () => {
    expect(attributeTabOf('x')).toBe('tags')
    expect(attributeTabOf(null)).toBe('tags')
    expect(attributeTabOf('searches')).toBe('searches')
  })
})

describe('タグの数の帯と絞り込み', () => {
  it('未使用は友だち0人のタグ、整理の候補は未使用か名前が重なっているタグ（全角・大小をそろえる）', () => {
    expect(unusedTagCount(ROWS)).toBe(1)
    expect(cleanupTagCount(ROWS)).toBe(3)
  })

  it('人数を数えていない行があれば「—」（0 にしない）', () => {
    expect(unusedTagCount([...ROWS, tag('t-4', 'x', null)])).toBeNull()
    expect(cleanupTagCount([...ROWS, tag('t-4', 'x', null)])).toBeNull()
  })

  it('使用状態・付け方で絞る', () => {
    expect(ROWS.filter((row) => matchesTagFilters(row, 'unused', 'all')).map((row) => row.id)).toEqual(['t-2'])
    expect(ROWS.filter((row) => matchesTagFilters(row, 'used', 'all')).map((row) => row.id)).toEqual(['t-1', 't-3'])
    expect(ROWS.filter((row) => matchesTagFilters(row, 'all', '手動・自動')).map((row) => row.id)).toEqual(['t-1'])
  })

  it('数の帯は 未使用・付けている友だち・新しい版を未配布・整理の候補', async () => {
    await render()
    const text = document.body.textContent ?? ''
    for (const title of ['未使用', '付けている友だち', '新しい版を未配布', '整理の候補']) expect(text).toContain(title)
    expect(text).not.toContain('配ったアカウント')
  })
})
