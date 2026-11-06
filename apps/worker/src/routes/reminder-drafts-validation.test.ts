import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  createDraft: vi.fn(),
}))

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
}))
vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  createReminderWithDraftVersion: mocks.createDraft,
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
    stopConditions: {},
    steps: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.canAccess.mockResolvedValue(true)
})

describe('リマインダ下書きの入力検証', () => {
  /*
   * REMINDER-07: ひな形なしの新規作成は通知0件の下書きとして保存する。
   * 空本文の通を1件こしらえて送ると422で基本設定から先へ進めなかった。
   * 0件は未完成の下書きとして許し、公開・送信の必須検査は公開口で行う。
   */
  it('通知0件の下書きを作成できる', async () => {
    mocks.createDraft.mockResolvedValue({
      reminder: { id: 'r-new', name: '予約前のお知らせ', created_at: '2026-09-22T00:00:00.000Z' },
      version: {
        id: 'v-1',
        reminder_id: 'r-new',
        version_number: 1,
        status: 'draft',
        settings_snapshot: JSON.stringify(draft()),
        last_test_status: null,
        last_tested_at: null,
        published_at: null,
      },
    })
    const response = await createApp({}).request('/api/reminders/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft({ steps: [] })),
    })

    expect(response.status).toBe(201)
    expect(mocks.createDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ steps: [] }),
    )
  })

  it('基準日のずらし方が30日を超える下書きを保存しない', async () => {
    const response = await createApp({}).request('/api/reminders/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft({ triggerOffsetMinutes: 43_201 })),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      success: false,
      error: '基準日からのずらし方は前後30日以内で指定してください',
    })
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })

  it('時刻として読めない値を保存しない', async () => {
    const response = await createApp({}).request('/api/reminders/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft({ sendAtTime: '25:00' })),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, error: '送る時刻はHH:MMで指定してください' })
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })

  it('別アカウントのタグを配信対象として保存しない', async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(null) })),
      })),
    }
    const response = await createApp(db).request('/api/reminders/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft({ targetTagId: 'tag-other-account' })),
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ success: false, error: '対象タグが見つかりません' })
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })
})
