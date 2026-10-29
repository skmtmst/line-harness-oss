// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 見本のリッチメニュー：使い方のスタイルを読み直せず、同じアカウントで前に読めたスタイルで出している時（stale）の 1 行（ID125・R10）。
 * 初回で分からない時（error）は今の案内のまま。編集の入口は今の条件（編集できる役割・同じアカウントとスタイルの見本）のまま。
 */

const net = vi.hoisted(() => ({
  role: 'owner' as string,
  profile: { data: { style: 'lesson' } as { style: string } | null, error: null as unknown, stale: true, status: 'ready' },
  reload: vi.fn(),
  starterSet: vi.fn(),
  starterItems: vi.fn(),
  warnings: vi.fn(),
}))

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => net.role }))
vi.mock('@/hooks/use-account-style', async original => ({
  ...await original<typeof import('@/hooks/use-account-style')>(),
  useAccountStyle: () => ({ ...net.profile, reload: net.reload }),
}))
vi.mock('@/v8/onboarding/public/use-starter-menu/index', () => ({
  useStarterMenu: () => ({ buttons: [{ label: '予約する', feature: 'booking' }, { label: 'お知らせ', feature: 'broadcasts' }], loading: false, error: null, reload: vi.fn() }),
}))
// 読むだけ。保存・変更の口は渡さない。
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: { starterSet: net.starterSet, starterItems: net.starterItems, warnings: net.warnings } }))

import RichMenuSampleV8 from './sample'
import { STALE_STYLE_TEXT } from '@/hooks/use-account-style'

const staleNotices = () => document.querySelectorAll('[data-stale-style-notice]')

describe('見本のリッチメニューの stale の 1 行（ID125）', () => {
  beforeEach(() => {
    net.role = 'owner'
    net.profile = { data: { style: 'lesson' }, error: null, stale: true, status: 'ready' }
    net.reload.mockReset()
    net.starterSet.mockReset().mockResolvedValue({ success: true, data: { definition: { items: [{ kind: 'rich_menu', name: '教室の見本' }] } } })
    net.starterItems.mockReset().mockResolvedValue({ success: true, data: { items: [{ kind: 'rich_menu', target_id: 'menu-1' }] } })
    net.warnings.mockReset().mockResolvedValue({ success: true, data: { items: [] } })
  })
  afterEach(() => cleanup())

  it('stale なら 1 行を 1 つ出し、「読み直す」はスタイルだけを読み直す。見本と編集の入口は今のまま', async () => {
    const view = render(<RichMenuSampleV8 />)
    await waitFor(() => expect(view.getByRole('link', { name: '見本を編集する' })).toBeTruthy())
    expect(staleNotices()).toHaveLength(1)
    expect(staleNotices()[0]!.textContent).toContain(`${STALE_STYLE_TEXT}。前に読めた表示で出しています。`)
    expect(view.getByRole('link', { name: '見本を編集する' }).getAttribute('href')).toBe('/rich-menus/edit?id=menu-1')
    expect(net.starterSet).toHaveBeenCalledWith('account-a', 'lesson')
    const retry = within(staleNotices()[0] as HTMLElement).getByRole('button', { name: '読み直す' })
    fireEvent.click(retry)
    expect(net.reload).toHaveBeenCalledTimes(1)
    expect(view.getAllByRole('button', { name: '読み直す' })).toHaveLength(1)
  })

  it('閲覧のみでも stale の 1 行は出すが、編集の入口は増やさない', async () => {
    net.role = 'viewer'
    const view = render(<RichMenuSampleV8 />)
    await waitFor(() => expect(net.starterItems).toHaveBeenCalled())
    expect(staleNotices()).toHaveLength(1)
    expect(view.queryByRole('link', { name: '見本を編集する' })).toBeNull()
    expect(view.queryByRole('link', { name: '画像を変える' })).toBeNull()
  })

  it('初回で分からない（error）時は今の案内のままで、stale の 1 行も編集の入口も出さない', async () => {
    net.profile = { data: null, error: new Error('x'), stale: false, status: 'error' }
    const view = render(<RichMenuSampleV8 />)
    await waitFor(() => expect(view.getAllByText('使い方を読み込めませんでした').length).toBeGreaterThan(0))
    expect(staleNotices()).toHaveLength(0)
    expect(view.queryByRole('link', { name: '見本を編集する' })).toBeNull()
    expect(net.starterSet).not.toHaveBeenCalled()
  })

  it('読めている時は 1 行を出さない', async () => {
    net.profile = { data: { style: 'lesson' }, error: null, stale: false, status: 'ready' }
    const view = render(<RichMenuSampleV8 />)
    await waitFor(() => expect(view.getByRole('link', { name: '見本を編集する' })).toBeTruthy())
    expect(staleNotices()).toHaveLength(0)
  })
})
