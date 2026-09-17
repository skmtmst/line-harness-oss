import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  createDraft: vi.fn(),
  saveDraft: vi.fn(),
  getDraft: vi.fn(),
  getReminder: vi.fn(),
}))

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
}))
vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  createReminderWithDraftVersion: mocks.createDraft,
  saveReminderDraftVersion: mocks.saveDraft,
  getReminderDraftVersion: mocks.getDraft,
  getReminderById: mocks.getReminder,
}))

const { reminders } = await import('./reminders.js')

function createApp(db: unknown) {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', role: 'owner', tenantId: 'tenant-a' })
    c.env = { DB: db }
    await next()
  })
  app.route('/', reminders)
  return app
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    name: '予約前のお知らせ',
    lineAccountId: 'account-1',
    triggerType: 'booking',
    deliveryMode: 'time',
    triggerOffsetMinutes: null,
    sendAtTime: null,
    targetTagId: null,
    folderId: null,
    stopConditions: { bookingCancelled: true, supportMarkCompleted: false, daysAfterTarget: 7, friendBlocked: true },
    steps: [
      { stableStepId: 's-1', offsetMinutes: 0, offsetDays: -1, sendAtTime: '18:00', messageType: 'text', messageContent: '前日です' },
    ],
    ...overrides,
  }
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    reminder_id: 'r-1',
    version_number: 1,
    status: 'draft',
    settings_snapshot: JSON.stringify(draft()),
    last_test_status: null,
    last_tested_at: null,
    last_tested_by_staff_id: null,
    published_at: null,
    published_by_staff_id: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function reminderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    name: '予約前のお知らせ',
    line_account_id: 'account-1',
    trigger_type: 'booking',
    deleted_at: null,
    ...overrides,
  }
}

/**
 * 参照存在チェック用の最小DB。events への問い合わせだけ結果を差し替える。
 * その他の SELECT は件数0を返す (対象者数の集計に使われる)。
 */
function dbWithEvent(event: { id: string } | null) {
  return {
    prepare(query: string) {
      return {
        bind() {
          return {
            async first() {
              if (query.includes('FROM events')) return event
              if (query.includes('COUNT')) return { count: 3 }
              return null
            },
            async all() { return { results: [] } },
            async run() { return { meta: { changes: 1 } } },
          }
        },
      }
    },
    async batch() { return [] },
  } as unknown as D1Database
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.canAccess.mockResolvedValue(true)
  mocks.getDraft.mockResolvedValue(versionRow())
  mocks.getReminder.mockResolvedValue(reminderRow())
})

describe('通知ステップの複数通保存', () => {
  it('2通目以降を含む配列をstableStepIdつきでそのまま保存する', async () => {
    mocks.saveDraft.mockResolvedValue(versionRow())
    const body = draft({
      steps: [
        { stableStepId: 's-1', offsetMinutes: 0, offsetDays: -1, sendAtTime: '18:00', messageType: 'text', messageContent: '前日です' },
        { stableStepId: 's-2', offsetMinutes: 0, offsetDays: 0, sendAtTime: '09:00', messageType: 'text', messageContent: '当日です' },
        { stableStepId: 's-3', offsetMinutes: 0, offsetDays: -7, sendAtTime: '10:00', messageType: 'text', messageContent: '1週間前です' },
      ],
    })
    const response = await createApp(dbWithEvent(null)).request('/api/reminders/r-1/draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(response.status).toBe(200)
    const saved = mocks.saveDraft.mock.calls[0][1] as { steps: Array<{ stableStepId: string; messageContent: string }> }
    // 引数は (db, reminderId, settings, options)
    const settings = mocks.saveDraft.mock.calls[0][2] as { steps: Array<{ stableStepId: string; messageContent: string }> }
    expect(settings.steps.map((step) => step.stableStepId)).toEqual(['s-1', 's-2', 's-3'])
    expect(settings.steps.map((step) => step.messageContent)).toEqual(['前日です', '当日です', '1週間前です'])
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1)
  })

  it('stableStepIdが重複したステップは保存しない', async () => {
    const body = draft({
      steps: [
        { stableStepId: 's-1', offsetMinutes: 0, messageType: 'text', messageContent: '1' },
        { stableStepId: 's-1', offsetMinutes: 0, messageType: 'text', messageContent: '2' },
      ],
    })
    const response = await createApp(dbWithEvent(null)).request('/api/reminders/r-1/draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, error: '同じ通知ステップIDが重複しています' })
    expect(mocks.saveDraft).not.toHaveBeenCalled()
  })
})

describe('下書き保存の楽観ロック', () => {
  it('expectedVersionIdを保存層へ渡す', async () => {
    mocks.saveDraft.mockResolvedValue(versionRow())
    const response = await createApp(dbWithEvent(null)).request('/api/reminders/r-1/draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...draft(), expectedVersionId: 'version-1' }),
    })
    expect(response.status).toBe(200)
    expect(mocks.saveDraft).toHaveBeenCalledWith(
      expect.anything(), 'r-1', expect.anything(), { expectedVersionId: 'version-1' },
    )
  })

  it('版がずれていたら409で止め、上書きしない', async () => {
    mocks.saveDraft.mockRejectedValue(new Error('REMINDER_DRAFT_CONFLICT'))
    const response = await createApp(dbWithEvent(null)).request('/api/reminders/r-1/draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...draft(), expectedVersionId: 'version-old' }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'この下書きは別の画面で先に更新されました。最新の内容を読み込み直してください',
    })
  })
})

describe('イベント起点の公開前チェック', () => {
  it('イベント未選択のイベント起点は検査を通さない', async () => {
    mocks.getDraft.mockResolvedValue(versionRow({
      settings_snapshot: JSON.stringify(draft({ triggerType: 'event', triggerEventId: null })),
    }))
    const response = await createApp(dbWithEvent(null)).request('/api/reminders/r-1/validate', {
      method: 'POST',
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { valid: boolean; checks: Array<{ key: string; status: string; message: string }> } }
    const triggerCheck = body.data.checks.find((item) => item.key === 'trigger_field')
    expect(triggerCheck).toMatchObject({ status: 'failed', message: '基準日にするイベントを選んでください' })
    expect(body.data.valid).toBe(false)
  })

  it('イベントを選んだイベント起点は基準日チェックを通す', async () => {
    mocks.getDraft.mockResolvedValue(versionRow({
      settings_snapshot: JSON.stringify(draft({ triggerType: 'event', triggerEventId: 'event-1' })),
    }))
    const response = await createApp(dbWithEvent({ id: 'event-1' })).request('/api/reminders/r-1/validate', {
      method: 'POST',
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { checks: Array<{ key: string; status: string }> } }
    expect(body.data.checks.find((item) => item.key === 'trigger_field')?.status).toBe('passed')
  })
})

describe('イベント起点の参照検査', () => {
  it('アカウント内に存在するイベントを起点に保存できる', async () => {
    mocks.createDraft.mockResolvedValue({
      reminder: { id: 'r-new' },
      version: versionRow({ reminder_id: 'r-new' }),
    })
    const response = await createApp(dbWithEvent({ id: 'event-1' })).request('/api/reminders/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft({ triggerType: 'event', triggerEventId: 'event-1' })),
    })
    expect(response.status).toBe(201)
    const settings = mocks.createDraft.mock.calls[0][1] as { triggerEventId?: string | null }
    expect(settings.triggerEventId).toBe('event-1')
  })

  it('存在しない・別アカウントのイベントを起点に保存しない', async () => {
    const response = await createApp(dbWithEvent(null)).request('/api/reminders/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft({ triggerType: 'event', triggerEventId: 'event-other-account' })),
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      success: false,
      error: '基準日に使うイベントが見つかりません',
    })
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })
})
