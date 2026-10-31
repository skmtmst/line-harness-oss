import { Hono } from 'hono'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js'
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js'
import type { Env } from '../worker-env.js'
import { scenarios } from './scenarios.js'

let sqlite: SqliteD1
const roles = ['owner', 'admin', 'staff'] as const
const permissions = ['/scenarios', 'scenario.definition.edit']

function app(role: typeof roles[number]) {
  const instance = new Hono<Env>()
  instance.use('*', async (c, next) => {
    c.env = { DB: sqlite.db } as Env['Bindings']
    c.set('staff', {
      id: role, name: role, role, readOnly: false, tenantId: 'tenant-a', permissionKeys: permissions,
      assignedLineAccountId: null, canAccessDescendantAccounts: false,
    } satisfies AuthenticatedStaff)
    await next()
  })
  instance.route('/', scenarios)
  return instance
}

const create = (role: typeof roles[number], active?: boolean) => app(role).request('/api/scenarios', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: '新しい案内', triggerType: 'friend_add', lineAccountId: 'account-a', ...(active === undefined ? {} : { isActive: active }) }),
})
const rows = () => sqlite.raw.prepare('SELECT id, is_active, line_account_id FROM scenarios').all() as Array<{ id: string; is_active: number; line_account_id: string }>

beforeEach(() => {
  sqlite = createTestD1()
  sqlite.raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-a', '統括')").run()
  sqlite.raw.prepare("INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id) VALUES ('account-a', 'channel-a', '店舗', 'fixture-token', 'fixture-secret', 1, 'tenant-a')").run()
  for (const role of roles) sqlite.raw.prepare("INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys) VALUES (?, ?, ?, ?, 'tenant-a', 'all', ?)").run(role, role, role, 'fixture-'+role, JSON.stringify(permissions))
})
afterEach(() => sqlite.raw.close())

it.each(roles)('%sが有効を省略して作ると、応答と保存された行の両方が停止状態になる', async role => {
  const response = await create(role)
  expect(response.status).toBe(201)
  expect(await response.json()).toMatchObject({ success: true, data: { isActive: false } })
  expect(rows()).toEqual([{ id: expect.any(String), is_active: 0, line_account_id: 'account-a' }])
})

it.each(roles)('%sの明示した停止指定も、保存された行と応答に保つ', async role => {
  const response = await create(role, false)
  expect(response.status).toBe(201)
  expect(await response.json()).toMatchObject({ success: true, data: { isActive: false } })
  expect(rows()).toEqual([{ id: expect.any(String), is_active: 0, line_account_id: 'account-a' }])
})

it.each(['owner', 'admin'] as const)('%sが明示した有効指定は、公開権限を確かめて従来どおり保存する', async role => {
  const response = await create(role, true)
  expect(response.status).toBe(201)
  expect(await response.json()).toMatchObject({ success: true, data: { isActive: true } })
  expect(rows()).toEqual([{ id: expect.any(String), is_active: 1, line_account_id: 'account-a' }])
})

it('編集だけのstaffの明示した有効指定は、行を作らず拒否する', async () => {
  const response = await create('staff', true)
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({ success: false })
  expect(rows()).toEqual([])
})
