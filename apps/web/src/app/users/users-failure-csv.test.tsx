// @vitest-environment happy-dom
/*
 * 監査 WEB322/323：統合ユーザーの一覧が読めなかったとき、人数を 0 と言わない。
 * CSV は画面の件数（読めていないと 0）を信じず、1ページ目から読み直して最後まで集める。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/users',
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      usersGrouped: { ...actual.api.usersGrouped, list: fixture.list },
      lineAccounts: { ...actual.api.lineAccounts, list: () => Promise.resolve({ success: true, data: [] }) },
      duplicates: { ...actual.api.duplicates, stats: () => Promise.resolve({ success: false, error: 'x' }) },
    },
  }
})

const { useMergedUsers } = await import('./use-merged-users')
const { default: UsersV8 } = await import('./users-v8')

const person = (id: string) => ({
  id, displayName: `人${id}`, emails: [], phones: [], accounts: [{ accountName: 'A' }],
  identityKeyKind: 'uid', lastActivityAt: '2026-10-01T00:00:00Z',
})

beforeEach(() => {
  fixture.list.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('統合ユーザーの失敗と0件（WEB322）', () => {
  it('一覧が読めなかったとき、数の帯と件数に 0人を出さない', async () => {
    fixture.list.mockRejectedValue(new Error('down'))
    render(<UsersV8 />)
    await waitFor(() => expect(screen.getByText('—人')).toBeTruthy())
    const kpis = document.body.textContent ?? ''
    expect(kpis).not.toContain('0人')
  })
})

describe('統合ユーザーのCSV（WEB323）', () => {
  it('画面の件数が読めていなくても、書き出しは API から読み直す', async () => {
    const created = vi.fn(() => 'blob:x')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => undefined }))
    fixture.list
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ success: true, data: { rows: [person('1'), person('2')], total: 2 } })
    const { result } = renderHook(() => useMergedUsers())
    await waitFor(() => expect(result.current.error).not.toBe(''))
    expect(result.current.total).toBe(0)
    await act(async () => { await result.current.exportCsv() })
    expect(fixture.list.mock.calls.some((call) => (call[0] as { pageSize?: number }).pageSize === 200)).toBe(true)
    expect(created).toHaveBeenCalledTimes(1)
    const blob = (created.mock.calls[0] as unknown as [Blob])[0]
    expect(await blob.text()).toContain('人1')
  })
})
