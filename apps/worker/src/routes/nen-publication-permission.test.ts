import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { nenMembers } from './nen-members.js'

function app(permissionKeys: string[]) {
  const testApp = new Hono<any>()
  testApp.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1',
      role: 'staff',
      readOnly: false,
      tenantId: 'tenant-a',
      permissionKeys,
    })
    c.env = {}
    await next()
  })
  testApp.route('/', nenMembers)
  return testApp
}

describe('写真の掲載変更権限', () => {
  it.each(['withdraw', 'placements'])('閲覧権限だけでは %s を変更できない', async (operation) => {
    const response = await app(['photo.submission.view']).request(
      `/api/nen-members/photos/publications/publication-1/${operation}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' },
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'この写真審査操作を行う権限がありません',
    })
  })

  it.each(['withdraw', 'placements'])('審査権限があると %s の入力検査まで進む', async (operation) => {
    const response = await app(['photo.submission.review']).request(
      `/api/nen-members/photos/publications/publication-1/${operation}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' },
    )
    expect(response.status).toBe(400)
  })
})
