/*
 * #625: 応答しない要求を時間切れの失敗にする withRequestTimeout の試験。
 * 「読み込んでいます」のまま戻らない事故（05シナリオ）を防ぐ部品。
 */
import { describe, expect, it, vi } from 'vitest'
import { LIST_REQUEST_TIMEOUT_MS, withRequestTimeout } from './request-timeout'

describe('withRequestTimeout', () => {
  it('時間内に成功した Promise はそのままの値を返す', async () => {
    await expect(withRequestTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok')
  })

  it('時間内の失敗はそのままの理由で落ちる', async () => {
    await expect(
      withRequestTimeout(Promise.reject(new Error('server down')), 1000),
    ).rejects.toThrow('server down')
  })

  it('応答しない Promise は時間切れで失敗する', async () => {
    vi.useFakeTimers()
    try {
      const never = new Promise<string>(() => undefined)
      const raced = withRequestTimeout(never, 30_000)
      const assertion = expect(raced).rejects.toThrow('時間切れ')
      await vi.advanceTimersByTimeAsync(LIST_REQUEST_TIMEOUT_MS)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('時間切れのあとに元の Promise が解決しても結果は失敗のまま', async () => {
    vi.useFakeTimers()
    try {
      let release!: (value: string) => void
      const slow = new Promise<string>((resolve) => { release = resolve })
      const raced = withRequestTimeout(slow, 1_000)
      const assertion = expect(raced).rejects.toThrow('時間切れ')
      await vi.advanceTimersByTimeAsync(1_000)
      release('late success')
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
