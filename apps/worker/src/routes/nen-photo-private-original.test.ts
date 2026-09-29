import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { images } from './images.js'

describe('NEN photo original delivery', () => {
  it('never reads or serves a private original from the public image route', async () => {
    const get = vi.fn()
    const app = new Hono<any>()
    app.use('*', async (c, next) => {
      c.env = { IMAGES: { get } }
      await next()
    })
    app.route('/', images)

    const response = await app.request('/images/nen-photo-originals/friend-1/photo-1.jpg')
    expect(response.status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })
})
