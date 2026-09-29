// @vitest-environment happy-dom
/*
 * #1052 STAFF-01: 「項目ごとに決める」の説明文と読み上げ名を権限の実態へそろえる。
 *
 * 実物の StaffPage をマウントして確かめる。
 *   - 全行の3択が「変えられる／見えるだけ／出さない」で、説明文はその段階で
 *     実際にできることだけを書く（閲覧は配信・返信・変更を許さない）
 *   - 読み上げ名（aria-label）に機能名＋段階＋説明を含め、同一行で重複しない
 *   - 「個人情報」だけは機能ではなく見せ方を選ぶ行なので、
 *     「そのまま見せる／伏せて見せる／見せない」の例外表記になる
 *   - 選んだ段階は aria-pressed と permissionScope の保存値に一致する
 */
import React from 'react'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  updateStaff: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/staff',
  useSearchParams: () => new URLSearchParams('tab=members'),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: null }) }))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => <nav aria-label="ログインユーザーのタブ" />,
  useMergedTab: () => 'members',
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/components/staff/login-audit', () => ({ default: () => <div /> }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('') } }))

function member(overrides: Partial<StaffMember>): StaffMember {
  return {
    id: 'target', name: '対象者', email: 'target@example.test', role: 'staff',
    lineLinked: false, twoFactorEnabled: false, isActive: true, permissionKeys: ['/chats'],
    notificationPreferences: {}, inviteStatus: 'active',
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    assignedLineAccountId: null, canAccessDescendantAccounts: false, ...overrides,
  }
}

function accessUser(overrides: Record<string, unknown>) {
  return {
    id: 'target', name: '対象者', email: 'target@example.test', jobTitle: null,
    roleBundle: 'operations', featureCount: 3, hasFieldMasks: false,
    accountScope: { type: 'all', assignedLineAccountId: null, lineAccountIds: [], includesDescendants: false },
    lastLoginAt: '2026-09-01T00:00:00.000Z', lastActionAt: null, mfaEnabled: false,
    status: 'active', policyVersion: 1,
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const state = {
  members: [member({}), member({ id: 'me', name: 'ログイン中の人', email: 'me@example.test', role: 'admin' })],
  users: [
    accessUser({}),
    accessUser({ id: 'me', name: 'ログイン中の人', email: 'me@example.test', roleBundle: 'administrator' }),
  ],
}

vi.mock('@/lib/api', () => {
  class ApiError extends Error {}
  return {
    ApiError,
    fetchApi: vi.fn(),
    api: {
      staff: {
        list: async () => ({ success: true, data: state.members }),
        me: async () => ({ success: true, data: state.members.find((item) => item.id === 'me')! }),
        update: fixture.updateStaff,
        loginSummary: async () => ({ success: true, data: { loginCount: 1 } }),
      },
      lineAccounts: { list: async () => ({ success: true, data: [] }) },
      access: {
        users: async () => ({
          success: true,
          data: {
            items: state.users,
            summary: {
              active: 2, invited: 0, expiredInvitations: 0, unused90Days: 0, mfaEnabled: 0, mfaRate: 0,
              roleCounts: { administrator: 1, operations: 1, reception: 0, view_only: 0, custom: 0 },
            },
            pagination: { total: state.users.length, limit: 200, offset: 0 },
          },
        }),
        roles: async () => ({ success: true, data: { items: [] } }),
      },
      audit: { events: async () => ({ success: true, data: { items: [] } }) },
    },
  }
})

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { default: StaffPage } = await import('./page')

/* [機能名, edit の説明, view の説明, none の説明] の期待表。SCOPE_ROWS の正本と同じ順。 */
const EXPECTED_ROWS = [
  ['友だち', '追加・変更できる', '見るだけ', '見せない'],
  ['個人情報', 'すべて表示', '一部を伏せて表示', '見せない'],
  ['配信', '作成・配信できる', '見るだけ', '見せない'],
  ['受信箱', '返信できる', '見るだけ', '見せない'],
  ['予約', '受付・変更できる', '見るだけ', '見せない'],
  ['予約メニュー', '変更できる', '見るだけ', '見せない'],
  ['予約設定', '変更できる', '見るだけ', '見せない'],
  ['本人の勤務', '変更できる', '見るだけ', '見せない'],
  ['分析', '承認・変更できる', '見るだけ', '見せない'],
  ['設定', '変更できる', '見るだけ', '見せない'],
  ['運用状態', '操作できる', '見るだけ', '見せない'],
] as const

const STANDARD_LEVEL_LABELS = ['変えられる', '見えるだけ', '出さない'] as const
const MASK_LEVEL_LABELS = ['そのまま見せる', '伏せて見せる', '見せない'] as const

function expectedName(label: string, levelLabel: string, description: string): string {
  return `${label}：${levelLabel}（${description}）`
}

function scopeGroup(label: string): HTMLElement {
  const group = screen.getByRole('group', { name: `${label}の見せ方` })
  return group as HTMLElement
}

async function openPermissionView() {
  await act(async () => { render(<StaffPage />) })
  await waitFor(() => expect(screen.getByText('対象者')).toBeTruthy())
  fireEvent.click(within(screen.getByText('対象者').closest('tr') as HTMLTableRowElement).getByRole('button', { name: '中身を見る' }))
  await waitFor(() => expect(screen.getByText('項目ごとに決める')).toBeTruthy())
}

beforeEach(() => {
  fixture.updateStaff.mockReset().mockResolvedValue({ success: true, data: state.members[0] })
  state.users[0] = accessUser({})
})

afterEach(() => cleanup())

describe('「項目ごとに決める」の説明文と読み上げ名 (STAFF-01)', () => {
  it('全行・3段階の見た目の説明と読み上げ名が権限の実態と一致する', async () => {
    await openPermissionView()

    for (const [label, edit, view, none] of EXPECTED_ROWS) {
      const group = scopeGroup(label)
      const levelLabels = label === '個人情報' ? MASK_LEVEL_LABELS : STANDARD_LEVEL_LABELS
      const names = [
        expectedName(label, levelLabels[0], edit),
        expectedName(label, levelLabels[1], view),
        expectedName(label, levelLabels[2], none),
      ]
      const buttons = names.map((name) => within(group).getByRole('button', { name }) as HTMLButtonElement)
      // 3択それぞれが存在し、読み上げ名が行内で重複しない
      expect(new Set(names).size).toBe(3)
      for (const button of buttons) {
        expect(button.getAttribute('aria-pressed')).not.toBeNull()
      }
    }
  })

  it('「見えるだけ」は配信・返信・変更を許さない説明になり、「出さない」は見せないと書く', async () => {
    await openPermissionView()

    // 監査で指摘された組み合わせ: 配信の閲覧に「作成・配信」、受信箱に「返信できる」、
    // 予約に「変更できる」、分析・運用状態の非表示に「見られる」と出していた。
    expect(within(scopeGroup('配信')).getByRole('button', { name: '配信：見えるだけ（見るだけ）' })).toBeTruthy()
    expect(within(scopeGroup('配信')).queryByRole('button', { name: /配信.*見えるだけ.*作成/ })).toBeNull()
    expect(within(scopeGroup('受信箱')).getByRole('button', { name: '受信箱：見えるだけ（見るだけ）' })).toBeTruthy()
    expect(within(scopeGroup('予約')).getByRole('button', { name: '予約：見えるだけ（見るだけ）' })).toBeTruthy()
    expect(within(scopeGroup('分析')).getByRole('button', { name: '分析：出さない（見せない）' })).toBeTruthy()
    expect(within(scopeGroup('運用状態')).getByRole('button', { name: '運用状態：出さない（見せない）' })).toBeTruthy()
  })

  it('「個人情報」行だけは見せ方の3択になる', async () => {
    await openPermissionView()

    const group = scopeGroup('個人情報')
    expect(within(group).getByRole('button', { name: '個人情報：そのまま見せる（すべて表示）' })).toBeTruthy()
    expect(within(group).getByRole('button', { name: '個人情報：伏せて見せる（一部を伏せて表示）' })).toBeTruthy()
    expect(within(group).getByRole('button', { name: '個人情報：見せない（見せない）' })).toBeTruthy()
    // 機能のON/OFFの言い方はこの行に使わない
    expect(within(group).queryByRole('button', { name: /個人情報：変えられる/ })).toBeNull()
    // 案内文にも例外を明記する
    expect(screen.getByText(/「個人情報」は機能ではなくメールなどの見せ方を選ぶので/)).toBeTruthy()
  })

  it('選んだ段階が保存する権限（permissionScope）と一致する', async () => {
    await openPermissionView()

    // 「運用」プリセットで配信は edit。閲覧へ変えると view として保存される。
    fireEvent.click(screen.getByRole('button', { name: '配信：見えるだけ（見るだけ）' }))
    fireEvent.click(screen.getByRole('button', { name: /見せる範囲を保存/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(fixture.updateStaff).toHaveBeenCalledTimes(1))
    const [, payload] = fixture.updateStaff.mock.calls[0] as unknown as [string, { permissionScope?: Record<string, string> }]
    expect(payload.permissionScope?.delivery).toBe('view')
  })
})
