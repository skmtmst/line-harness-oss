import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  startVisiblePoll,
  visiblePollDelayMs,
  VISIBLE_POLL_BASE_MS,
  VISIBLE_POLL_MAX_DELAY_MS,
  VISIBLE_POLL_MAX_FAILURES,
} from './visible-polling'

type Listener = () => void

function stubDocument(hidden = false) {
  const listeners = new Map<string, Set<Listener>>()
  const doc = {
    hidden,
    addEventListener: vi.fn((type: string, fn: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>()
      set.add(fn)
      listeners.set(type, set)
    }),
    removeEventListener: vi.fn((type: string, fn: Listener) => {
      listeners.get(type)?.delete(fn)
    }),
    dispatch: (type: string) => {
      listeners.get(type)?.forEach((fn) => fn())
    },
  }
  vi.stubGlobal('document', doc)
  return doc
}

beforeEach(() => {
  vi.useFakeTimers()
  stubDocument(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('visiblePollDelayMs', () => {
  it('5秒→10秒→20秒→40秒→60秒(上限)で延ばす', () => {
    expect(visiblePollDelayMs(0)).toBe(5000)
    expect(visiblePollDelayMs(1)).toBe(10000)
    expect(visiblePollDelayMs(2)).toBe(20000)
    expect(visiblePollDelayMs(3)).toBe(40000)
    expect(visiblePollDelayMs(4)).toBe(60000)
    expect(visiblePollDelayMs(5)).toBe(VISIBLE_POLL_MAX_DELAY_MS)
    expect(visiblePollDelayMs(99)).toBe(VISIBLE_POLL_MAX_DELAY_MS)
  })
})

describe('startVisiblePoll', () => {
  it('5秒起点で繰り返し、止めたらそれ以上呼ばない', async () => {
    const work = vi.fn(async () => undefined)
    const stop = startVisiblePoll({ work })

    expect(work).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(2)

    stop()
    await vi.advanceTimersByTimeAsync(60000)
    expect(work).toHaveBeenCalledTimes(2)
  })

  it('非表示の間は取得せず、表示に戻ったら再開する(単一のまま)', async () => {
    const doc = stubDocument(false)
    const work = vi.fn(async () => undefined)
    startVisiblePoll({ work })

    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(1)

    doc.hidden = true
    doc.dispatch('visibilitychange')
    await vi.advanceTimersByTimeAsync(60000)
    expect(work).toHaveBeenCalledTimes(1)

    doc.hidden = false
    doc.dispatch('visibilitychange')
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(2)
    // 表示の往復で二重起動しない。さらに5秒でちょうど1回だけ増える。
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(3)
  })

  it('対象が処理中/未解決でない間は取得せず、戻ったら再開する', async () => {
    let active = false
    const work = vi.fn(async () => undefined)
    startVisiblePoll({ shouldPoll: () => active, work })

    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS * 3)
    expect(work).not.toHaveBeenCalled()

    active = true
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('連続失敗は待ちを延ばし、上限後は止まって理由を1回だけ返す', async () => {
    const work = vi.fn(async () => {
      throw new Error('no connection')
    })
    const onGiveUp = vi.fn()
    startVisiblePoll({ work, onGiveUp })

    // 1回目: 5秒後に失敗 → 次は10秒後
    await vi.advanceTimersByTimeAsync(5000)
    expect(work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(9999)
    expect(work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(work).toHaveBeenCalledTimes(2)
    // 2回目失敗 → 次は20秒後
    await vi.advanceTimersByTimeAsync(20000)
    expect(work).toHaveBeenCalledTimes(3)
    // 3回目失敗 → 次は40秒後
    await vi.advanceTimersByTimeAsync(40000)
    expect(work).toHaveBeenCalledTimes(4)
    // 4回目失敗 → 次は60秒後(上限)
    await vi.advanceTimersByTimeAsync(60000)
    expect(work).toHaveBeenCalledTimes(5)
    // 5回目失敗 → 上限。上に報告して止まる。
    expect(onGiveUp).toHaveBeenCalledTimes(1)
    expect(onGiveUp).toHaveBeenCalledWith(VISIBLE_POLL_MAX_FAILURES)
    await vi.advanceTimersByTimeAsync(600000)
    expect(work).toHaveBeenCalledTimes(5)
    expect(onGiveUp).toHaveBeenCalledTimes(1)
  })

  it('失敗のあと成功したら回復を1回だけ返し、5秒に戻る', async () => {
    let fail = true
    const work = vi.fn(async () => {
      if (fail) throw new Error('no connection')
    })
    const onRecovered = vi.fn()
    const onGiveUp = vi.fn()
    startVisiblePoll({ work, onGiveUp, onRecovered })

    await vi.advanceTimersByTimeAsync(5000)
    expect(work).toHaveBeenCalledTimes(1)
    fail = false
    await vi.advanceTimersByTimeAsync(10000)
    expect(work).toHaveBeenCalledTimes(2)
    expect(onRecovered).toHaveBeenCalledTimes(1)
    expect(onGiveUp).not.toHaveBeenCalled()
    // 5秒起点に戻っている。
    await vi.advanceTimersByTimeAsync(5000)
    expect(work).toHaveBeenCalledTimes(3)
    expect(onRecovered).toHaveBeenCalledTimes(1)
  })

  it('止めたら待ち受けも外す', async () => {
    const doc = stubDocument(false)
    const work = vi.fn(async () => undefined)
    const stop = startVisiblePoll({ work })
    stop()
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    await vi.advanceTimersByTimeAsync(60000)
    expect(work).not.toHaveBeenCalled()
  })
})
