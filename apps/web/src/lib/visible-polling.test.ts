import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPollGeneration,
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
    const { stop } = startVisiblePoll({ work })

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

  it('対象が終わっていたら始めから回さず、表示に戻っても起こさない', async () => {
    const doc = stubDocument(false)
    const work = vi.fn(async () => undefined)
    startVisiblePoll({ shouldPoll: () => false, work })

    // 始めないし、表示の往復でも起きない(完了後の空回り防止)。
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS * 3)
    expect(work).not.toHaveBeenCalled()
    doc.hidden = true
    doc.dispatch('visibilitychange')
    doc.hidden = false
    doc.dispatch('visibilitychange')
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS * 3)
    expect(work).not.toHaveBeenCalled()
  })

  it('対象が終わったら止まり、次を予約しない', async () => {
    let active = true
    const work = vi.fn(async () => undefined)
    startVisiblePoll({ shouldPoll: () => active, work })

    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(1)

    // 対象が終わったら、その回の後はもう回さない。
    active = false
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('immediateは初回も同じ1本に載せ、5秒後に次を1本だけ進める', async () => {
    const work = vi.fn(async () => undefined)
    startVisiblePoll({ work, immediate: true })

    // 待ちなしで初回が走る。
    await vi.advanceTimersByTimeAsync(0)
    expect(work).toHaveBeenCalledTimes(1)
    // 次は5秒後に1本だけ。
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(2)
  })

  it('immediateなら対象が終わっていても初回の1回は取り、そのあとは回さない', async () => {
    // 画面や絞り込みを変えた直後は、いま出ている中身が前の対象のもの。
    // 1回も取らずに休むと古い一覧が残る(#630)。
    const work = vi.fn(async () => undefined)
    startVisiblePoll({ shouldPoll: () => false, work, immediate: true })

    await vi.advanceTimersByTimeAsync(0)
    expect(work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS * 6)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('immediateでないなら対象が終わっていたら初回も走らせない', async () => {
    const work = vi.fn(async () => undefined)
    startVisiblePoll({ shouldPoll: () => false, work })

    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS * 3)
    expect(work).not.toHaveBeenCalled()
  })

  it('非表示で開いたimmediateは、表示に戻った時点で待たずに取る', async () => {
    const doc = stubDocument(true)
    const work = vi.fn(async () => undefined)
    startVisiblePoll({ work, immediate: true })

    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS * 3)
    expect(work).not.toHaveBeenCalled()

    // ここで5秒待たせると、そのあいだ画面は「読み込み中」のまま(#630)。
    doc.hidden = false
    doc.dispatch('visibilitychange')
    await vi.advanceTimersByTimeAsync(0)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('休んだあと wake で再開する(対応済み→再オープン)', async () => {
    let active = true
    const work = vi.fn(async () => undefined)
    const poll = startVisiblePoll({ shouldPoll: () => active, work })

    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(1)

    // 休む。次を予約しないので、いくら待っても増えない。
    active = false
    await vi.advanceTimersByTimeAsync(60000)
    expect(work).toHaveBeenCalledTimes(1)

    // 再開したら5秒起点に戻る。
    active = true
    poll.wake()
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(3)
  })

  it('wake は動いている間は何もしない(二重に回さない)', async () => {
    const work = vi.fn(async () => undefined)
    const poll = startVisiblePoll({ work })

    poll.wake()
    poll.wake()
    poll.wake()
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('止めたあとの wake では回さない', async () => {
    const work = vi.fn(async () => undefined)
    const poll = startVisiblePoll({ work })
    poll.stop()
    poll.wake()
    await vi.advanceTimersByTimeAsync(60000)
    expect(work).not.toHaveBeenCalled()
  })

  it('immediateの初回が遅くても5秒後のtickと二重にならない', async () => {
    let resolveWork!: () => void
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWork = resolve
        }),
    )
    startVisiblePoll({ work, immediate: true })

    // 初回が終わらないまま5秒・10秒たっても1本のまま。
    await vi.advanceTimersByTimeAsync(0)
    expect(work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10000)
    expect(work).toHaveBeenCalledTimes(1)

    // 初回が終わったら次の1本だけ進む。
    resolveWork()
    await vi.advanceTimersByTimeAsync(VISIBLE_POLL_BASE_MS)
    expect(work).toHaveBeenCalledTimes(2)
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

  it('非表示→再表示でも失敗回数ぶんの待ちを保つ(固定5秒に戻さない)', async () => {
    const doc = stubDocument(false)
    const work = vi.fn(async () => {
      throw new Error('no connection')
    })
    startVisiblePoll({ work, onGiveUp: () => undefined })

    // 1回目失敗(5秒後)→次は10秒後、2回目失敗→次は20秒後。
    await vi.advanceTimersByTimeAsync(5000)
    expect(work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10000)
    expect(work).toHaveBeenCalledTimes(2)

    // 非表示の往復を挟んでも、失敗2回ぶんの20秒待ちを保つ。
    doc.hidden = true
    doc.dispatch('visibilitychange')
    doc.hidden = false
    doc.dispatch('visibilitychange')
    await vi.advanceTimersByTimeAsync(19999)
    expect(work).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(work).toHaveBeenCalledTimes(3)
  })

  it('取得中に非表示→表示しても二重取得しない(同時1本)', async () => {
    const doc = stubDocument(false)
    let resolveWork!: () => void
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWork = resolve
        }),
    )
    startVisiblePoll({ work })

    // 1本目が取得中のままになる。
    await vi.advanceTimersByTimeAsync(5000)
    expect(work).toHaveBeenCalledTimes(1)

    // 取得中に非表示→表示。別tickを予約しない。
    doc.hidden = true
    doc.dispatch('visibilitychange')
    doc.hidden = false
    doc.dispatch('visibilitychange')

    // 5秒・10秒たっても1本のまま(直前版はここで2本目が走った)。
    await vi.advanceTimersByTimeAsync(5000)
    expect(work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(work).toHaveBeenCalledTimes(1)

    // 1本目が終わったら次の1本だけ進む。
    resolveWork()
    await vi.advanceTimersByTimeAsync(5000)
    expect(work).toHaveBeenCalledTimes(2)
  })

  it('止めたら待ち受けも外す', async () => {
    const doc = stubDocument(false)
    const work = vi.fn(async () => undefined)
    const { stop } = startVisiblePoll({ work })
    stop()
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    await vi.advanceTimersByTimeAsync(60000)
    expect(work).not.toHaveBeenCalled()
  })
})

describe('createPollGeneration', () => {
  it('新しい取得が始まると古い番号は古くなる(順序逆転の捨て判定)', () => {
    const gen = createPollGeneration()
    const oldSeq = gen.next()
    expect(gen.isStale(oldSeq)).toBe(false)
    // 新しい取得(画面切替・選択切替)が始まった。
    const newSeq = gen.next()
    expect(gen.isStale(oldSeq)).toBe(true)
    expect(gen.isStale(newSeq)).toBe(false)
  })
})
