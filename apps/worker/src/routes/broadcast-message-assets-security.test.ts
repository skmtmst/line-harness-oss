import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../index'
import { broadcastMessageAssets, validateBroadcastMediaUpload } from './broadcast-message-assets'

describe('一斉配信素材の実ファイル検査', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  it('内容・Content-Type・拡張子が一致する素材だけを受け付ける', () => {
    expect(validateBroadcastMediaUpload(png, 'image/png', 'banner.png')).toMatchObject({
      ok: true,
      mimeType: 'image/png',
    })
    expect(validateBroadcastMediaUpload(png, 'image/jpeg', 'banner.jpg')).toMatchObject({ ok: false })
    expect(validateBroadcastMediaUpload(png, 'image/png', 'banner.jpg')).toMatchObject({ ok: false })
  })

  it('配信時は保存メタデータでなく拡張子から形式を固定しnosniffを付ける', async () => {
    const app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.env = {
        IMAGES: {
          get: async () => ({
            body: png,
            etag: 'etag-1',
            httpMetadata: { contentType: 'text/html' },
          }),
        },
      } as unknown as Env['Bindings']
      await next()
    })
    app.route('/', broadcastMessageAssets)

    const response = await app.request('/broadcast-media/123e4567-e89b-42d3-a456-426614174000.png')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Disposition')).toContain('inline')
  })
})
