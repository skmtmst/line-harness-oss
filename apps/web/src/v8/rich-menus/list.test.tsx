// @vitest-environment happy-dom
/*
 * V8 リッチメニュー一覧（src/v8）の動きの試験。
 * - 行が出る（順番・状態の札・回数）
 * - 見るだけの人には帯が出て「メニューを作る」が押せない（ZoKow）
 * - 消せないメニューの「削除」で「まだ消せません」の窓（yOyCg）：
 *   理由は短く1行ずつ・取り下げで外れる2つ（登録中・LINE上に残る）は1行にまとめる・外す操作が右に出る
 */
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type ApiResult = { success: boolean; data?: unknown }

const fixture = vi.hoisted(() => ({
  role: 'owner',
  deleteImpact: (() => Promise.resolve({ success: false })) as (id: string) => Promise<ApiResult>,
}))

const group = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  accountId: 'account-a',
  name,
  chatBarText: 'メニュー',
  size: 'large',
  defaultPageId: null,
  isDefaultForAll: false,
  status: 'published',
  publishingAt: null,
  targetingCondition: null,
  targetingPriority: 0,
  targetingEnabled: false,
  folderId: null,
  displayOrder: 0,
  defaultOpen: false,
  thumbnailR2Key: null,
  updatedAt: '2026-09-20T00:00:00.000Z',
  ...extra,
})

const items = [
  group('g-default', '通常メニュー', { isDefaultForAll: true, targetingPriority: 0 }),
  group('g-autumn', '秋のキャンペーン', { status: 'draft', isDefaultForAll: true, publishingAt: '2026-10-05T00:00:00.000+09:00', targetingPriority: 1 }),
]

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccount: { id: 'account-a', name: 'A社' } }),
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

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status = 500
  },
  api: {
    richMenuGroups: {
      listPage: () => Promise.resolve({
        success: true,
        data: {
          items,
          total: items.length,
          limit: 20,
          sort: [],
          facets: { total: items.length, published: 1, targeting: 0, folderCounts: {} },
        },
      }),
      external: () => Promise.resolve({ success: true, data: { currentDefault: null, lineMenus: [] } }),
      tapStats: () => Promise.resolve({
        success: true,
        data: { from: '2026-09-01', to: '2026-10-01', total: 12, byGroup: [{ groupId: 'g-default', taps: 12 }], byArea: [] },
      }),
      deleteImpact: (id: string) => fixture.deleteImpact(id),
      imageUrl: (key: string) => `/img/${key}`,
    },
    folders: { list: () => Promise.resolve({ success: true, data: [], unfiledCount: 0 }) },
    tags: { list: () => Promise.resolve({ success: true, data: [] }) },
    staff: {
      me: () => Promise.resolve({ success: true, data: { id: 's', name: 'S', role: fixture.role, email: null } }),
    },
  },
}))

import RichMenusListV8 from './list'

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  fixture.role = 'owner'
})

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.theme
})

describe('V8 リッチメニュー一覧', () => {
  test('行に順番・状態の札・今月の回数が出る（集計の無い行は「—」）', async () => {
    const view = render(<RichMenusListV8 />)
    const first = (await view.findByText('通常メニュー')).closest('tr') as HTMLElement
    expect(first.textContent).toContain('公開中')
    expect(first.textContent).toContain('12回')
    expect(first.textContent).toContain('（既定）')
    const second = view.getByText('秋のキャンペーン').closest('tr') as HTMLElement
    expect(second.textContent).toContain('10/5 公開')
    expect(second.textContent).toContain('10/5 から既定')
    expect(second.textContent).toContain('—')
  })

  test('見るだけの人には閲覧のみの帯が出て、メニューを作るは押せない', async () => {
    fixture.role = 'staff'
    const view = render(<RichMenusListV8 />)
    await view.findByText('閲覧のみで見ています。変える操作は管理者に頼んでください。')
    const create = view.getAllByRole('button', { name: /メニューを作る/ })
    expect(create.length).toBeGreaterThan(0)
    for (const button of create) expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  test('消せないメニューは「まだ消せません」の窓で、理由を短く・取り下げで外れる2つを1行に並べる', async () => {
    fixture.deleteImpact = (id) => Promise.resolve({
      success: true,
      data: {
        group: { id, accountId: 'account-a', name: '通常メニュー', status: 'published' },
        currentAudience: { value: 1204, state: 'available', reason: null },
        nextDisplay: { guaranteedGroupId: null, reason: 'friend_specific_rules', candidates: [] },
        incomingSwitches: [{ sourceGroupId: 'g-x', sourceGroupName: '会員ランク上位', sourcePageId: 'p', sourcePageName: 'トップ', areaId: 'a', areaLabel: null, targetPageId: 't', targetPageName: 'トップ' }],
        operationalReferences: [],
        lineResources: { pageCount: 1, pagesWithLineRichMenuId: 1, isDefaultForAll: true, publishing: false },
        blockers: ['default_for_all', 'published', 'line_resources', 'incoming_switches'],
        canDelete: false,
        recommendedAction: 'unpublish',
      },
    })
    const view = render(<RichMenusListV8 />)
    await view.findByText('通常メニュー')
    fireEvent.click(view.getByRole('button', { name: 'リッチメニュー「通常メニュー」の操作' }))
    fireEvent.click(await view.findByText('取り下げ・削除する'))
    const dialog = await view.findByRole('alertdialog')
    expect(dialog.textContent).toContain('「通常メニュー」はまだ消せません')
    expect(dialog.textContent).toContain('消すと、リッチメニューが出なくなる友だちがいます（1,204人）。先に下の順に外してください。')
    await waitFor(() => expect(dialog.querySelectorAll('li').length).toBe(3))
    const rows = [...dialog.querySelectorAll('li')].map((li) => li.textContent)
    expect(rows).toEqual([
      '1 すべての友だちの既定になっているほかのメニューを既定に',
      '2 LINEに登録されているLINEから取り下げる',
      '3 「会員ランク上位」の切替先になっている切替を外す',
    ])
    // 右上の×と、下の「閉じる」（絵どおり）。
    // 読み込み中に出ていた確認窓は閉じの動き（160ms）のあと外れる。
    await waitFor(() => expect(view.getAllByRole('button', { name: '閉じる' }).length).toBe(2))
  })
})
