import { getPageAction } from '@/test-utils/page-action'
// @vitest-environment happy-dom
/*
 * 保存した検索の編集（XBkiQ）を描いて押す。
 * 保存・複製・削除はそれぞれの口へ今のアカウントで送る・使っている所と該当人数は読んだ値で出す・
 * 使用中は削除を押させず理由を言う・消せる時だけ確認の窓から削除の口を呼ぶ。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams('id=s1'), usePathname: () => '/tags/searches/edit' }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc', selectedAccount: { name: '本店' } }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))

const net = vi.hoisted(() => ({ detail: vi.fn(), update: vi.fn(), create: vi.fn(), remove: vi.fn(), preview: vi.fn() }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  const list = async () => ({ success: true, data: [] })
  return {
    ...actual,
    api: {
      ...actual.api,
      savedSearches: {
        ...actual.api.savedSearches,
        list: async () => ({ success: true, items: [], summary: { total: 3 } }),
        detail: net.detail, update: net.update, create: net.create, delete: net.remove, preview: net.preview,
      },
      tags: { list }, supportMarks: { list }, scenarios: { list }, friendFields: { list }, forms: { list }, operators: { list },
    },
  }
})

import SearchEdit from './search-edit'

type Usage = { kind: 'broadcast' | 'automation' | 'scenario' | 'other'; id: string; name: string; mode: 'live' | 'fixed' }
function detail(overrides: { usedIn?: Usage[] | undefined; canDelete?: boolean; matchCount?: number | null } = {}) {
  return {
    id: 's1', name: 'VIPかつ未契約', scope: 'friends', lineAccountId: 'acc', isShared: false, revision: 4,
    conditions: { all: [{ kind: 'name', op: 'contains', value: 'VIP' }], any: [] },
    matchCount: 'matchCount' in overrides ? overrides.matchCount : 12,
    usedIn: 'usedIn' in overrides ? overrides.usedIn : [],
    canDelete: overrides.canDelete ?? true,
    match: { total: 12, byChannel: { line: 12, mail: 0 }, calculatedAt: '', error: null },
  }
}
const sideCount = () => screen.getByRole('heading', { name: '当てはまる人' }).parentElement!.nextElementSibling!.textContent
const deleteButton = () => screen.getByRole('button', { name: '削除する' }) as HTMLButtonElement

beforeEach(() => {
  net.detail.mockResolvedValue({ success: true, data: detail() })
  net.update.mockResolvedValue({ success: true, data: detail() })
  net.create.mockResolvedValue({ success: true, data: { id: 's9' } })
  net.remove.mockResolvedValue({ success: true, data: null })
  net.preview.mockResolvedValue({ success: true, data: { match: { total: 12, byChannel: { line: 12, mail: 0 }, calculatedAt: '2026-10-01T00:00:00.000Z', error: null } } })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('保存した検索の編集', () => {
  it('今のアカウントで詳細を読み、一覧で数えた該当人数を最初から出す。条件の「かつ」「または」の意味を書く', async () => {
    render(<SearchEdit />)
    await screen.findByDisplayValue('VIPかつ未契約')
    expect(net.detail).toHaveBeenCalledWith('s1', 'acc')
    expect(net.preview).not.toHaveBeenCalled()
    expect(sideCount()).toBe('12人')
    expect(screen.getByText('「かつ」はすべて満たす人、「または」はどれかを満たす人に当てはまります。')).toBeTruthy()
  })

  it('該当人数が未集計なら数を作らない', async () => {
    net.detail.mockResolvedValue({ success: true, data: detail({ matchCount: null }) })
    render(<SearchEdit />)
    await screen.findByDisplayValue('VIPかつ未契約')
    expect(sideCount()).toBe('—人')
  })

  it('保存は読んだ版つきで更新の口へ、複製は作成の口へ送り、新しい検索の編集へ移る', async () => {
    render(<SearchEdit />)
    const name = await screen.findByDisplayValue('VIPかつ未契約')
    fireEvent.change(name, { target: { value: 'VIP（直した）' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存する' })) })
    expect(net.update).toHaveBeenCalledWith('s1', 'acc', expect.objectContaining({ name: 'VIP（直した）', expectedRevision: 4, isShared: false }))
    await act(async () => { fireEvent.click(getPageAction({ name: '複製して保存する' })) })
    expect(net.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'VIP（直した） のコピー', accountId: 'acc', isShared: false }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/tags/searches/edit?id=s9'))
  })

  it('使っている所は読んだ使用先で出し、使用中は削除を押させず理由を言う', async () => {
    net.detail.mockResolvedValue({ success: true, data: detail({ usedIn: [{ kind: 'broadcast', id: 'b1', name: '秋の案内', mode: 'live' }], canDelete: false }) })
    render(<SearchEdit />)
    await screen.findByDisplayValue('VIPかつ未契約')
    const uses = document.querySelector<HTMLElement>('dl')!
    expect(within(uses).getByText('秋の案内')).toBeTruthy()
    expect(deleteButton().disabled).toBe(true)
    expect(deleteButton().getAttribute('aria-description')).toBe('使っている所があるため削除できません（1 件）')
    fireEvent.click(deleteButton())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(net.remove).not.toHaveBeenCalled()
  })

  it('使用先が確かめられないときも削除を押させない', async () => {
    net.detail.mockResolvedValue({ success: true, data: detail({ usedIn: undefined, canDelete: false }) })
    render(<SearchEdit />)
    await screen.findByDisplayValue('VIPかつ未契約')
    expect(deleteButton().disabled).toBe(true)
    expect(deleteButton().getAttribute('aria-description')).toBe('使っている所を確かめられないため削除できません')
  })

  it('消せる検索は、サーバーで使用先なしを確かめた旨の窓から削除の口を呼び、一覧へ戻る', async () => {
    render(<SearchEdit />)
    await screen.findByDisplayValue('VIPかつ未契約')
    expect(deleteButton().disabled).toBe(false)
    fireEvent.click(deleteButton())
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('使っている所が無いことをサーバーで確かめてあります')
    expect(net.remove).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '削除する' })) })
    expect(net.remove).toHaveBeenCalledWith('s1', 'acc')
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/tags?tab=searches'))
  })
})
