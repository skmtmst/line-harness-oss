// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { decodeImageSize } from './image-size'

afterEach(() => { vi.unstubAllGlobals() })

describe('decodeImageSize', () => {
  it('reads dimensions without uploading', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2500, height: 1686, close: vi.fn() })))
    await expect(decodeImageSize(new File(['x'], 'a.png', { type: 'image/png' }))).resolves.toEqual({ width: 2500, height: 1686 })
  })
  it('returns null when the browser cannot decode locally', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    await expect(decodeImageSize(new File(['x'], 'a.png', { type: 'image/png' }))).resolves.toBeNull()
  })
  it('returns null when decoding fails', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('no') }))
    await expect(decodeImageSize(new File(['x'], 'a.png', { type: 'image/png' }))).resolves.toBeNull()
  })
})
