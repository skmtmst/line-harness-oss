import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  encryptCredential: vi.fn(),
}))

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: mocks.canAccess,
  getVisibleLineAccountScope: vi.fn(),
}))
vi.mock('@line-crm/line-sdk', () => ({ LineClient: vi.fn() }))
vi.mock('@line-crm/db', () => ({
  encryptCredential: mocks.encryptCredential,
  getLineAccountById: vi.fn(),
  jstNow: () => '2026-09-06T12:00:00+09:00',
}))

const { ecCommerce } = await import('./ec-commerce.js')

type Row = Record<string, unknown>

function harness(options: {
  subscriptions?: Row[]
  connector?: Row | null
  health?: Row | null
  changes?: number
  role?: 'owner' | 'admin' | 'staff'
} = {}) {
  const calls: Array<{ sql: string; bindings: unknown[] }> = []
  const app = new Hono<any>()
  app.use('*', async (c, next) => {
    c.env = {
      LINE_CREDENTIAL_ENCRYPTION_KEY: 'test-key',
      DB: {
        prepare(sql: string) {
          const call = { sql, bindings: [] as unknown[] }
          calls.push(call)
          const statement = {
            bind(...bindings: unknown[]) { call.bindings = bindings; return statement },
            async all() { return { results: options.subscriptions ?? [] } },
            async first() {
              if (sql.includes('FROM ec_connectors')) return options.connector ?? null
              if (sql.includes('FROM ec_events')) return options.health ?? null
              return null
            },
            async run() { return { meta: { changes: options.changes ?? 1 } } },
          }
          return statement
        },
      },
    }
    c.set('staff', { id: 'staff-1', name: '担当者', role: options.role ?? 'owner', tenantId: 'tenant-a' })
    await next()
  })
  app.route('/', ecCommerce)
  return { app, calls }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.canAccess.mockResolvedValue(true)
  mocks.encryptCredential.mockResolvedValue('encrypted-secret')
})

describe('EC subscriptions and connector', () => {
  it('returns real subscription facts and keeps unavailable aggregates null', async () => {
    const subscription = JSON.stringify({ contracts: [{
      contract_number: 'SUB-100', status: 'payment_failed', amount: 4280,
      next_shipping_date: '2026-09-20', continued_count: 4,
      items: [{ name: '鹿肉フード', quantity: 2 }],
    }] })
    const { app } = harness({ subscriptions: [{
      friend_id: 'friend-a', owner_name: '高橋 直人', pet_name: 'もも',
      subscription_json: subscription, synced_at: '2026-09-06T10:00:00+09:00',
    }] })
    const response = await app.request('/api/ec-commerce/subscriptions?lineAccountId=account-a')
    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(body.data.items[0]).toMatchObject({
      contractNumber: 'SUB-100', status: 'at_risk', amount: 4280,
      items: '鹿肉フード × 2', riskReason: '定期便のお支払いを確認できませんでした',
    })
    expect(body.data.summary).toMatchObject({ total: 1, atRisk: 1, monthlyAmount: 4280 })
    expect(body.data.summary.startedThisMonth).toBe(0)
    expect(body.data.summary.cancelledThisMonth).toBe(0)
    expect(body.data.summary.monthlyStats).toEqual([])
    expect(body.data.risk.predictiveScoreAvailable).toBe(false)
  })

  it('scopes subscription and connector reads to the selected account', async () => {
    mocks.canAccess.mockResolvedValue(false)
    const { app, calls } = harness()
    expect((await app.request('/api/ec-commerce/subscriptions?lineAccountId=other')).status).toBe(403)
    expect((await app.request('/api/ec-commerce/connector?lineAccountId=other')).status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('returns only masked connector secret metadata', async () => {
    const { app } = harness({
      connector: {
        id: 'connector-a', provider: 'shopify', shop_domain: 'nen.myshopify.com',
        status: 'connected', inbound_secret_encrypted: 'ciphertext', inbound_secret_last4: '8f3a',
        secret_updated_at: '2026-09-01', event_types_json: '["ec.order.confirmed"]',
        identity_rules_json: '["verified_email"]', version: 3, updated_at: '2026-09-01',
      },
      health: { today: 2, last_30_days: 20, failed: 1, last_received_at: '2026-09-06', last_succeeded_at: '2026-09-06' },
    })
    const response = await app.request('/api/ec-commerce/connector?lineAccountId=account-a')
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(text).not.toContain('ciphertext')
    expect(JSON.parse(text).data.connector).toMatchObject({ secretConfigured: true, secretLastFour: '8f3a' })
  })

  it('encrypts a new secret and uses optimistic versioning', async () => {
    const { app, calls } = harness({ connector: null })
    const response = await app.request('/api/ec-commerce/connector?lineAccountId=account-a', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'shopify', shopDomain: 'nen.myshopify.com', status: 'connected',
        inboundSecret: 'abcdefghijklmnopqrstuvwxyz1234567890',
        eventTypes: ['ec.order.confirmed'], identityRules: ['verified_email'], expectedVersion: 0,
      }),
    })
    expect(response.status).toBe(200)
    expect(mocks.encryptCredential).toHaveBeenCalledWith('abcdefghijklmnopqrstuvwxyz1234567890', 'test-key')
    const insert = calls.find((call) => call.sql.includes('INSERT INTO ec_connectors'))
    expect(insert?.bindings).toContain('encrypted-secret')
    expect(insert?.bindings).toContain('7890')
    expect(JSON.stringify(insert?.bindings)).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890')
  })

  it('rejects connector changes from staff', async () => {
    const { app, calls } = harness({ role: 'staff' })
    const response = await app.request('/api/ec-commerce/connector?lineAccountId=account-a', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    expect(response.status).toBe(403)
    expect(calls).toHaveLength(0)
  })
})
