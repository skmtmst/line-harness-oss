import { expect, it, vi } from 'vitest'

it('WEB237: 読込失敗後は再試行し、成功したモジュールは使い回す', async () => {
  vi.resetModules()
  let attempts = 0
  vi.doMock('qrcode', () => {
    if (++attempts === 1) throw new Error('offline')
    return { default: { toDataURL: vi.fn(async () => 'data:recovered') } }
  })
  const { qrToDataURL } = await import('./qr-image')
  await expect(qrToDataURL('first')).rejects.toThrow()
  // モジュール配信が復旧した状況を次の import で返す。
  vi.doMock('qrcode', () => {
    attempts += 1
    return { default: { toDataURL: vi.fn(async () => 'data:recovered') } }
  })
  await expect(qrToDataURL('retry')).resolves.toBe('data:recovered')
  await expect(qrToDataURL('next')).resolves.toBe('data:recovered')
  expect(attempts).toBe(2)
  vi.doUnmock('qrcode')
})
