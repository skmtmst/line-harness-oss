import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

const dbMocks = vi.hoisted(() => ({
  getReminderById: vi.fn(),
  getReminderDraftVersion: vi.fn(),
}))

const accessMocks = vi.hoisted(() => ({
  canAccessAllLineAccounts: vi.fn(),
}))

vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  ...dbMocks,
}))

vi.mock('../services/account-access.js', () => accessMocks)

const { reminders } = await import('./reminders.js')

/*
 * R15 の数え直し口 (POST /api/reminders/:id/audience) の再発防止。
 *
 * 未保存の条件で人数を数えるだけの口だが、友だちの範囲を読むので
 * 検証の口と同じ権限 (owner/admin + この店舗が見えること) で守る。
 * 数え間違いは誤送信・送り漏れに直結するので、権限・範囲・失敗を
 * 試験で固定する。
 */

const SETTINGS = {
  name: '予約前のお知らせ',
  description: null,
  lineAccountId: 'account-1',
  triggerType: 'booking',
  deliveryMode: 'time',
  triggerFieldId: null,
  triggerEventId: null,
  repeatYearly: false,
  triggerOffsetMinutes: null,
  sendAtTime: null,
  targetTagId: null,
  targetCondition: null,
  folderId: null,
  stopConditions: {
    bookingCancelled: true,
    supportMarkCompleted: false,
    daysAfterTarget: null,
    friendBlocked: true,
  },
  steps: [{
    stableStepId: 'step-1',
    offsetMinutes: -60,
    messageType: 'text',
    messageContent: '予約の1時間前です',
    offsetDays: null,
    sendAtTime: null,
    templateId: null,
    targetCondition: {},
    action: {},
  }],
} as const

const VERSION = {
  id: 'version-1',
  reminder_id: 'reminder-1',
  version_number: 1,
  status: 'draft',
  settings_snapshot: JSON.stringify(SETTINGS),
  last_test_status: null,
  last_tested_at: null,
  last_tested_by_staff_id: null,
  published_at: null,
  published_by_staff_id: null,
  created_at: '2026-09-03T09:00:00.000Z',
  updated_at: '2026-09-03T10:00:00.000Z',
} as const

const TAG_CONDITION = {
  operator: 'AND',
  rules: [{ type: 'tag_exists', value: 'tag-1' }],
  groups: [],
}

/*
 * friends だけを見る偽 D1。数え直し・顔ぶれの SQL にだけ答える。
 * total=10人 / タグ一致3人 / 条件一致4人 / 絞りなし7人(フォロー中)。
 */
function fakeFriendsDb() {
  const seen: string[] = []
  const db = {
    prepare(sql: string) {
      seen.push(sql)
      return {
        bind(...params: unknown[]) {
          void params
          return {
            first: async () => {
              if (sql.includes('COUNT(DISTINCT f.id)')) return { count: 3 }
              if (sql.includes('FROM friends f')) {
                return { count: sql.includes('friend_tags') ? 3 : 4 }
              }
              if (sql.includes('FROM friends')) {
                if (sql.includes('is_following')) return { count: 7 }
                return { count: 10 }
              }
              return null
            },
            all: async () => {
              if (sql.includes('DISTINCT') || sql.includes('friend_tags')) {
                return { results: [{ id: 'f-1', displayName: 'タグ花子' }] }
              }
              if (sql.includes('FROM friends f')) {
                return { results: [{ id: 'f-2', displayName: '条件太郎' }] }
              }
              return { results: [{ id: 'f-3', displayName: '全員次郎' }] }
            },
            run: async () => ({ meta: { changes: 0 } }),
          }
        },
      }
    },
  } as unknown as D1Database
  return { db, seen }
}

function createApp(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const { db } = fakeFriendsDb()
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', role, readOnly: false, tenantId: 'tenant-a' })
    c.env = { DB: db }
    await next()
  })
  app.route('/', reminders)
  return app
}

function request(path: string, init?: RequestInit, role?: 'owner' | 'admin' | 'staff') {
  return createApp(role).request(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
}

function versionWithSettings(settings: unknown) {
  return { ...VERSION, settings_snapshot: JSON.stringify(settings) }
}

beforeEach(() => {
  vi.clearAllMocks()
  accessMocks.canAccessAllLineAccounts.mockResolvedValue(true)
  dbMocks.getReminderById.mockResolvedValue({ id: 'reminder-1', line_account_id: 'account-1' })
  dbMocks.getReminderDraftVersion.mockResolvedValue(VERSION)
})

describe('対象者の数え直し口', () => {
  it('staff は数え直せない', async () => {
    const response = await request(
      '/api/reminders/reminder-1/audience',
      { method: 'POST', body: JSON.stringify({ condition: TAG_CONDITION }) },
      'staff',
    )
    expect(response.status).toBe(403)
  })

  it('見えない店舗の下書きは数え直せない', async () => {
    accessMocks.canAccessAllLineAccounts.mockResolvedValue(false)
    const response = await request('/api/reminders/reminder-1/audience', {
      method: 'POST',
      body: JSON.stringify({ condition: TAG_CONDITION }),
    })
    expect(response.status).toBe(404)
  })

  it('下書きの店舗と違う権限では 403', async () => {
    // requireVisibleReminder は通るが、下書き自体の店舗が見えないとき。
    accessMocks.canAccessAllLineAccounts
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const response = await request('/api/reminders/reminder-1/audience', {
      method: 'POST',
      body: JSON.stringify({ condition: TAG_CONDITION }),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ success: false })
  })

  it('無い下書きは 404', async () => {
    dbMocks.getReminderDraftVersion.mockResolvedValue(null)
    const response = await request('/api/reminders/reminder-1/audience', {
      method: 'POST',
      body: JSON.stringify({ condition: TAG_CONDITION }),
    })
    expect(response.status).toBe(404)
  })

  it('形の壊れた条件は 422 で止める', async () => {
    const response = await request('/api/reminders/reminder-1/audience', {
      method: 'POST',
      body: JSON.stringify({ condition: { operator: 'XOR', rules: [] } }),
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ success: false })
  })

  it('内部専用の条件は受け付けない', async () => {
    const response = await request('/api/reminders/reminder-1/audience', {
      method: 'POST',
      body: JSON.stringify({
        condition: { operator: 'AND', rules: [{ type: 'friend_id_in', value: ['f-1'] }] },
      }),
    })
    expect(response.status).toBe(422)
  })

  it('未保存の条件で数え直し、顔ぶれも同じ条件で切る', async () => {
    const response = await request('/api/reminders/reminder-1/audience', {
      method: 'POST',
      body: JSON.stringify({ condition: TAG_CONDITION }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        matched: 3,
        excluded: 7,
        sample: [{ id: 'f-1', displayName: 'タグ花子' }],
      },
    })
  })

  it('条件を送らなければ保存済みのまま数える', async () => {
    dbMocks.getReminderDraftVersion.mockResolvedValue(
      versionWithSettings({ ...SETTINGS, targetCondition: TAG_CONDITION }),
    )
    const response = await request('/api/reminders/reminder-1/audience', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { matched: 3, excluded: 7 },
    })
  })

  it('空の条件を送ったら保存済みの条件は使わない', async () => {
    dbMocks.getReminderDraftVersion.mockResolvedValue(
      versionWithSettings({ ...SETTINGS, targetCondition: TAG_CONDITION }),
    )
    const response = await request('/api/reminders/reminder-1/audience', {
      method: 'POST',
      body: JSON.stringify({ condition: null }),
    })
    expect(response.status).toBe(200)
    // 絞りなし = フォロー中7人 / 除く3人。保存済みタグ条件の 3/7 ではない。
    expect(await response.json()).toMatchObject({
      success: true,
      data: { matched: 7, excluded: 3 },
    })
  })
})

describe('下書き保存の条件検査', () => {
  const validDraft = (condition: unknown) => ({
    name: '予約前のお知らせ',
    lineAccountId: 'account-1',
    triggerType: 'booking',
    deliveryMode: 'time',
    targetCondition: condition,
    stopConditions: {
      bookingCancelled: true,
      supportMarkCompleted: false,
      daysAfterTarget: null,
      friendBlocked: true,
    },
    steps: [{
      stableStepId: 'step-1',
      offsetMinutes: -60,
      messageType: 'text',
      messageContent: '予約の1時間前です',
    }],
  })

  it('壊れた条件の下書きは作らせない', async () => {
    const response = await request('/api/reminders/drafts', {
      method: 'POST',
      body: JSON.stringify(validDraft({ operator: 'XOR', rules: [] })),
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ success: false })
  })

  it('空の条件は条件なしとして受け付ける', async () => {
    // 保存まで進むと偽 D1 では作れないので、422 でないことだけ見る。
    // 空は null に倒され、条件の検査では止まらない。
    const response = await request('/api/reminders/drafts', {
      method: 'POST',
      body: JSON.stringify(validDraft({ operator: 'AND', rules: [], groups: [] })),
    })
    expect(response.status).not.toBe(422)
  })
})
