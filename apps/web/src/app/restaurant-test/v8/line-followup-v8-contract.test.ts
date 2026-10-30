// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), publish: vi.fn(), start: vi.fn(), stop: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/v8/restaurant/common-a/public/frame/index', () => ({ RestaurantFrame: ({ children }: { children: (ctx: unknown) => React.ReactNode }) => children({ store: { id: 'store-1', name: '試験店' } }) }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ status: 'ready', enabled: () => true, features: { friend_fields: true, common_vars: true } }) }))
vi.mock('@/components/scenarios/scenario-reference-data', () => ({ scenarioReferenceData: { friendFields: async () => ({ success: true, data: [] }), commonVars: async () => ({ success: true, data: [] }) } }))
vi.mock('@/lib/api/helpers/restaurant-followup', async original => ({
  ...await original<typeof import('@/lib/api/helpers/restaurant-followup')>(),
  fetchRestaurantFollowup: fixture.read, saveFollowupMessages: fixture.save,
  publishFollowupScenario: fixture.publish, requestFollowupStart: fixture.start,
  stopFollowup: fixture.stop, fetchFollowupReviewHistory: async () => [],
}))
import LineFollowupV8 from '@/v8/restaurant/line-followup/line-followup'

const bubble = { id: 'body-1', type: 'text', content: { text: 'ありがとうございました' } }
const live = {
  storeId: 'store-1', storeName: '試験店', scenarioId: 'scenario-1', templateVersion: 3,
  sendingStatus: 'stopped', approvalId: null, reviewInvitations: null,
  steps: [{ trigger: 'post_visit', state: 'stopped', offsetMinutes: 180, bubbles: [bubble],
    binding: { store_id: 'store-1', trigger: 'post_visit', step_id: 'step-1', offset_minutes: 180, enabled: 0, version: 1 },
    step: { id: 'step-1', scenarioId: 'scenario-1', messageType: 'text', messageContent: '', messageBubbles: [bubble] },
  }],
}
beforeEach(() => {
  fixture.read.mockResolvedValue(live)
  fixture.save.mockResolvedValue({ success: true, data: {} })
  fixture.publish.mockResolvedValue({ success: true, data: {} })
  fixture.start.mockResolvedValue({ success: true, data: { approvalId: 'approval-1', sendingStatus: 'pending' } })
  fixture.stop.mockResolvedValue({ success: true, data: { sendingStatus: 'stopped' } })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

async function openPostVisit() {
  render(React.createElement(LineFollowupV8))
  fireEvent.click(await screen.findByRole('button', { name: '来店後' }))
}

describe('LINE来店フォローの接続後の契約', () => {
  it('7つの行を保ち、来店後を開くと保存済みの時期と本文を描く', async () => {
    await openPostVisit()
    for (const name of ['予約完了時', '予約の前日', '予約の2時間前', '来店後', '口コミ依頼', '順番案内', '記念日前']) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(screen.getByRole('button', { name: '来店後' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('退店から 3時間後')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '本文' }).textContent).toBe('ありがとうございました')
    expect(fixture.read).toHaveBeenCalledWith('account-1', 'store-1', '試験店')
  })
  it('本文を現在の版と一緒に新しい保存口へ送り、選んだ行を変えない', async () => {
    await openPostVisit()
    const body = screen.getByRole('textbox', { name: '本文' })
    await act(async () => { body.textContent = 'またお待ちしています'; fireEvent.input(body) })
    fireEvent.click(screen.getByRole('button', { name: '本文を保存する' }))
    await waitFor(() => expect(fixture.save).toHaveBeenCalledWith('account-1', 'store-1', 'step-1', { expectedVersion: 3, messageBubbles: [{ ...bubble, content: { text: 'またお待ちしています' } }] }))
    await waitFor(() => expect(screen.getByRole('button', { name: '来店後' }).getAttribute('aria-expanded')).toBe('true'))
  })
  it('本送信は公開と再取得を経て承認を申請し、停止の口も使える', async () => {
    await openPostVisit()
    expect(screen.getByText('本送信は止めています（中身の版: 3）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '承認を申請する' }))
    await waitFor(() => expect(fixture.start).toHaveBeenCalledWith('account-1', 'store-1', 3))
    expect(fixture.publish).toHaveBeenCalledWith('scenario-1')
    expect(fixture.read.mock.invocationCallOrder[1]).toBeGreaterThan(fixture.publish.mock.invocationCallOrder[0]!)
    expect(fixture.start.mock.invocationCallOrder[0]).toBeGreaterThan(fixture.read.mock.invocationCallOrder[1]!)
    fireEvent.click(await screen.findByRole('button', { name: '本送信を止める' }))
    await waitFor(() => expect(fixture.stop).toHaveBeenCalledWith('account-1', 'store-1'))
  })
})
