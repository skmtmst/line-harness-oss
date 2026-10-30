// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../transport/errors'

const fixture = vi.hoisted(() => ({ fetchApi: vi.fn(), scenarioGet: vi.fn() }))
vi.mock('../transport/request', () => ({ fetchApi: fixture.fetchApi }))
vi.mock('../features/scenarios', () => ({ scenariosMethods: { scenarios: { get: fixture.scenarioGet } } }))
import {
  fetchFollowupReviewHistory,
  fetchRestaurantFollowup,
  isUnsupportedBody,
  publishFollowupScenario,
  requestFollowupStart,
  saveFollowupBinding,
  saveFollowupRow,
  saveFollowupMessages,
  stepBubbles,
  stopFollowup,
} from './restaurant-followup'

const page = {
  template: { store_id: 'store-sby', scenario_id: 'followup-sby', template_version: 3, sending_status: 'stopped', approved_version_id: null, approval_id: null },
  bindings: [{ store_id: 'store-sby', trigger: 'reservation_created', step_id: 'step-fc', offset_minutes: 0, enabled: 1, version: 1 }],
  jobs: [],
  editor: 'common_scenario',
}
const scenario = {
  id: 'followup-sby',
  steps: [{ id: 'step-fc', scenarioId: 'followup-sby', messageType: 'text', messageContent: '', messageBubbles: [{ id: 'b1', type: 'text', content: { text: '予約完了の文' } }] }],
}

beforeEach(() => {
  fixture.fetchApi.mockReset()
  fixture.scenarioGet.mockReset()
  fixture.fetchApi.mockResolvedValue({ success: true, data: page })
  fixture.scenarioGet.mockResolvedValue({ success: true, data: scenario })
})
afterEach(() => { vi.resetAllMocks() })

describe('口の呼び方', () => {
  it('フォローの口には account_id を付ける', async () => {
    await fetchRestaurantFollowup('account-1', 'store-sby')
    expect(fixture.fetchApi).toHaveBeenCalledWith('/api/restaurant-test/followups/store-sby?account_id=account-1')
    expect(fixture.scenarioGet).toHaveBeenCalledWith('followup-sby')
  })
  it('書き込みの口にも account_id を付ける', async () => {
    fixture.fetchApi.mockResolvedValue({ success: true, data: {} })
    await saveFollowupMessages('account-1', 'store-sby', 'step-fc', { expectedVersion: 3, messageBubbles: [] })
    expect(fixture.fetchApi).toHaveBeenCalledWith(
      '/api/restaurant-test/followups/store-sby/steps/step-fc/messages?account_id=account-1',
      { method: 'PUT', body: JSON.stringify({ expectedVersion: 3, messageBubbles: [] }) },
    )
    await saveFollowupBinding('account-1', 'store-sby', 'step-fc', 'PATCH', { expectedVersion: 3, trigger: 'reservation_created', offsetMinutes: 0, enabled: true })
    expect(fixture.fetchApi).toHaveBeenCalledWith(
      '/api/restaurant-test/followups/store-sby/bindings/step-fc?account_id=account-1',
      expect.objectContaining({ method: 'PATCH' }),
    )
    await requestFollowupStart('account-1', 'store-sby', 3)
    expect(fixture.fetchApi).toHaveBeenCalledWith(
      '/api/restaurant-test/followups/store-sby/request-start?account_id=account-1',
      { method: 'POST', body: JSON.stringify({ expectedVersion: 3 }) },
    )
    await stopFollowup('account-1', 'store-sby')
    expect(fixture.fetchApi).toHaveBeenCalledWith('/api/restaurant-test/followups/store-sby/stop?account_id=account-1', { method: 'POST' })
    await fetchFollowupReviewHistory('account-1', 'store-sby')
    expect(fixture.fetchApi).toHaveBeenCalledWith('/api/restaurant-test/followups/store-sby/review-history?account_id=account-1')
  })
  it('まだ無い店舗（404）は null', async () => {
    fixture.fetchApi.mockRejectedValueOnce(new ApiError(404))
    await expect(fetchRestaurantFollowup('account-1', 'store-new')).resolves.toBeNull()
  })
  it('公開は確認キーを付けて POST する', async () => {
    fixture.fetchApi.mockResolvedValue({ success: true, data: {} })
    await publishFollowupScenario('scn-1')
    expect(fixture.fetchApi).toHaveBeenCalledWith('/api/scenarios/scn-1/publish', {
      method: 'POST',
      headers: { 'Idempotency-Key': expect.any(String) },
      body: JSON.stringify({}),
    })
  })
})

describe('中身の読み替え', () => {
  it('吹き出しがあればそのまま', () => {
    const step = scenario.steps[0]!
    expect(stepBubbles(step as never)).toEqual(step.messageBubbles)
  })
  it('吹き出しが無く旧来のテキストがあれば1通に読み替える', () => {
    expect(stepBubbles({ id: 'step-old', messageType: 'text', messageContent: '旧来の文', messageBubbles: null } as never)).toEqual([
      { id: 'step-old-text', type: 'text', content: { text: '旧来の文' } },
    ])
  })
  it('旧来のテキスト以外は空', () => {
    expect(stepBubbles({ id: 'step-img', messageType: 'image', messageContent: '{"a":1}', messageBubbles: null } as never)).toEqual([])
    expect(stepBubbles({ id: 'step-empty', messageType: 'text', messageContent: '  ', messageBubbles: [] } as never)).toEqual([])
  })
  it('直せない本文の見分け', () => {
    expect(isUnsupportedBody({ id: 's', messageType: 'flex', messageContent: '{}', messageBubbles: null } as never)).toBe(true)
    expect(isUnsupportedBody({ id: 's', messageType: 'text', messageContent: '', messageBubbles: null } as never)).toBe(false)
    expect(isUnsupportedBody({ id: 's', messageType: 'flex', messageContent: '', messageBubbles: [{ id: 'b', type: 'text', content: { text: 'a' } }] } as never)).toBe(false)
    expect(isUnsupportedBody(null)).toBe(false)
  })
  it('7行を組み立てる', async () => {
    const live = (await fetchRestaurantFollowup('account-1', 'store-sby'))!
    expect(live.templateVersion).toBe(3)
    expect(live.steps).toHaveLength(7)
    expect(live.steps[0]).toMatchObject({ trigger: 'reservation_created', offsetMinutes: 0 })
    expect(live.steps[0]!.bubbles).toEqual([{ id: 'b1', type: 'text', content: { text: '予約完了の文' } }])
    expect(live.steps[1]).toMatchObject({ trigger: 'reservation_24h', binding: null, offsetMinutes: null })
  })
})


it('本体がまだない店は行の初期文を読み、架空のシナリオを取得しない', async () => {
  fixture.fetchApi.mockResolvedValue({ success: true, data: {
    template: null, bindings: [], jobs: [], editor: 'common_scenario',
    rows: [{ store_id: 'new', trigger: 'reservation_24h', initial_key: 'reservation_24h', step_id: null,
      version: 1, default_offset_minutes: -1440, initial_message: '明日のご予約です' }],
  } })
  const live = (await fetchRestaurantFollowup('account-1', 'new'))!
  expect(fixture.scenarioGet).not.toHaveBeenCalled()
  expect(live).toMatchObject({ scenarioId: null, templateVersion: null, sendingStatus: 'stopped' })
  expect(live.steps).toHaveLength(7)
  expect(live.steps[1]).toMatchObject({ binding: null, step: null, row: { version: 1 }, offsetMinutes: -1440, state: 'stopped' })
  expect(live.steps[1]!.bubbles[0]!.content).toEqual({ text: '明日のご予約です' })
})

it('初回オンの口にもアカウントと行の版を渡す', async () => {
  await saveFollowupRow('account-1', 'store-sby', 'anniversary_before', { expectedRowVersion: 7, enabled: true })
  expect(fixture.fetchApi).toHaveBeenCalledWith('/api/restaurant-test/followups/store-sby/rows/anniversary_before?account_id=account-1', {
    method: 'PUT', body: JSON.stringify({ expectedRowVersion: 7, enabled: true }),
  })
})
