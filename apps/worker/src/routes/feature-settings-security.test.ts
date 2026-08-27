import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index.js'
import { createTestD1 } from '../test-utils/d1-sqlite.js'

const access = vi.hoisted(() => ({ canAccess: vi.fn(async () => true) }))
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: access.canAccess,
}))

const { featureSettings } = await import('./feature-settings.js')

function app() {
  const instance = new Hono<Env>()
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'tenant-a',
    })
    await next()
  })
  instance.route('/', featureSettings)
  return instance
}

beforeEach(() => {
  vi.clearAllMocks()
  access.canAccess.mockResolvedValue(true)
})

describe('機能設定の範囲と同時保存', () => {
  it.each(['GET', 'PUT'] as const)('%sは範囲外アカウントをDB読取前に拒否する', async (method) => {
    access.canAccess.mockResolvedValue(false)
    const prepare = vi.fn()
    const response = await app().request('/api/settings/features?account_id=other', {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'PUT' ? JSON.stringify({ expectedVersion: 0, features: {} }) : undefined,
    }, { DB: { prepare } as unknown as D1Database })

    expect(response.status).toBe(403)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('設定一式を1行で保存し、古い画面からの上書きを409にする', async () => {
    const testDb = createTestD1()
    try {
      const first = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 0,
          features: { scenarios: false },
          sidebarItemOrder: { delivery: ['broadcasts', 'scenarios'] },
        }),
      }, { DB: testDb.db })
      expect(first.status).toBe(200)
      expect(await first.json()).toMatchObject({ success: true, data: { version: 1 } })

      const stale = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 0, features: { scenarios: true } }),
      }, { DB: testDb.db })
      expect(stale.status).toBe(409)

      const loaded = await app().request('/api/settings/features?account_id=account-1', {}, { DB: testDb.db })
      expect(await loaded.json()).toMatchObject({
        success: true,
        data: {
          version: 1,
          features: { scenarios: false },
          sidebarItemOrder: { delivery: ['broadcasts', 'scenarios'] },
        },
      })
      expect(testDb.raw.prepare("SELECT COUNT(*) AS count FROM account_settings WHERE line_account_id = 'account-1' AND key = 'feature.settings_bundle_v1'").get())
        .toEqual({ count: 1 })
    } finally {
      testDb.raw.close()
    }
  })

  it('重複した並びと真偽値でない設定を保存しない', async () => {
    const testDb = createTestD1()
    try {
      const duplicate = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 0, sidebarItemOrder: { delivery: ['scenarios', 'scenarios'] } }),
      }, { DB: testDb.db })
      expect(duplicate.status).toBe(400)

      const invalid = await app().request('/api/settings/features?account_id=account-1', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 0, features: { scenarios: 'off' } }),
      }, { DB: testDb.db })
      expect(invalid.status).toBe(400)
      expect(testDb.raw.prepare("SELECT COUNT(*) AS count FROM account_settings WHERE line_account_id = 'account-1' AND key = 'feature.settings_bundle_v1'").get())
        .toEqual({ count: 0 })
    } finally {
      testDb.raw.close()
    }
  })
})
