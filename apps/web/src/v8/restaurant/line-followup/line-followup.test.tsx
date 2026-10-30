// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BroadcastBubble, RestaurantFollowupTrigger } from '@line-crm/shared'
import { ApiError } from '@/lib/api/transport/errors'

const fixture = vi.hoisted(() => ({
  snapshot: vi.fn(), role: 'owner' as string | null,
  fetchLive: vi.fn(), saveMessages: vi.fn(), saveBinding: vi.fn(),
  publishScenario: vi.fn(), requestStart: vi.fn(), stop: vi.fn(), reviewHistory: vi.fn(),
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
vi.mock('@/components/shared/entity-select', () => import('@/test-utils/entity-select-mock'))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => fixture.role, canManageRole: (role: string | null) => role === 'owner' || role === 'admin' }))
vi.mock('@/lib/api/helpers/restaurant-followup', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/helpers/restaurant-followup')>()
  return {
    ...original,
    fetchRestaurantFollowup: fixture.fetchLive,
    saveFollowupMessages: fixture.saveMessages,
    saveFollowupBinding: fixture.saveBinding,
    publishFollowupScenario: fixture.publishScenario,
    requestFollowupStart: fixture.requestStart,
    stopFollowup: fixture.stop,
    fetchFollowupReviewHistory: fixture.reviewHistory,
  }
})
import LineFollowupV8 from './line-followup'
import { RESTAURANT_TRIGGER_ROWS, exactTiming, timingError, timingLabel } from './config'

const bubble = (text: string, id = 'b1'): BroadcastBubble => ({ id, type: 'text', content: { text } })
const stepOf = (trigger: RestaurantFollowupTrigger, offset: number, enabled: 0 | 1, texts: string[] | null) => ({
  trigger,
  binding: { store_id: 'store', trigger, step_id: `step-${trigger}`, offset_minutes: offset, enabled, version: 1 },
  step: {
    id: `step-${trigger}`, scenarioId: 'scn-1', messageType: 'text', messageContent: '',
    messageBubbles: texts === null ? [] : texts.map((text, index) => bubble(text, `b${index + 1}`)),
  },
  bubbles: texts === null ? [] : texts.map((text, index) => bubble(text, `b${index + 1}`)),
  offsetMinutes: offset,
  state: 'stopped' as const,
})
const liveOf = (overrides: Record<string, unknown> = {}) => ({
  storeId: 'store', storeName: '試験店', scenarioId: 'scn-1', templateVersion: 3,
  sendingStatus: 'stopped', approvalId: null, reviewInvitations: null,
  steps: [
    stepOf('reservation_created', 0, 1, ['予約完了の文']),
    stepOf('reservation_24h', -1440, 1, ['前日の文']),
    stepOf('reservation_2h', -120, 0, ['2時間前の文']),
    stepOf('post_visit', 180, 0, ['来店後の文']),
    stepOf('review_request', 1440, 0, ['口コミの文']),
    stepOf('waitlist_invited', 0, 0, ['順番の文']),
    stepOf('anniversary_before', -10080, 0, ['記念日の文']),
  ],
  ...overrides,
})
const storeOf = (id: string, name: string) => ({ id, name, code: 'S', status: 'active', line_account_id: 'account-1', line_account_name: `${name} 公式` })
const data = {
  organization: { id: 'org', name: '試験組織' },
  stores: [storeOf('store', '試験店')],
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
  fixture.publishScenario.mockResolvedValue({ success: true, data: { scenarioId: 'scn-1', versionId: 'v-1', versionNumber: 2, publishedAt: '2026-10-30T00:00:00.000Z' } })
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
  it('既存の時期は割り切れる一番大きい単位で正確に分ける', () => {
    expect(exactTiming(1440, ['minutes', 'hours', 'days'])).toEqual({ amount: '1', unit: 'days' })
    expect(exactTiming(180, ['minutes', 'hours', 'days'])).toEqual({ amount: '3', unit: 'hours' })
    expect(exactTiming(181, ['minutes', 'hours', 'days'])).toEqual({ amount: '181', unit: 'minutes' })
    expect(exactTiming(90, ['minutes', 'hours'])).toEqual({ amount: '90', unit: 'minutes' })
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
    expect(fixture.fetchLive).toHaveBeenCalledWith('account-1', 'store', '試験店')
  })
  it('オン/オフで結びを版付きで保存する', async () => {
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    // 予約完了時はオンなので「止める」を押す。
    fireEvent.click(screen.getByRole('button', { name: '止める' }))
    await waitFor(() => expect(fixture.saveBinding).toHaveBeenCalledWith('account-1', 'store', 'step-reservation_created', 'PATCH', {
      expectedVersion: 3, trigger: 'reservation_created', offsetMinutes: 0, enabled: false,
    }))
  })
  it('時期は数値と単位から分に直して保存する', async () => {
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約の前日' })
    fireEvent.click(screen.getByRole('button', { name: '予約の前日' }))
    const amount = screen.getByRole('textbox', { name: '時期の数値' }) as HTMLInputElement
    expect(amount.value).toBe('1')
    fireEvent.change(amount, { target: { value: '2' } })
    // 単位は既存値からの「日」のまま。2日前 = -2880分。
    fireEvent.click(screen.getByRole('button', { name: '時期を保存する' }))
    await waitFor(() => expect(fixture.saveBinding).toHaveBeenCalledWith('account-1', 'store', 'step-reservation_24h', 'PATCH', {
      expectedVersion: 3, trigger: 'reservation_24h', offsetMinutes: -2880, enabled: true,
    }))
  })
  it('割り切れない既存の時期は分で正確に出し、そのまま保存できる', async () => {
    const live = liveOf()
    live.steps = live.steps.map(step => step.trigger === 'review_request' ? { ...step, offsetMinutes: 181, binding: { ...step.binding, offset_minutes: 181 } } : step)
    fixture.fetchLive.mockResolvedValue(live)
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '口コミ依頼' })
    fireEvent.click(screen.getByRole('button', { name: '口コミ依頼' }))
    expect((screen.getByRole('textbox', { name: '時期の数値' }) as HTMLInputElement).value).toBe('181')
    fireEvent.click(screen.getByRole('button', { name: '時期を保存する' }))
    await waitFor(() => expect(fixture.saveBinding).toHaveBeenCalledWith('account-1', 'store', 'step-review_request', 'PATCH', {
      expectedVersion: 3, trigger: 'review_request', offsetMinutes: 181, enabled: false,
    }))
  })
  it('本文を版付きで保存する', async () => {
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    await typeBody('新しい本文')
    fireEvent.click(screen.getByRole('button', { name: '本文を保存する' }))
    await waitFor(() => expect(fixture.saveMessages).toHaveBeenCalledWith('account-1', 'store', 'step-reservation_created', {
      expectedVersion: 3, messageBubbles: [bubble('新しい本文')],
    }))
  })
  it('2通以上の本文は後続を保ったまま直して保存する', async () => {
    const live = liveOf()
    live.steps = live.steps.map(step => step.trigger === 'post_visit'
      ? { ...step, bubbles: [bubble('1通目', 'b1'), bubble('2通目', 'b2')] }
      : step)
    fixture.fetchLive.mockResolvedValue(live)
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '来店後' })
    fireEvent.click(screen.getByRole('button', { name: '来店後' }))
    const second = screen.getByRole('textbox', { name: '2通目の本文' })
    await act(async () => { second.textContent = '直した2通目'; fireEvent.input(second) })
    fireEvent.click(screen.getByRole('button', { name: '本文を保存する' }))
    await waitFor(() => expect(fixture.saveMessages).toHaveBeenCalledWith('account-1', 'store', 'step-post_visit', {
      expectedVersion: 3, messageBubbles: [bubble('1通目', 'b1'), bubble('直した2通目', 'b2')],
    }))
  })
  it('吹き出しの中の画像は消さず、見え方に未対応の説明を出す', async () => {
    const image = { id: 'b2', type: 'image', content: { originalContentUrl: 'https://example.test/o.jpg', previewImageUrl: 'https://example.test/p.jpg' } }
    const live = liveOf()
    live.steps = live.steps.map(step => step.trigger === 'post_visit'
      ? { ...step, bubbles: [bubble('1通目', 'b1'), image as BroadcastBubble] }
      : step)
    fixture.fetchLive.mockResolvedValue(live)
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '来店後' })
    fireEvent.click(screen.getByRole('button', { name: '来店後' }))
    expect(screen.getByText('（画像はこの画面では見られません）')).toBeTruthy()
    // 保存しても画像の通は保つ。
    fireEvent.click(screen.getByRole('button', { name: '本文を保存する' }))
    await waitFor(() => expect(fixture.saveMessages).toHaveBeenCalledWith('account-1', 'store', 'step-post_visit', {
      expectedVersion: 3, messageBubbles: [bubble('1通目', 'b1'), image],
    }))
  })
  it('テキスト以外の古い本文は空欄に見せず編集を止める', async () => {
    const live = liveOf()
    live.steps = live.steps.map(step => step.trigger === 'reservation_24h'
      ? { ...step, bubbles: [], step: { ...step.step, messageType: 'flex', messageContent: '{"type":"bubble"}', messageBubbles: null } }
      : step)
    fixture.fetchLive.mockResolvedValue(live)
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約の前日' })
    fireEvent.click(screen.getByRole('button', { name: '予約の前日' }))
    expect(screen.getByText('この本文はテキスト以外の形のため、この画面では直せません。本体のシナリオ画面で直してください')).toBeTruthy()
    expect((screen.getByRole('button', { name: '本文を保存する' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('くわしく設定する → は本体のシナリオへ飛ぶ', async () => {
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    expect(screen.getByRole('link', { name: 'くわしく設定する →' }).getAttribute('href')).toBe('/scenarios/detail?id=scn-1')
  })
  it('承認の申請と停止ができる', async () => {
    // 公開で版が3→4に増える再現。
    fixture.fetchLive.mockResolvedValueOnce(liveOf()).mockResolvedValue(liveOf({ templateVersion: 4 }))
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    fireEvent.click(screen.getByRole('button', { name: '承認を申請する' }))
    // 申請の前に本体を公開し、増えた版を取り直してから申請する。
    await waitFor(() => expect(fixture.publishScenario).toHaveBeenCalledWith('scn-1'))
    await waitFor(() => expect(fixture.requestStart).toHaveBeenCalledWith('account-1', 'store', 4))
    // 申請後は読み直すので、終わってから止めるを押す。
    fireEvent.click(await screen.findByRole('button', { name: '本送信を止める' }))
    await waitFor(() => expect(fixture.stop).toHaveBeenCalledWith('account-1', 'store'))
  })
  it('公開と申請の間にほかの担当者が変えたら申請を止める', async () => {
    const changed = liveOf({ templateVersion: 4 })
    changed.steps = changed.steps.map(step => step.trigger === 'reservation_created'
      ? {
        ...step,
        bubbles: [bubble('ほかの担当者の文')],
        step: { ...step.step, messageBubbles: [bubble('ほかの担当者の文')] },
      }
      : step)
    fixture.fetchLive.mockResolvedValueOnce(liveOf()).mockResolvedValue(changed)
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    fireEvent.click(screen.getByRole('button', { name: '承認を申請する' }))
    expect(await screen.findByText('ほかの担当者が先に保存しました。公開した中身と変わったため申請を止めました。読み直しました。')).toBeTruthy()
    expect(fixture.requestStart).not.toHaveBeenCalled()
  })
  it('旧形式のFlexが変わっても申請を止める（吹き出しは空のまま）', async () => {
    const base = liveOf({ templateVersion: 4 })
    base.steps = base.steps.map(step => step.trigger === 'reservation_24h'
      ? { ...step, bubbles: [], step: { ...step.step, messageType: 'flex', messageContent: '{"a":1}', messageBubbles: null } }
      : step)
    const changed = liveOf({ templateVersion: 5 })
    changed.steps = changed.steps.map(step => step.trigger === 'reservation_24h'
      ? { ...step, bubbles: [], step: { ...step.step, messageType: 'flex', messageContent: '{"a":2}', messageBubbles: null } }
      : step)
    fixture.fetchLive.mockResolvedValueOnce(base).mockResolvedValue(changed)
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    fireEvent.click(screen.getByRole('button', { name: '承認を申請する' }))
    expect(await screen.findByText('ほかの担当者が先に保存しました。公開した中身と変わったため申請を止めました。読み直しました。')).toBeTruthy()
    expect(fixture.requestStart).not.toHaveBeenCalled()
  })
  it('公開に失敗したら申請を出さない', async () => {
    fixture.publishScenario.mockResolvedValueOnce({ success: false, error: '公開できません' })
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    fireEvent.click(screen.getByRole('button', { name: '承認を申請する' }))
    expect(await screen.findByText('公開できません')).toBeTruthy()
    expect(fixture.requestStart).not.toHaveBeenCalled()
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
  it('閲覧のみは操作を隠さず灰色＋理由にする', async () => {
    fixture.role = 'staff'
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    // 隠さず置き、押せなくする。鍵付きは理由を読めるよう aria-disabled 運用。
    expect(screen.getByRole('button', { name: '承認を申請する' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('button', { name: '本送信を止める' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('button', { name: '止める' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getAllByText('閲覧のみのため変えられません').length).toBeGreaterThan(0)
    expect((screen.getByRole('textbox', { name: '本文' }) as HTMLTextAreaElement).readOnly).toBe(true)
  })
  it('役割が読めない時は閲覧のみと断定せず理由なしで止める', async () => {
    fixture.role = null
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    expect((screen.getByRole('button', { name: '止める' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '承認を申請する' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText('閲覧のみのため変えられません')).toBeNull()
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

describe('失敗と競合', () => {
  it('409は読み直しても知らせを保つ', async () => {
    fixture.saveBinding.mockRejectedValueOnce(new ApiError(409))
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    fireEvent.click(screen.getByRole('button', { name: '止める' }))
    expect(await screen.findByText('ほかの担当者が先に保存しました。読み直しました。')).toBeTruthy()
    // 読み直しが終わっても知らせは残る。
    await waitFor(() => expect(fixture.fetchLive).toHaveBeenCalledTimes(2))
    expect(screen.getByText('ほかの担当者が先に保存しました。読み直しました。')).toBeTruthy()
  })
  it('申請の409は版のずれを言う（未公開は直前の公開で解消済み）', async () => {
    fixture.requestStart.mockRejectedValueOnce(new ApiError(409))
    render(<LineFollowupV8 />)
    await screen.findByRole('button', { name: '予約完了時' })
    fireEvent.click(screen.getByRole('button', { name: '承認を申請する' }))
    expect(await screen.findByText('承認を申請できませんでした。ほかの担当者が先に保存しました。読み直しました。')).toBeTruthy()
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

it('店を切り替えると別の店の下書きは持ち込まない', async () => {
  fixture.snapshot.mockResolvedValue({ data: { ...data, stores: [storeOf('store', '試験店'), storeOf('store-2', '二号店')] } })
  fixture.fetchLive.mockImplementation(async (_accountId: string, storeId: string) => liveOf({
    storeId, storeName: storeId === 'store-2' ? '二号店' : '試験店',
    steps: liveOf().steps.map(step => step.trigger === 'reservation_created'
      ? { ...step, bubbles: [bubble(storeId === 'store-2' ? '二号店の文' : '予約完了の文')] }
      : step),
  }))
  render(<LineFollowupV8 />)
  await screen.findByRole('button', { name: '予約完了時' })
  expect(screen.getByRole('textbox', { name: '本文' }).textContent).toContain('予約完了の文')
  await typeBody('試験店で編集中')
  fireEvent.change(screen.getByRole('combobox', { name: '店舗' }), { target: { value: 'store-2' } })
  await waitFor(() => expect(screen.getByRole('textbox', { name: '本文' }).textContent).toContain('二号店の文'))
  expect(screen.getByRole('textbox', { name: '本文' }).textContent).not.toContain('試験店で編集中')
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
