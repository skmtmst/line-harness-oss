// @vitest-environment happy-dom
/* #715: 友だち一覧への表示は現役の編集で保存し、版と担当を送る。
 * 一覧の星は2026-10-09に廃止。保存済みの版への進行と409の扱いを編集で守る。 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fx = vi.hoisted(() => ({ version: 1, isStarred: false, update: vi.fn() }))
vi.mock('next/navigation', async () => ({
  ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useSearchParams: () => new URLSearchParams('id=t1'),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a1' }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn(), usePageCrumbs: vi.fn() }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    tags: { ...actual.api.tags,
      definition: async () => ({ success: true, data: { tag: {
        id: 't1', name: '通常タグ', color: '#9ca3af', createdAt: '2026-09-01T00:00:00+09:00',
        lineAccountId: 'a1', status: 'active', version: fx.version, isStarred: fx.isStarred,
      }, automation: null } }),
      dependencies: async () => ({ success: true, data: { friendCount: 0, referenceCounts: {}, references: [], referenceItems: [] } }),
      retroactivePreview: async () => ({ success: true, data: null }),
      updateDefinition: fx.update,
    },
    tagGroups: { ...actual.api.tagGroups, list: async () => ({ success: true, data: [] }) },
  } }
})
import TagEdit from '@/v8/tag-edit/edit'
import { ApiError } from '@/lib/api'

beforeEach(() => {
  fx.version = 1; fx.isStarred = false; fx.update.mockReset()
  fx.update.mockImplementation(async (_id: string, _account: string, _version: number, payload: { isStarred: boolean }) => {
    fx.version += 1; fx.isStarred = payload.isStarred
    return { success: true, data: { queued: 0 } }
  })
})
afterEach(cleanup)
const setting = () => screen.getByRole('checkbox', { name: '友だち一覧に出す' }) as HTMLInputElement

describe('友だち一覧への表示設定は版付きで保存する(#715)', () => {
  it('版と担当を送り、読み直した新しい版で次の保存を送る', async () => {
    render(<TagEdit />)
    await screen.findByRole('checkbox', { name: '友だち一覧に出す' })
    fireEvent.click(setting()); fireEvent.click(screen.getByRole('button', { name: 'タグを保存する' }))
    await waitFor(() => expect(fx.update).toHaveBeenCalledWith('t1', 'a1', 1, expect.objectContaining({ isStarred: true }), expect.any(String)))
    await waitFor(() => expect((screen.getByRole('button', { name: 'タグを保存する' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(setting()); fireEvent.click(screen.getByRole('button', { name: 'タグを保存する' }))
    await waitFor(() => expect(fx.update).toHaveBeenLastCalledWith('t1', 'a1', 2, expect.objectContaining({ isStarred: false }), expect.any(String)))
  })

  it('409は保存成功とせず入力を残し、最新を読み込むと保存済みの設定へ戻る', async () => {
    fx.update.mockRejectedValueOnce(new ApiError(409, '別の人が先にタグを更新しました'))
    render(<TagEdit />)
    await screen.findByRole('checkbox', { name: '友だち一覧に出す' })
    fireEvent.click(setting()); fireEvent.click(screen.getByRole('button', { name: 'タグを保存する' }))
    await screen.findByText('ほかの人がタグ「通常タグ」を先に保存しました')
    expect(setting().checked).toBe(true)
    expect(fx.isStarred).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '最新を読み込んで続ける' }))
    await waitFor(() => expect(setting().checked).toBe(false))
    expect(screen.queryByText('ほかの人がタグ「通常タグ」を先に保存しました')).toBeNull()
  })
})
