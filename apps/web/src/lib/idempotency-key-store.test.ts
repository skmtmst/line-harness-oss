import { describe, expect, test, vi } from 'vitest'
import { IdempotencyKeyStore } from './idempotency-key-store'

describe('IdempotencyKeyStore', () => {
  test('同じ送信内容の再試行では同じキーを使い、成功後は新しいキーにする', () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    const store = new IdempotencyKeyStore()
    expect(store.get('thread-1:hello')).toBe('11111111-1111-4111-8111-111111111111')
    expect(store.get('thread-1:hello')).toBe('11111111-1111-4111-8111-111111111111')
    store.clear('thread-1:hello')
    expect(store.get('thread-1:hello')).toBe('22222222-2222-4222-8222-222222222222')
  })
})
