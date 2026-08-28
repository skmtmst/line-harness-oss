import { describe, expect, it, vi } from 'vitest'
import type { HttpClient } from '../../src/http.js'
import { AdPlatformsResource } from '../../src/resources/ad-platforms.js'

function mockHttp(overrides: Partial<HttpClient> = {}): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as unknown as HttpClient
}

describe('AdPlatformsResource account scope', () => {
  it('一覧と履歴へ選択中LINEアカウントを渡す', async () => {
    const http = mockHttp({
      get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    })
    const resource = new AdPlatformsResource(http)

    await resource.list('account A')
    await resource.getLogs('platform-a', 'account A', 20)

    expect(http.get).toHaveBeenNthCalledWith(
      1,
      '/api/ad-platforms?lineAccountId=account%20A',
    )
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      '/api/ad-platforms/platform-a/logs?lineAccountId=account+A&limit=20',
    )
  })

  it('作成・更新・削除・テスト送信で同じアカウントを保持する', async () => {
    const platform = {
      id: 'platform-a', lineAccountId: 'account-a', name: 'google',
      displayName: null, config: {}, isActive: true,
      createdAt: '2026-08-28', updatedAt: '2026-08-28',
    }
    const http = mockHttp({
      post: vi.fn()
        .mockResolvedValueOnce({ success: true, data: platform })
        .mockResolvedValueOnce({ success: true, data: { message: 'ok' } }),
      put: vi.fn().mockResolvedValue({ success: true, data: platform }),
      delete: vi.fn().mockResolvedValue(undefined),
    })
    const resource = new AdPlatformsResource(http)

    await resource.create({ lineAccountId: 'account-a', name: 'google', config: {} })
    await resource.update('platform-a', 'account-a', { isActive: false })
    await resource.delete('platform-a', 'account-a')
    await resource.test('account-a', 'google', 'Purchase', 'friend-a')

    expect(http.post).toHaveBeenNthCalledWith(1, '/api/ad-platforms', {
      lineAccountId: 'account-a', name: 'google', config: {},
    })
    expect(http.put).toHaveBeenCalledWith(
      '/api/ad-platforms/platform-a?lineAccountId=account-a',
      { isActive: false },
    )
    expect(http.delete).toHaveBeenCalledWith(
      '/api/ad-platforms/platform-a?lineAccountId=account-a',
    )
    expect(http.post).toHaveBeenNthCalledWith(2, '/api/ad-platforms/test', {
      lineAccountId: 'account-a',
      platform: 'google',
      eventName: 'Purchase',
      friendId: 'friend-a',
    })
  })
})
