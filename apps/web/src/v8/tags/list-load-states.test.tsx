// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushListUrlState } from '@/components/shared/list-url-state'

const net = vi.hoisted(() => ({ tags: vi.fn(), groups: vi.fn(), marks: vi.fn(), searches: vi.fn() }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'A' }) }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    tags: { ...actual.api.tags, list: net.tags }, tagGroups: { ...actual.api.tagGroups, list: net.groups },
    supportMarks: { ...actual.api.supportMarks, list: net.marks }, savedSearches: { ...actual.api.savedSearches, list: net.searches },
    listStats: { get: async () => ({ success: false }) },
    scenarios: { list: async () => ({ success: true, data: [] }) }, friendFields: { list: async () => ({ success: true, data: [] }) },
  } }
})
import { ApiError } from '@/lib/api'
import TagsTab from './tags-tab'
import MarksTab from './marks-tab'
import SearchesTab from './searches-tab'

const variants = [
  { name: 'タグ', load: net.tags, component: (accountId: string, canEdit = false) => <TagsTab accountId={accountId} canEdit={canEdit} narrow={false} csvOpen={false} onCsvClose={() => {}} />, empty: 'まだタグがありません', row: { id: 'tag-a', name: 'Aのタグ', friendCount: 5, displayOrder: 0 }, create: '最初のタグを作る' },
  { name: '対応マーク', load: net.marks, component: (accountId: string, canEdit = false) => <MarksTab accountId={accountId} canEdit={canEdit} />, empty: 'まだ対応マークはありません', row: { id: 'mark-a', name: 'Aの対応マーク', color: '#888', friendCount: 5, displayOrder: 0, automationRules: [] }, create: 'マークを作る' },
  { name: '保存した検索', load: net.searches, component: (accountId: string, canEdit = false) => <SearchesTab accountId={accountId} canEdit={canEdit} />, empty: 'まだ保存した検索はありません', row: { id: 'search-a', name: 'Aの保存した検索', matchCount: 5, conditions: { all: [] }, usedIn: [], displayOrder: 0 }, create: '友だち一覧で条件を作る' },
]
const answer = (items: unknown[]) => ({ success: true, data: items, items, summary: { total: items.length, usedInBroadcasts: 0, zeroMatches: 0, callsThisMonth: 0 } })
function deferred() {
  let resolve!: (value: ReturnType<typeof answer>) => void
  const promise = new Promise<ReturnType<typeof answer>>(yes => { resolve = yes })
  return { promise, resolve }
}
beforeEach(() => {
  flushListUrlState()
  window.history.replaceState(null, '', '/tags')
  for (const load of Object.values(net)) load.mockReset().mockResolvedValue(answer([]))
  document.documentElement.dataset.theme = 'v8'
})
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

// 旧契約のstatus/setItemsなどの文字一致を、読込・失敗・権限・別店舗の描画へ置換する。
describe.each(variants)('$name の読込状態', variant => {
  it('初回は未取得として扱い、成功した0件だけを空と表示する', async () => {
    const pending = deferred()
    variant.load.mockReturnValueOnce(pending.promise)
    render(variant.component('A'))
    expect(screen.queryByText(variant.empty)).toBeNull()
    expect(document.querySelector('[data-list-state="empty"]')).toBeNull()
    const numbers = [...document.querySelectorAll('[data-kpi-number]')].map(node => node.textContent)
    expect(numbers.length).toBeGreaterThan(0)
    expect(numbers.every(number => number === '—')).toBe(true)
    await act(async () => pending.resolve(answer([])))
    await screen.findByText(variant.empty)
    expect(screen.queryByRole('link', { name: variant.create })).toBeNull()
    expect(screen.queryByRole('button', { name: variant.create })).toBeNull()
  })

  it.each([500, 403])('失敗%sは空と混ぜず、通信失敗は再試行で回復する', async status => {
    variant.load.mockRejectedValueOnce(new ApiError(status, 'private error'))
    render(variant.component('A'))
    await screen.findByText(status === 403 ? `${variant.name}を見る権限がありません` : `${variant.name}を読み込めませんでした`)
    expect(screen.queryByText(variant.empty)).toBeNull()
    expect(document.querySelector('[data-list-state="empty"]')).toBeNull()
    const numbers = [...document.querySelectorAll('[data-kpi-number]')].map(node => node.textContent)
    expect(numbers.length).toBeGreaterThan(0)
    expect(numbers.every(number => number === '—')).toBe(true)
    const retry = screen.queryByRole('button', { name: 'もう一度読み込む' })
    if (status !== 403) {
      expect(retry).not.toBeNull()
      fireEvent.click(retry!)
      await screen.findByText(variant.empty)
    }
  })

  it('アカウント変更で旧行・フォルダ・件数を隠し、遅延応答も採用しない', async () => {
    const first = deferred(), second = deferred()
    variant.load.mockResolvedValueOnce(answer([variant.row])).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    net.groups.mockResolvedValue(answer([{ id: 'group-a', name: 'Aのフォルダ' }]))
    const view = render(variant.component('A'))
    await waitFor(() => expect(document.querySelector('tbody')?.textContent).toContain(variant.row.name))
    view.rerender(variant.component('B'))
    expect(document.querySelector('tbody')?.textContent ?? '').not.toContain(variant.row.name)
    if (variant.name === 'タグ') expect(screen.queryByText('Aのフォルダ')).toBeNull()
    view.rerender(variant.component('C'))
    await act(async () => second.resolve(answer([{ ...variant.row, id: 'c', name: 'Cの行' }])))
    await waitFor(() => expect(document.querySelector('tbody')?.textContent).toContain('Cの行'))
    await act(async () => first.resolve(answer([{ ...variant.row, id: 'b', name: 'Bの遅い行' }])))
    expect(screen.queryByText('Bの遅い行')).toBeNull()
    expect(document.querySelector('tbody')?.textContent).toContain('Cの行')
  })
})
