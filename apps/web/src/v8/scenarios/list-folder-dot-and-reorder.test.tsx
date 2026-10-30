// @vitest-environment happy-dom
/*
 * 並び替えのつまみ（オーナー点検 2026-10-08）：絞り込み中は、
 * つまみを出さず理由を言う（一部の行だけで番号を振り直さない）。
 */
import React from 'react'
import type { StaffMember } from '@line-crm/shared'
import { rememberStaffIdentity, forgetStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot } from '@/lib/session-snapshot'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'

const scenario = (id: string, name: string, folderId: string | null) => ({
  id,
  name,
  description: null,
  triggerType: 'friend_add',
  triggerTagId: null,
  isActive: true,
  deliveryMode: 'relative',
  allowConcurrent: true,
  displayOrder: 0,
  folderId,
  lineAccountId: 'account-a',
  subscriberCount: 10 as number | null | undefined,
  completedCount: 2 as number | null | undefined,
  stepCount: 3,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
})

const total = vi.hoisted(() => ({ value: null as number | null }))
const reorder = vi.hoisted(() => vi.fn(async () => ({ success: true })))
const items = [
  scenario('s-filed', '新規登録7日間フォロー', 'sf-onboarding'),
  scenario('s-unfiled', '会員更新リマインド', null),
]

vi.mock('@/lib/undoable', () => ({
  runUndoable: (options: { commit: () => Promise<unknown>; onCommitted?: () => void; undo: () => void }) => {
    void options.commit().then(() => options.onCommitted?.()).catch(() => options.undo())
  },
  notifyToast: () => {},
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
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

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => 'owner', useStaffIdentity: () => ({ id: 'staff-one' }) }
})

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const api = (actual as unknown as { api: Record<string, object> }).api
  return {
    ...actual,
    api: {
      ...api,
      scenarios: {
        ...api.scenarios,
        listPage: (input: { limit?: number } = {}) => Promise.resolve({ success: true, data: { items: total.value && input.limit === 100 ? [...items, ...Array.from({ length: total.value - 2 }, (_, i) => scenario(`s-extra-${i}`, `ページ外${i}`, null))] : items, total: total.value ?? items.length, limit: input.limit ?? 20, sort: [] } }),
        reorder,
      },
      folders: {
        ...api.folders,
        list: () => Promise.resolve({
          success: true,
          data: [{ id: 'sf-onboarding', kind: 'scenario', name: '初回案内', parentId: null, displayOrder: 0, itemCount: 1, color: '#2f6fde' }],
          unfiledCount: 1,
        }),
      },
      listStats: { get: () => Promise.resolve({ success: false }) },
    },
  }
})

import ScenariosListV8 from './list'

test('配信中と最後まで配信を割らずに並べ、棒は登録した人を分母にして言葉で書く', async () => {
  const view = render(<ScenariosListV8 />)
  await view.findByText('新規登録7日間フォロー')
  expect(view.getAllByText('配信中 10 人・最後まで配信 2 人').length).toBeGreaterThan(0)
  expect(view.getAllByText('登録した 12 人の 17%').length).toBeGreaterThan(0)
  const bar = view.getAllByRole('progressbar').find((el) => el.getAttribute('aria-label')?.includes('最後まで配信した割合'))!
  expect(bar.getAttribute('aria-valuemax')).toBe('12')
  expect(bar.getAttribute('aria-valuenow')).toBe('2')
  view.unmount()
})

test('シナリオの説明本文を型へつなぎ、開閉と同じ人の保存キーを保つ', async () => {
  const stored = new Map<string, string>()
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
  } })
  try {
    const first = render(<ScenariosListV8 />)
    await first.findByText('新規登録7日間フォロー')
    const toggle = first.getByRole('button', { name: 'この画面の説明' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    const tip = document.getElementById(toggle.getAttribute('aria-describedby') ?? '')
    expect(tip?.textContent).toContain('作っただけでは送られません。')
    expect(tip?.textContent).toContain('テストを送ってから配信を始めます')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  } finally {
    cleanup()
    if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
    else Reflect.deleteProperty(window, 'localStorage')
  }
})

beforeEach(() => {
  forgetStaffIdentity(); forgetSessionSnapshot()
  rememberStaffIdentity({ id: 'scenario-owner', role: 'owner', permissionKeys: [] } as unknown as StaffMember)
})

afterEach(() => {
  forgetStaffIdentity(); forgetSessionSnapshot()
  cleanup()
  window.history.replaceState(null, '', '/scenarios')
})

describe('V8 シナリオ一覧の並び替えのつまみ', () => {
  test('絞り込みが無く全件が1ページなら、つまみを出す', async () => {
    total.value = null
    const view = render(<ScenariosListV8 />)
    await view.findByText('新規登録7日間フォロー')
    await waitFor(() => expect(view.container.querySelectorAll('button[data-reorder-handle]')).toHaveLength(2))
  })

  test('WEB-016：ページ外も含めた全順位を送り、ページ外の位置を保つ', async () => {
    total.value = 30
    reorder.mockClear()
    const view = render(<ScenariosListV8 />)
    await view.findByText('新規登録7日間フォロー')
    const handle = view.container.querySelector('button[data-reorder-handle]')!
    expect(handle).not.toBeNull()
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    await waitFor(() => expect(reorder).toHaveBeenCalledWith(['s-unfiled', 's-filed', ...Array.from({ length: 28 }, (_, i) => `s-extra-${i}`)]))
    total.value = null
  })
})

describe('V8 シナリオ一覧のフォルダの丸', () => {
  test('行の名前の前に、左のフォルダの列と同じ色の丸が付く（未分類は灰色の丸）', async () => {
    const view = render(<ScenariosListV8 />)
    const filedRow = (await view.findByText('新規登録7日間フォロー')).closest('tr') as HTMLElement
    await waitFor(() => expect(filedRow.querySelector('[data-folder-dot]')?.getAttribute('data-folder-dot')).toBe('filed'))
    expect(filedRow.querySelectorAll('[data-folder-dot]')).toHaveLength(1)
    expect(filedRow.querySelector('[data-folder-dot]')?.getAttribute('aria-label')).toBe('フォルダ：初回案内')
    const unfiledRow = view.getByText('会員更新リマインド').closest('tr') as HTMLElement
    expect(unfiledRow.querySelectorAll('[data-folder-dot]')).toHaveLength(1)
    expect(unfiledRow.querySelector('[data-folder-dot]')?.getAttribute('data-folder-dot')).toBe('unfiled')
  })
})

describe('V8 シナリオ一覧の最後まで配信した割合', () => {
  test('行ごとに配信中と最後まで配信を並べ、棒は登録した人（足した数）を分母にする', async () => {
    const view = render(<ScenariosListV8 />)
    const row = (await view.findByText('新規登録7日間フォロー')).closest('tr') as HTMLElement
    const bar = within(row).getByRole('progressbar', { name: '新規登録7日間フォローを最後まで配信した割合' })
    expect(bar.getAttribute('aria-valuenow')).toBe('2')
    expect(bar.getAttribute('aria-valuemax')).toBe('12')
    expect(row.textContent).toContain('配信中 10 人・最後まで配信 2 人')
    // 狭い列で省略されても、全文は title で読める。
    expect(row.querySelector('[title="配信中 10 人・最後まで配信 2 人"]')).not.toBeNull()
    expect(row.textContent).toContain('登録した 12 人の 17%')
    expect(row.textContent).not.toContain('2 / 10 人')
    expect(view.getByRole('columnheader', { name: '配信中・最後まで配信' })).not.toBeNull()
  })

  test.each([
    [null, null, '—', '—', null],
    [undefined, undefined, '—', '—', null],
    [null, 2, '—', '2', null],
    [10, null, '10', '—', null],
    [undefined, 0, '—', '0', null],
    [0, undefined, '0', '—', null],
    [NaN, 2, '—', '2', null],
    [10, Infinity, '10', '—', null],
    [-1, 2, '—', '2', null],
    [0, 0, '0', '0', null],
    [0, 2, '0', '2', 2],
    [10, 0, '10', '0', 10],
  ] as const)('人数%s/%sでも行と既知の片側を残し、一覧と詳細の表示をそろえる', async (active, completed, activeLabel, completedLabel, denominator) => {
    const previous = { subscriberCount: items[0].subscriberCount, completedCount: items[0].completedCount }
    Object.assign(items[0], { subscriberCount: active, completedCount: completed })
    try {
      const view = render(<ScenariosListV8 />)
      const row = (await view.findByText('新規登録7日間フォロー')).closest('tr') as HTMLElement
      const label = (value: string) => value === '—' ? value : `${value} 人`
      const expected = `配信中 ${label(activeLabel)}・最後まで配信 ${label(completedLabel)}`
      expect(view.container.querySelectorAll('tbody tr')).toHaveLength(items.length)
      expect(row.textContent).toContain(expected)
      expect(within(row).getByTitle(expected)).not.toBeNull()
      expect(within(row).queryByText('—', { exact: true })).toBeNull()
      expect(within(row).queryByText('登録した 0 人', { exact: true }) !== null).toBe(active === 0 && completed === 0)
      const bar = within(row).queryByRole('progressbar')
      if (denominator === null) {
        expect(bar).toBeNull()
        if (active === 0 && completed === 0) expect(row.textContent).toContain('登録した 0 人')
        else expect(row.textContent).not.toContain('登録した')
      } else {
        expect(bar?.getAttribute('aria-valuenow')).toBe(String(completed))
        expect(bar?.getAttribute('aria-valuemax')).toBe(String(denominator))
        expect(row.textContent).toContain(`登録した ${denominator} 人の ${Math.round(Number(completed) / denominator * 100)}%`)
      }
      expect(row.textContent).not.toMatch(/NaN|Infinity|0\s*\/\s*0/)
      expect(row.textContent).not.toContain('— 人')
      fireEvent.click(row)
      const detail = await view.findByRole('dialog', { name: '新規登録7日間フォロー', exact: true })
      expect(within(detail).getByRole('region', { name: '配信状況' }).textContent).toContain(expected)
    } finally {
      cleanup()
      Object.assign(items[0], previous)
    }
  })
})
