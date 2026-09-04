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
