// @vitest-environment happy-dom
/*
 * 統合ユーザーの頭と道具の段（操作の行は一重の枠・同じ高さ）。
 * 並べた部品がそれぞれ一覧の取り方へつながっていることを、押して確かめる。
 * - ［再計算］は最新の状態を取り直す
 * - 検索・UID 連携・所属アカウントの絞り込みは一覧の条件になる
 * 見た目（枠・高さ）は v8-screen-guard が画面を描いて見る。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fx = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/users',
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', useStaffIdentity: () => ({ name: '試験担当', role: 'owner', accountScope: 'all', permissionKeys: [] }), canManageRole: () => true }))
vi.mock('@/components/shared/select', () => ({
  default: ({ options, value, onChange, 'aria-label': label }: { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void; 'aria-label'?: string }) => (
    <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}))
vi.mock('@/components/shared/entity-select', () => import('@/test-utils/entity-select-mock'))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      usersGrouped: { ...actual.api.usersGrouped, list: fx.list },
      lineAccounts: { ...actual.api.lineAccounts, list: () => Promise.resolve({ success: true, data: [{ id: 'acc-b', name: '支店', isActive: true }] }) },
      duplicates: { ...actual.api.duplicates, stats: () => Promise.resolve({ success: false, error: 'x' }) },
    },
  }
})

const { default: UsersV8 } = await import('./users-screen')

const lastParams = () => fx.list.mock.calls.at(-1)?.[0] as Record<string, unknown>

beforeEach(() => {
  fx.list.mockReset().mockResolvedValue({ success: true, data: { rows: [], total: 0 } })
})
afterEach(() => cleanup())

it('［再計算］は最新の状態を取り直す', async () => {
  render(<UsersV8 />)
  await waitFor(() => expect(fx.list).toHaveBeenCalled())
  expect(lastParams().forceRefresh).toBeUndefined()
  fireEvent.click(screen.getByRole('button', { name: /再計算/ }))
  await waitFor(() => expect(lastParams()).toMatchObject({ forceRefresh: true }))
})

it('検索・UID連携・所属アカウントの絞り込みが一覧の条件になる', async () => {
  render(<UsersV8 />)
  await waitFor(() => expect(fx.list).toHaveBeenCalled())
  fireEvent.change(screen.getByRole('searchbox', { name: '統合ユーザーを検索' }), { target: { value: 'たなか' } })
  await waitFor(() => expect(lastParams()).toMatchObject({ q: 'たなか' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'UID連携で絞り込む' }), { target: { value: 'linked' } })
  await waitFor(() => expect(lastParams()).toMatchObject({ q: 'たなか', uid: 'linked' }))
  await screen.findByRole('option', { name: '支店' })
  fireEvent.change(screen.getByRole('combobox', { name: '所属アカウントで絞り込む' }), { target: { value: 'acc-b' } })
  await waitFor(() => expect(lastParams()).toMatchObject({ q: 'たなか', uid: 'linked', account: 'acc-b', page: 1 }))
})
