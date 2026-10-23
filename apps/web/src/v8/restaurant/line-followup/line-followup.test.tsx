// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), updateLineFlow: vi.fn(), role: 'owner' as string | null }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [] }) }))
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({
    status: 'ready',
    features: { friend_fields: true, common_vars: true },
    enabled: () => true,
  }),
}))
vi.mock('@/components/scenarios/scenario-reference-data', () => ({
  scenarioReferenceData: {
    friendFields: async () => ({ success: true, data: [] }),
    commonVars: async () => ({ success: true, data: [] }),
  },
}))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: { snapshot: fixture.snapshot, updateLineFlow: fixture.updateLineFlow } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => fixture.role, canManageRole: (role: string | null) => role === 'owner' || role === 'admin' }))
import LineFollowupV8, { timingLabel } from './line-followup'

const flow = (id: string, flow_type: string, timing_minutes: number | null) => ({ id, store_id: null, flow_type, title: `${id}の題`, body: `${id}の本文`, timing_minutes, is_enabled: 1, delivery_mode: 'preview_only' as const })
const data = {
  organization: { id: 'org', name: '試験組織' },
  stores: [{ id: 'store', name: '試験店', code: 'S', status: 'active', line_account_id: 'account-1', line_account_name: '試験店 公式' }],
  lineFlows: [flow('f1', 'reservation_24h', -1440), flow('f2', 'post_visit', 180)],
  memberships: [], reservations: [], tables: [], inventory: [], menuItems: [], connectors: [], reviews: [], posts: [], approvals: [],
}

beforeEach(() => {
  fixture.role = 'owner'
  fixture.snapshot.mockResolvedValue({ data })
  fixture.updateLineFlow.mockResolvedValue({ success: true })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

const typeBody = async (text: string) => {
  const box = screen.getByRole('textbox', { name: '本文' })
  await act(async () => { box.textContent = text; fireEvent.input(box) })
}

describe('配信のときの言い方', () => {
  it('前は「時間前」、来店後は「退店から」、無いときは常設', () => {
    expect(timingLabel(flow('a', 'reservation_24h', -1440))).toBe('24時間前')
    expect(timingLabel(flow('a', 'post_visit', 180))).toBe('退店から 3時間後')
    expect(timingLabel(flow('a', 'post_visit', 90))).toBe('退店から 90分後')
    expect(timingLabel(flow('a', 'review_request', 1440))).toBe('24時間後')
    expect(timingLabel(flow('a', 'member_card', null))).toBe('常設')
  })
})

it('フローを行で並べ、選んだ行の中身（題と本文）を下書きとして保存する（送らない）', async () => {
  render(<LineFollowupV8 />)
  expect(await screen.findByRole('button', { name: '予約 24時間前' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '来店後（退店のきっかけ）' })).toBeTruthy()
  expect(screen.getAllByText('確認用')).toHaveLength(2)
  expect(screen.getByText('予約 24時間前 の中身')).toBeTruthy()
  // 吹き出しの枠は共通の部品の1通だけの形。押しても保存できない追加・テンプレートの操作は置かない。
  expect(screen.queryByRole('button', { name: /メッセージを追加する/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /テンプレートから選ぶ/ })).toBeNull()
  const title = screen.getByRole('textbox', { name: 'タイトル' })
  fireEvent.change(title, { target: { value: '新しい題' } })
  expect(screen.getAllByText('新しい題').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
  await waitFor(() => expect(fixture.updateLineFlow).toHaveBeenCalledWith('account-1', 'f1', { title: '新しい題', body: 'f1の本文' }))
})

it('閲覧のみには「下書きを保存する」を置かず、本文は読むだけ', async () => {
  fixture.role = 'staff'
  render(<LineFollowupV8 />)
  expect(await screen.findByRole('button', { name: '予約 24時間前' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '下書きを保存する' })).toBeNull()
  expect((screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement).readOnly).toBe(true)
})

it('行を切り替えても未保存の入力を保ち、選んだフローだけを保存する', async () => {
  const { container } = render(<LineFollowupV8 />)
  await screen.findByRole('button', { name: '予約 24時間前' })
  expect(screen.getByRole('button', { name: '予約 24時間前' }).getAttribute('aria-expanded')).toBe('true')
  await typeBody('編集中の本文')
  fireEvent.click(screen.getByRole('button', { name: '来店後（退店のきっかけ）' }))
  expect(screen.getByRole('button', { name: '来店後（退店のきっかけ）' }).getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('button', { name: '予約 24時間前' }).getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByRole('textbox', { name: '本文' }).textContent).toContain('f2の本文')
  fireEvent.click(screen.getByRole('button', { name: '予約 24時間前' }))
  expect(screen.getByRole('textbox', { name: '本文' }).textContent).toContain('編集中の本文')
  fireEvent.click(screen.getByRole('button', { name: 'LINEでの見え方' }))
  expect(screen.getByRole('button', { name: 'LINEでの見え方' }).getAttribute('aria-expanded')).toBe('true')
  expect(container.querySelectorAll('[data-line-preview-part="device-frame"]')).toHaveLength(1)
  expect(container.querySelector('[data-line-preview-part="talk"]')?.textContent).toContain('編集中の本文')
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
  await waitFor(() => expect(fixture.updateLineFlow).toHaveBeenCalledWith('account-1', 'f1', { title: 'f1の題', body: '編集中の本文' }))
})
