// @vitest-environment happy-dom
/**
 * ★V8 友だち属性 タグの一覧（src/v8/tags）の動きの試験。
 * 絵（I1E7Bt・aPeD8・fkGUR）の置き場に移した操作が、押せる形で残っているかを見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tag } from '@line-crm/shared'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const narrow = vi.hoisted(() => ({ value: false }))
const replaceMock = vi.hoisted(() => vi.fn())

vi.mock('next/link', () => ({
  default: ({ children, href, className, title }: { children: React.ReactNode; href: string; className?: string; title?: string }) =>
    React.createElement('a', { href, className, title }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
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

import { FRIEND_ATTRIBUTES_QA_GROUPS, FRIEND_ATTRIBUTES_QA_TAGS } from '@/components/friend-fields/tags-page-v4'
import TagsList from './list'
import { tagLinkText } from './tags-tab'

let container: HTMLDivElement
let root: Root

async function render(node: React.ReactElement) {
  await act(async () => { root.render(node) })
}

beforeEach(() => {
  role.value = 'owner'
  narrow.value = false
  replaceMock.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const fixture = { items: FRIEND_ATTRIBUTES_QA_TAGS, groups: FRIEND_ATTRIBUTES_QA_GROUPS }

describe('V8 友だち属性 タグの一覧', () => {
  it('絵の列（★・タグ・人数・付け方・連動・使っている所・操作）と4つのタブを出し、名前の前にフォルダの色の丸', async () => {
    await render(<TagsList fixture={fixture} />)
    const heads = [...container.querySelectorAll('thead th')].map((th) => th.textContent?.trim())
    // 左にフォルダの列があるので表にフォルダ列は置かない（2026-10-07 オーナー）。
    expect(heads).toEqual(['一覧に出す', 'タグ', '人数', '付け方', '連動', '使っている所', '操作'])
    expect(container.querySelectorAll('tbody [data-folder-dot]').length).toBe(FRIEND_ATTRIBUTES_QA_TAGS.length)
    for (const label of ['タグ', '友だち情報欄', '対応マーク', '保存した検索']) {
      expect(screen.getAllByRole('tab', { name: label }).length).toBeGreaterThan(0)
    }
    expect(container.querySelector('[data-design-node="I1E7Bt"]')).not.toBeNull()
    expect(screen.getByText('EC顧客連携済み')).toBeTruthy()
    expect(screen.getAllByText('1月13日（火）登録').length).toBe(FRIEND_ATTRIBUTES_QA_TAGS.length)
  })

  it('1152 の板 ID は aPeD8、閲覧のみは fkGUR で帯を出し、作る・CSV を押せない', async () => {
    narrow.value = true
    await render(<TagsList fixture={fixture} />)
    expect(container.querySelector('[data-design-node="aPeD8"]')).not.toBeNull()
    // 1152 はフォルダの列を畳むので、表にフォルダ列を出して丸は付けない（絵 aPeD8）。
    expect([...container.querySelectorAll('thead th')].map((th) => th.textContent?.trim())).toContain('フォルダ')
    expect(container.querySelectorAll('tbody [data-folder-dot]').length).toBe(0)
    await act(async () => root.unmount())
    root = createRoot(container)
    role.value = 'staff'
    narrow.value = false
    await render(<TagsList fixture={fixture} />)
    expect(container.querySelector('[data-design-node="fkGUR"]')).not.toBeNull()
    expect(screen.getByText('閲覧のみで見ています。変える操作は管理者に頼んでください。')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'CSVで一括登録する' }) as HTMLButtonElement).disabled).toBe(true)
    for (const button of screen.getAllByRole('button', { name: 'タグを作る' })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('「よく使う絞り込み」で ★のみ表示 に絞れる', async () => {
    await render(<TagsList fixture={fixture} />)
    expect(container.querySelectorAll('tbody tr').length).toBe(FRIEND_ATTRIBUTES_QA_TAGS.length)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'よく使う絞り込み' })) })
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /★のみ表示/ })) })
    const starred = FRIEND_ATTRIBUTES_QA_TAGS.filter((tag) => tag.isStarred).length
    expect(container.querySelectorAll('tbody tr').length).toBe(starred)
    expect(screen.getByRole('button', { name: /よく使う絞り込み（1件選択中）/ })).toBeTruthy()
  })

  it('タブを押すとそのタブの本文に切り替わる', async () => {
    await render(<TagsList fixture={fixture} />)
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: '対応マーク' })) })
    expect(container.querySelector('[data-design-node="vKDj5"]')).not.toBeNull()
    expect(screen.getByText('対応マークを読み込めませんでした')).toBeTruthy()
  })

  it('連動は絵の書き方（本人+10・1.2倍 他1）', () => {
    const base = { mileageReward: 0, referralMileageReward: 0, mileageMultiplierBps: null, otherActionCount: 0 } as unknown as Tag
    expect(tagLinkText({ ...base, mileageReward: 10, mileageMultiplierBps: 12000, otherActionCount: 1 } as Tag)).toBe('本人+10・1.2倍 他1')
    expect(tagLinkText({ ...base, otherActionCount: 2 } as Tag)).toBe('他2')
    expect(tagLinkText(base)).toBe('—')
  })
})
