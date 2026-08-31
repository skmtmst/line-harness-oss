import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { FRIEND_ADD_ROUTING_DEFAULT } from '@line-crm/shared'
import type { Env } from '../index.js'

const db = vi.hoisted(() => ({
  getFriendAddRoutingDraftVersion: vi.fn(),
  listFriendAddEvents: vi.fn(),
  publishFriendAddRoutingDraftVersion: vi.fn(),
  recordFriendAddRoutingDraftTest: vi.fn(),
  saveFriendAddRoutingDraftVersion: vi.fn(),
}))

const routing = vi.hoisted(() => ({
  loadFriendAddRouting: vi.fn(),
  saveFriendAddRouting: vi.fn(),
  normalizeRouting: vi.fn(),
  previewFriendAddRouting: vi.fn(),
  previewFriendAddRoutingDefinition: vi.fn(),
  listFriendAddScenarios: vi.fn(),
  classifyFriend: vi.fn(),
}))

const accountAccess = vi.hoisted(() => ({
  getVisibleLineAccountScope: vi.fn(),
}))

vi.mock('@line-crm/db', () => db)
vi.mock('../services/friend-add-routing.js', () => routing)
vi.mock('../services/account-access.js', () => accountAccess)

const { friendAddRouting } = await import('./friend-add-routing.js')

const app = new Hono<Env>()
app.use('*', async (c, next) => {
  c.set('staff', {
    id: 'staff-1', name: '担当者', role: 'admin', readOnly: false,
    tenantId: 'tenant-1', permissionKeys: ['/friend-add-settings'],
  })
  await next()
})
app.route('/', friendAddRouting)

const validRouting = {
  ...FRIEND_ADD_ROUTING_DEFAULT,
  firstTime: {
    ...FRIEND_ADD_ROUTING_DEFAULT.firstTime,
    scenarioId: 'scenario-1',
  },
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-2',
    line_account_id: 'account-1',
    version_number: 2,
    definition_snapshot: JSON.stringify(validRouting),
    status: 'draft',
    last_test_status: 'succeeded',
    last_tested_at: '2026-08-30T10:00:00',
    last_tested_by_staff_id: 'staff-1',
    published_at: null,
    published_by_staff_id: null,
    publish_idempotency_key: null,
    created_at: '2026-08-30T09:00:00',
    updated_at: '2026-08-30T10:00:00',
    ...overrides,
  }
}

function makeEnv(friend: Record<string, unknown> | null = {
  id: 'friend-1',
  unfollow_count: 0,
  first_followed_at: '2026-08-30T09:00:00',
  display_name: '山田 花子',
}) {
  const first = vi.fn(async (sql: string) => {
    if (sql.includes('COUNT(*)')) return { count: 12 }
    return friend
  })
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn(() => ({ first: () => first(sql) })),
  }))
  return { DB: { prepare } as unknown as D1Database } as Env['Bindings']
}

beforeEach(() => {
  vi.clearAllMocks()
  accountAccess.getVisibleLineAccountScope.mockResolvedValue({
    ids: ['account-1'],
    canSeeUnassigned: false,
  })
  routing.normalizeRouting.mockImplementation((value) => value)
  routing.listFriendAddScenarios.mockResolvedValue([
    { id: 'scenario-1', name: '初回あいさつ' },
  ])
  routing.previewFriendAddRoutingDefinition.mockReturnValue({
    kind: 'first_time',
    scenarioId: 'scenario-1',
    suppressed: false,
    actionCount: 0,
  })
  db.getFriendAddRoutingDraftVersion.mockResolvedValue(version())
  db.recordFriendAddRoutingDraftTest.mockResolvedValue(undefined)
  db.publishFriendAddRoutingDraftVersion.mockResolvedValue(version({
    status: 'published',
    published_at: '2026-08-30T10:30:00',
    publish_idempotency_key: 'publish-key-00000001',
  }))
})

describe('friend-add routing draft/test/publish contract', () => {
  test('別の統括の下書きは読ませない', async () => {
    accountAccess.getVisibleLineAccountScope.mockResolvedValue({ ids: [], canSeeUnassigned: false })

    const response = await app.request(
      '/api/friend-add-routing/draft?account_id=account-2',
      {},
      makeEnv(),
    )

    expect(response.status).toBe(404)
    expect(db.getFriendAddRoutingDraftVersion).not.toHaveBeenCalled()
  })

  test('他のLINEアカウントのシナリオを公開可能としない', async () => {
    db.getFriendAddRoutingDraftVersion.mockResolvedValue(version({
      definition_snapshot: JSON.stringify({
        ...validRouting,
        firstTime: { ...validRouting.firstTime, scenarioId: 'scenario-foreign' },
      }),
    }))

    const response = await app.request(
      '/api/friend-add-routing/validate?account_id=account-1',
      { method: 'POST' },
      makeEnv(),
    )
    const body = await response.json() as {
      data: { canPublish: boolean; estimatedAudienceCount: number | null; checks: Array<{ status: string }> }
    }

    expect(response.status).toBe(200)
    expect(body.data.canPublish).toBe(false)
    expect(body.data.estimatedAudienceCount).toBe(12)
    expect(body.data.checks[0].status).toBe('failed')
  })

  test('公開前の確認で対象見込みを返し、公開後まで人数を隠さない', async () => {
    const response = await app.request(
      '/api/friend-add-routing/validate?account_id=account-1',
      { method: 'POST' },
      makeEnv(),
    )
    const body = await response.json() as {
      data: { canPublish: boolean; estimatedAudienceCount: number | null }
    }

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      canPublish: true,
      estimatedAudienceCount: 12,
    })
    expect(db.publishFriendAddRoutingDraftVersion).not.toHaveBeenCalled()
  })

  test('dry-runは本番と同じ判定器を使うが状態を変えない', async () => {
    const response = await app.request(
      '/api/friend-add-routing/draft/test?account_id=account-1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendId: 'friend-1' }),
      },
      makeEnv(),
    )
    const body = await response.json() as { data: { stateChanged: boolean; scenarioName: string } }

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      stateChanged: false,
      scenarioName: '初回あいさつ',
    })
    expect(routing.previewFriendAddRoutingDefinition).toHaveBeenCalledWith(
      validRouting,
      expect.objectContaining({ id: 'friend-1' }),
    )
    expect(db.recordFriendAddRoutingDraftTest).toHaveBeenCalledWith(
      expect.anything(),
      'version-2',
      {
        succeeded: true,
        staffId: 'staff-1',
      },
    )
    expect(db.publishFriendAddRoutingDraftVersion).not.toHaveBeenCalled()
  })

  test('試験後に下書きを直したら公開させない', async () => {
    db.getFriendAddRoutingDraftVersion.mockResolvedValue(version({ last_test_status: null }))

    const response = await app.request(
      '/api/friend-add-routing/publish?account_id=account-1',
      { method: 'POST', headers: { 'Idempotency-Key': 'publish-key-00000001' } },
      makeEnv(),
    )

    expect(response.status).toBe(409)
    expect(db.publishFriendAddRoutingDraftVersion).not.toHaveBeenCalled()
  })

  test('公開前の確認に失敗した下書きは公開させない', async () => {
    db.getFriendAddRoutingDraftVersion.mockResolvedValue(version({
      definition_snapshot: JSON.stringify({
        ...validRouting,
        returning: { ...validRouting.returning, mode: 'other', scenarioId: null },
      }),
    }))

    const response = await app.request(
      '/api/friend-add-routing/publish?account_id=account-1',
      { method: 'POST', headers: { 'Idempotency-Key': 'publish-key-00000001' } },
      makeEnv(),
    )
    const body = await response.json() as { data: { canPublish: boolean } }

    expect(response.status).toBe(409)
    expect(body.data.canPublish).toBe(false)
    expect(db.publishFriendAddRoutingDraftVersion).not.toHaveBeenCalled()
  })

  test('公開は識別キーと実測の対象人数を使う', async () => {
    const response = await app.request(
      '/api/friend-add-routing/publish?account_id=account-1',
      { method: 'POST', headers: { 'Idempotency-Key': 'publish-key-00000001' } },
      makeEnv(),
    )
    const body = await response.json() as {
      data: {
        estimatedAudienceCount: number
        duplicatePrevention: string
        monitoringPath: string | null
        monitoringUnavailableReason: string | null
      }
    }

    expect(response.status).toBe(200)
    expect(db.publishFriendAddRoutingDraftVersion).toHaveBeenCalledWith(
      expect.anything(),
      'account-1',
      { idempotencyKey: 'publish-key-00000001', staffId: 'staff-1' },
    )
    expect(body.data).toMatchObject({
      estimatedAudienceCount: 12,
      duplicatePrevention: 'webhook_event',
      monitoringPath: null,
      monitoringUnavailableReason: '実行結果の画面はまだ接続されていません。',
    })
  })

  test('公開操作の識別キーが無い要求は止める', async () => {
    const response = await app.request(
      '/api/friend-add-routing/publish?account_id=account-1',
      { method: 'POST' },
      makeEnv(),
    )

    expect(response.status).toBe(400)
    expect(db.publishFriendAddRoutingDraftVersion).not.toHaveBeenCalled()
  })
})
