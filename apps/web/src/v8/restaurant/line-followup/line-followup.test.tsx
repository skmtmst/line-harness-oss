// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BroadcastBubble, RestaurantFollowupTrigger } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({
  snapshot: vi.fn(), role: 'owner' as string | null,
  fetchLive: vi.fn(), saveMessages: vi.fn(), saveBinding: vi.fn(),
  requestStart: vi.fn(), stop: vi.fn(), reviewHistory: vi.fn(),
}))
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
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: { snapshot: fixture.snapshot } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => fixture.role, canManageRole: (role: string | null) => role === 'owner' || role === 'admin' }))
vi.mock('@/lib/api/helpers/restaurant-followup', () => ({
  fetchRestaurantFollowup: fixture.fetchLive,
  saveFollowupMessages: fixture.saveMessages,
  saveFollowupBinding: fixture.saveBinding,
  requestFollowupStart: fixture.requestStart,
  stopFollowup: fixture.stop,
  fetchFollowupReviewHistory: fixture.reviewHistory,
}))
import LineFollowupV8 from './line-followup'
import { RESTAURANT_TRIGGER_ROWS, timingError, timingLabel } from './config'

const bubble = (text: string): BroadcastBubble => ({ id: 'b1', type: 'text', content: { text } })
const stepOf = (trigger: RestaurantFollowupTrigger, offset: number, enabled: 0 | 1, text: string | null) => ({
  trigger,
  binding: { store_id: 'store', trigger, step_id: `step-${trigger}`, offset_minutes: offset, enabled, version: 1 },
  step: { id: `step-${trigger}`, scenarioId: 'scn-1' },
  bubbles: text === null ? [] : [bubble(text)],
  offsetMinutes: offset,
  state: 'stopped' as const,
})
const liveOf = (overrides: Record<string, unknown> = {}) => ({
  storeId: 'store', storeName: '試験店', scenarioId: 'scn-1', templateVersion: 3,
  sendingStatus: 'stopped', approvalId: null, reviewInvitations: null,
  steps: [
    stepOf('reservation_created', 0, 1, '予約完了の文'),
    stepOf('reservation_24h', -1440, 1, '前日の文'),
    stepOf('reservation_2h', -120, 0, '2時間前の文'),
    stepOf('post_visit', 180, 0, '来店後の文'),
    stepOf('review_request', 1440, 0, '口コミの文'),
    stepOf('waitlist_invited', 0, 0, '順番の文'),
    stepOf('anniversary_before', -10080, 0, '記念日の文'),
  ],
  ...overrides,
})
const data = {
  organization: { id: 'org', name: '試験組織' },
  stores: [{ id: 'store', name: '試験店', code: 'S', status: 'active', line_account_id: 'account-1', line_account_name: '試験店 公式' }],
  lineFlows: [],
  memberships: [], reservations: [], tables: [], inventory: [], menuItems: [], connectors: [], reviews: [], posts: [], approvals: [],
}

beforeEach(() => {
  fixture.role = 'owner'
  fixture.snapshot.mockResolvedValue({ data })
  fixture.fetchLive.mockResolvedValue(liveOf())
  fixture.reviewHistory.mockResolvedValue([])
  fixture.saveMessages.mockResolvedValue({ success: true, data: {} })
  fixture.saveBinding.mockResolvedValue({ success: true, data: { stopped: true } })
  fixture.requestStart.mockResolvedValue({ success: true, data: { approvalId: 'ap-1', sendingStatus: 'pending' } })
  fixture.stop.mockResolvedValue({ success: true, data: { sendingStatus: 'stopped' } })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

const typeBody = async (text: string) => {
  const box = screen.getByRole('textbox', { name: '本文' })
  await act(async () => { box.textContent = text; fireEvent.input(box) })
}

describe('時期の言い方と検査', () => {
  it('7つの行の言い方が決まりどおり', () => {
    expect(timingLabel('reservation_created', 0)).toBe('予約が入ったらすぐ')
    expect(timingLabel('reservation_24h', -1440)).toBe('1日前')
    expect(timingLabel('reservation_2h', -120)).toBe('2時間前')
    expect(timingLabel('post_visit', 180)).toBe('退店から 3時間後')
    expect(timingLabel('review_request', 1440)).toBe('退店から 1日後')
    expect(timingLabel('waitlist_invited', 0)).toBe('空きが出たらすぐ')
    expect(timingLabel('anniversary_before', -10080)).toBe('記念日の7日前')
    expect(timingLabel('post_visit', null)).toBe('時期がまだありません')
  })
  it('鯖と同じ時期の規則（前なら負・後なら0以上）', () => {
    expect(timingError('reservation_24h', 60)).toContain('0より小さい')
    expect(timingError('post_visit', -1)).toContain('0以上')
    expect(timingError('reservation_24h', -1440)).toBeNull()
    expect(timingError('post_visit', 180)).toBeNull()
    expect(timingError('reservation_created', 0)).toBeNull()
    // 記念日の行はいまの鯖ではどの値も通らない。
    expect(timingError('anniversary_before', -10080)).not.toBeNull()
    expect(timingError('anniversary_before', 10080)).not.toBeNull()
  })
  it('行の定義は7つで飲食の順に並ぶ', () => {
    expect(RESTAURANT_TRIGGER_ROWS.map(row => row.trigger)).toEqual([
      'reservation_created', 'reservation_24h', 'reservation_2h', 'post_visit',
      'review_request', 'waitlist_invited', 'anniversary_before',
    ])
  })
})

describe('7つの行と状態', () => {
  it('7行が並び、選んだ行の中身が開く', async () => {
    render(<LineFollowupV8 />)
    expect(await screen.findByRole('button', { name: '予約完了時' })).toBeTruthy()
    for (const row of RESTAURANT_TRIGGER_ROWS) {
      expect(screen.getByRole('button', { name: row.name })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: '予約完了時' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('予約完了時 の中身')).toBeTruthy()
    expect(screen.getByText('本送信は止めています（中身の版: 3）')).toBeTruthy()
  })
  it('オン/オフで結びを版付きで保存する', async () => {
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    // 予約完了時はオンなので「止める」を押す。
    fireEvent.click(screen.getByRole('button', { name: '止める' }))
    await waitFor(() => expect(fixture.saveBinding).toHaveBeenCalledWith('store', 'step-reservation_created', 'PATCH', {
      expectedVersion: 3, trigger: 'reservation_created', offsetMinutes: 0, enabled: false,
    }))
  })
  it('時期は数値と単位から分に直して保存する', async () => {
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約の前日' })
    fireEvent.click(screen.getByRole('button', { name: '予約の前日' }))
    const amount = screen.getByRole('textbox', { name: '時期の数値' }) as HTMLInputElement
    fireEvent.change(amount, { target: { value: '2' } })
    // 単位は既定の「時間」のまま。2時間前 = -120分。
    fireEvent.click(screen.getByRole('button', { name: '時期を保存する' }))
    await waitFor(() => expect(fixture.saveBinding).toHaveBeenCalledWith('store', 'step-reservation_24h', 'PATCH', {
      expectedVersion: 3, trigger: 'reservation_24h', offsetMinutes: -120, enabled: true,
    }))
  })
  it('本文を版付きで保存する', async () => {
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    await typeBody('新しい本文')
    fireEvent.click(screen.getByRole('button', { name: '本文を保存する' }))
    await waitFor(() => expect(fixture.saveMessages).toHaveBeenCalledWith('store', 'step-reservation_created', {
      expectedVersion: 3, messageBubbles: [bubble('新しい本文')],
    }))
  })
  it('くわしく設定する → は本体のシナリオへ飛ぶ', async () => {
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    expect(screen.getByRole('link', { name: 'くわしく設定する →' }).getAttribute('href')).toBe('/scenarios/detail?id=scn-1')
  })
  it('承認の申請と停止ができる', async () => {
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    fireEvent.click(screen.getByRole('button', { name: '承認を申請する' }))
    await waitFor(() => expect(fixture.requestStart).toHaveBeenCalledWith('store', 3))
    fireEvent.click(screen.getByRole('button', { name: '本送信を止める' }))
    await waitFor(() => expect(fixture.stop).toHaveBeenCalledWith('store'))
  })
  it('承認の申請中は状態の行から承認画面へ飛べる', async () => {
    fixture.fetchLive.mockResolvedValue(liveOf({ sendingStatus: 'pending', approvalId: 'ap-1' }))
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    expect(screen.getByRole('link', { name: '承認を待っています（中身の版: 3）→' }).getAttribute('href')).toBe('/restaurant-test/approvals')
  })
  it('口コミ依頼の行に送信履歴の件数が出る', async () => {
    fixture.reviewHistory.mockResolvedValue([{ source_job_id: 'j1' }, { source_job_id: 'j2' }])
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '口コミ依頼' })
    fireEvent.click(screen.getByRole('button', { name: '口コミ依頼' }))
    expect(await screen.findByText('送信履歴 2件')).toBeTruthy()
  })
})

describe('変えられない理由の表示', () => {
  it('閲覧のみは操作を置かず理由を出す', async () => {
    fixture.role = 'staff'
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    expect(screen.queryByRole('button', { name: '承認を申請する' })).toBeNull()
    expect(screen.queryByRole('button', { name: '本送信を止める' })).toBeNull()
    expect((screen.getByRole('button', { name: '止める' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText('閲覧のみのため変えられません').length).toBeGreaterThan(0)
    expect((screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement).readOnly).toBe(true)
  })
  it('まだ無い店舗は見本を出し、保存系は置かない', async () => {
    fixture.fetchLive.mockResolvedValue(null)
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    expect(screen.getByText('この店のフォローの設定はまだありません。表の文は見本です。')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement).readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: '本文を保存する' })).toBeNull()
    expect(screen.queryByRole('button', { name: '承認を申請する' })).toBeNull()
  })
  it('記念日前の行はオンと時期を止め、本文だけ直せる', async () => {
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '記念日前' })
    fireEvent.click(screen.getByRole('button', { name: '記念日前' }))
    const toggle = screen.getByRole('button', { name: '送る' }) as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
    expect(screen.getByText('記念日前の始まりはサーバーの口がまだないため、オンと時期は変えられません')).toBeTruthy()
    expect((screen.getByRole('button', { name: '時期を保存する' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '本文を保存する' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('結びの無い行は理由を出して変えさせない', async () => {
    const live = liveOf()
    live.steps = live.steps.map(step => step.trigger === 'post_visit'
      ? { ...step, binding: null, step: null, bubbles: [], offsetMinutes: null, state: 'stopped' as const }
      : step)
    fixture.fetchLive.mockResolvedValue(live)
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '来店後' })
    fireEvent.click(screen.getByRole('button', { name: '来店後' }))
    expect(screen.getByText('本体の一歩がまだないため、この行は変えられません')).toBeTruthy()
    expect(screen.getByText('本体の一歩がまだないため、本文は変えられません')).toBeTruthy()
    // 結びの無い行の札は「止めています」ではなく「まだありません」。
    expect(screen.getAllByText('まだありません').length).toBeGreaterThan(0)
  })
})

it('行を切り替えても未保存の入力を保つ', async () => {
  render(<LineFollowupV8 />)
  await screen.findByRole('button', { name: '予約完了時' })
  await typeBody('編集中の本文')
  fireEvent.click(screen.getByRole('button', { name: '来店後' }))
  expect(screen.getByRole('textbox', { name: '本文' }).textContent).toContain('来店後の文')
  fireEvent.click(screen.getByRole('button', { name: '予約完了時' }))
  expect(screen.getByRole('textbox', { name: '本文' }).textContent).toContain('編集中の本文')
})

// 118: 開いた行は押している途中の灰にせず、白のまま開いている印（左の緑の線・右端の ⌃）で示す。
it('開いた行は白のまま開いている印が出る（選んだ札の灰にしない）', async () => {
  const { container } = render(<LineFollowupV8 />)
  await screen.findByRole('button', { name: '予約完了時' })
  const openCards = container.querySelectorAll('[data-design-part="card"][data-open]')
  expect(openCards.length).toBe(1)
  expect(openCards[0]?.getAttribute('data-card-selected')).toBeNull()
  expect(container.querySelectorAll('[data-design-part="card"][data-card-selected]').length).toBe(0)
  expect(container.querySelectorAll('[data-flow-chevron]').length).toBe(7)
  expect(container.querySelectorAll('[data-flow-chevron][data-open]').length).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: '来店後' }))
  expect(container.querySelectorAll('[data-design-part="card"][data-open]').length).toBe(1)
})

// 決まり2: いつも同じ説明は帯にせず、題の横の「？」へ入れる。
it('ひな形の説明は帯に出さず題の「？」に入れる', async () => {
  render(<LineFollowupV8 />)
  await screen.findByRole('button', { name: '予約完了時' })
  expect(screen.queryByText(/シナリオのひな形/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'LINE来店フォローの説明' }))
  expect(await screen.findByText(/シナリオのひな形/)).toBeTruthy()
})
