import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getReminderById: vi.fn(),
  listRuns: vi.fn(),
  getSummary: vi.fn(),
  getSteps: vi.fn(),
  getRun: vi.fn(),
  retryRun: vi.fn(),
}))

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
}))
vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  getReminderById: mocks.getReminderById,
  listReminderDeliveryRuns: mocks.listRuns,
  getReminderDeliveryRunSummary: mocks.getSummary,
  getReminderDeliveryStepSummaries: mocks.getSteps,
  getReminderDeliveryRunById: mocks.getRun,
  retryReminderDeliveryRun: mocks.retryRun,
}))

const { reminders } = await import('./reminders.js')

function createApp(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', role, tenantId: 'tenant-a' })
    c.env = { DB: {} }
    await next()
  })
  app.route('/', reminders)
  return app
}

const reminder = {
  id: 'reminder-1',
  name: '来店前のお知らせ',
  is_active: 1,
  line_account_id: 'account-1',
}

const run = {
  id: 'run-1',
  reminder_id: 'reminder-1',
  status: 'permanent_failed',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getReminderById.mockResolvedValue(reminder)
  mocks.listRuns.mockResolvedValue({ items: [], total: 0 })
  mocks.getSummary.mockResolvedValue({
    sent: 0,
    scheduled: 0,
    stopped: 0,
    errors: 0,
    targetCount: 0,
    nextScheduledAt: null,
  })
  mocks.getSteps.mockResolvedValue([])
  mocks.getRun.mockResolvedValue(run)
  mocks.retryRun.mockResolvedValue({ kind: 'scheduled', run: { ...run, status: 'queued' } })
})

describe('リマインダ実行記録のアカウント範囲', () => {
  it('別アカウントの実行一覧を、存在も含めて隠す', async () => {
    mocks.canAccess.mockResolvedValue(false)

    const response = await createApp().request('/api/reminders/reminder-1/runs')

    expect(response.status).toBe(404)
    expect(mocks.listRuns).not.toHaveBeenCalled()
  })

  it('見られるアカウントだけ実行一覧を返し、既読率を作らない', async () => {
    mocks.canAccess.mockResolvedValue(true)
    mocks.listRuns.mockResolvedValue({
      total: 1,
      items: [{
        id: 'run-1',
        line_account_id: 'account-1',
        account_label: '本店',
        reminder_id: 'reminder-1',
        friend_reminder_id: 'enrollment-1',
        friend_id: 'friend-1',
        friend_name: '田中さくら',
        reminder_step_id: 'step-1',
        step_number: 1,
        scheduled_at: '2026-08-28T09:00:00.000Z',
        started_at: '2026-08-28T09:00:01.000Z',
        completed_at: '2026-08-28T09:00:03.000Z',
        status: 'permanent_failed',
        attempt_count: 2,
        next_retry_at: null,
        last_error_code: 'line_rejected',
        last_error_message: '送信内容を確認してください。',
        line_request_id: null,
        message_log_id: null,
      }],
    })
    mocks.getSteps.mockResolvedValue([{
      id: 'step-1',
      offset_minutes: -60,
      message_type: 'text',
      message_content: 'ご案内です',
      sent: 0,
      errors: 0,
    }])

    const response = await createApp().request('/api/reminders/reminder-1/runs?status=succeeded')
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.data.steps[0].openRate).toBeNull()
    expect(body.data.items[0]).toMatchObject({
      ownerKind: 'reminder',
      ownerId: 'reminder-1',
      lineAccountId: 'account-1',
      occurredAt: '2026-08-28T09:00:03.000Z',
      subject: '田中さくら',
      accountLabel: '本店',
      triggerLabel: '来店前のお知らせ',
      reference: null,
      status: 'failed',
      domainStatus: 'permanent_failed',
      detail: '送信内容を確認してください。',
      durationMs: 2000,
      canRetry: true,
      messageLogId: null,
    })
    expect(mocks.listRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reminderId: 'reminder-1', status: 'succeeded' }),
    )
  })

  it('知らない状態名は検索せず400にする', async () => {
    mocks.canAccess.mockResolvedValue(true)

    const response = await createApp().request('/api/reminders/reminder-1/runs?status=sent')

    expect(response.status).toBe(400)
    expect(mocks.listRuns).not.toHaveBeenCalled()
  })

  it('配信予定は公開状態plannedを内部状態queuedへ変換して返す', async () => {
    mocks.canAccess.mockResolvedValue(true)
    mocks.listRuns.mockResolvedValue({
      total: 1,
      items: [{
        id: 'run-planned',
        line_account_id: 'account-1',
        account_label: '本店',
        reminder_id: 'reminder-1',
        friend_reminder_id: 'enrollment-1',
        friend_id: 'friend-1',
        friend_name: '田中さくら',
        reminder_step_id: 'step-1',
        step_number: 1,
        scheduled_at: '2026-09-05T09:00:00.000Z',
        started_at: null,
        completed_at: null,
        status: 'queued',
        attempt_count: 0,
        next_retry_at: null,
        last_error_code: null,
        last_error_message: null,
        line_request_id: null,
        message_log_id: null,
      }],
    })

    const response = await createApp().request(
      '/api/reminders/reminder-1/runs?status=planned',
    )
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(mocks.listRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reminderId: 'reminder-1', status: 'queued' }),
    )
    expect(body.data.items[0]).toMatchObject({
      id: 'run-planned',
      status: 'pending',
      domainStatus: 'planned',
    })
  })

  it('別アカウントの失敗実行は再試行させない', async () => {
    mocks.canAccess.mockResolvedValue(false)

    const response = await createApp().request('/api/reminder-runs/run-1/retry', {
      method: 'POST',
      headers: { 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
    })

    expect(response.status).toBe(404)
    expect(mocks.retryRun).not.toHaveBeenCalled()
  })

  it('再試行キーが無い操作を受け付けない', async () => {
    mocks.canAccess.mockResolvedValue(true)

    const response = await createApp().request('/api/reminder-runs/run-1/retry', { method: 'POST' })

    expect(response.status).toBe(400)
    expect(mocks.retryRun).not.toHaveBeenCalled()
  })

  it('同じ再試行キーの再送を、二重登録せず受付済みとして返す', async () => {
    mocks.canAccess.mockResolvedValue(true)
    mocks.retryRun.mockResolvedValue({ kind: 'replay', run: { ...run, status: 'queued' } })

    const response = await createApp().request('/api/reminder-runs/run-1/retry', {
      method: 'POST',
      headers: { 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
    })
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ id: 'run-1', status: 'queued', replayed: true })
  })
})
