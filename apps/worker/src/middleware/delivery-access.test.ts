import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { BUNDLE_PRESETS, DELIVERY_FEATURE_POLICIES, scopeLevelsToKeys, type DeliveryFeature } from '@line-crm/shared'
import { permissionForApiPath } from './auth.js'
import { requireDeliveryAccess } from './role-guard.js'
import type { Env } from '../index.js'

describe('配信束のAPI門', () => {
  const keys = scopeLevelsToKeys(BUNDLE_PRESETS.operations.levels).edit
  it.each(Object.keys(DELIVERY_FEATURE_POLICIES) as DeliveryFeature[])('%s の編集を許可し、閲覧だけは断る', async feature => {
    const app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('staff', { id: 's', name: '担当', role: 'staff', readOnly: c.req.header('read-only') === 'true', permissionKeys: c.req.header('view') ? [] : keys, viewPermissionKeys: keys })
      await next()
    })
    app.post('/edit', requireDeliveryAccess(feature), c => c.body(null, 204))
    expect((await app.request('/edit', { method: 'POST' })).status).toBe(204)
    expect((await app.request('/edit', { method: 'POST', headers: { view: 'true' } })).status).toBe(403)
    expect((await app.request('/edit', { method: 'POST', headers: { 'read-only': 'true' } })).status).toBe(403)
    for (const prefix of DELIVERY_FEATURE_POLICIES[feature].api) expect(permissionForApiPath(`${prefix}/resource`)).toBe(DELIVERY_FEATURE_POLICIES[feature].key)
  })
  it('削除の影響を読むGETにも編集の鍵が要る', async () => {
    const app = new Hono<Env>()
    app.use('*', async (c, next) => { c.set('staff', { id: 's', name: '担当', role: 'staff', readOnly: false, permissionKeys: [], viewPermissionKeys: ['/form-submissions'] }); await next() })
    app.get('/impact', requireDeliveryAccess('forms'), c => c.body(null, 204))
    expect((await app.request('/impact')).status).toBe(403)
  })
})
