/*
 * 世代札の振る舞い。A→B と店を切り替えたとき、遅れて届いた A の応答で
 * B の画面を上書きしないことが要点。DOM は要らないので node で回す。
 */
import { describe, expect, it } from 'vitest'

import {
  createAccountTracker,
  createMileageRewardsFetchGuards,
  createRequestGuard,
} from './redemption-request-guard'

/** 世代を取って、しばらくしてから「今の世代なら」採用する。画面の読み方と同じ。 */
function delayedApply(
  guard: ReturnType<typeof createRequestGuard>,
  applied: string[],
  name: string,
  waitMs: number,
): Promise<void> {
  const requestId = guard.issue()
  return new Promise((resolve) => setTimeout(resolve, waitMs)).then(() => {
    if (guard.isCurrent(requestId)) applied.push(name)
  })
}

describe('応答の世代札', () => {
  it('A→Bと切り替えたとき遅いAの応答を捨てる', async () => {
    const guard = createRequestGuard()
    const applied: string[] = []
    await Promise.all([
      delayedApply(guard, applied, 'A', 30),
      delayedApply(guard, applied, 'B', 5),
    ])
    expect(applied).toEqual(['B'])
  })

  it('切り替えが無い応答は捨てない', async () => {
    const guard = createRequestGuard()
    const applied: string[] = []
    await delayedApply(guard, applied, 'A', 5)
    expect(applied).toEqual(['A'])
  })

  it('世代は取るたびに進む', () => {
    const guard = createRequestGuard()
    const first = guard.issue()
    const second = guard.issue()
    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })
})

/** まだ返事が来ていない取得。開いた順に解く。 */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('取得ごとの札（使い道の一覧と届かなかった交換）', () => {
  it('開いた瞬間の2つの取得が互いを失効させず、一覧が loading のまま残らない', async () => {
    // 開いた瞬間、使い道の一覧と届かなかった交換をほぼ同時に読む。
    // 1つの札を使い回すと、後に取った方が先を古くして一覧が捨てられる。
    const guards = createMileageRewardsFetchGuards()
    const applied: string[] = []
    let status: 'loading' | 'ready' = 'loading'

    const overviewGate = deferred()
    const redemptionsGate = deferred()
    const overviewId = guards.overview.issue()
    const redemptionsId = guards.redemptions.issue()
    const overview = overviewGate.promise.then(() => {
      if (!guards.overview.isCurrent(overviewId)) return
      applied.push('overview')
      status = 'ready'
    })
    const redemptions = redemptionsGate.promise.then(() => {
      if (!guards.redemptions.isCurrent(redemptionsId)) return
      applied.push('redemptions')
    })
    // 届かなかった交換の方が先に返っても、一覧は捨てられない。
    redemptionsGate.resolve()
    await redemptions
    expect(status).toBe('loading')
    overviewGate.resolve()
    await overview
    expect(applied.sort()).toEqual(['overview', 'redemptions'])
    expect(status).toBe('ready')
  })

  it('1つの札を使い回すと一覧が捨てられる（直した欠陥の再現）', async () => {
    // 上の実動作と対になる。共有の札では開いた瞬間に一覧が古くなる。
    const guard = createRequestGuard()
    const applied: string[] = []
    const overviewGate = deferred()
    const redemptionsGate = deferred()
    const overviewId = guard.issue()
    const redemptionsId = guard.issue()
    const overview = overviewGate.promise.then(() => {
      if (guard.isCurrent(overviewId)) applied.push('overview')
    })
    const redemptions = redemptionsGate.promise.then(() => {
      if (guard.isCurrent(redemptionsId)) applied.push('redemptions')
    })
    redemptionsGate.resolve()
    await redemptions
    overviewGate.resolve()
    await overview
    expect(applied).toEqual(['redemptions'])
  })

  it('A→Bと切り替えたとき、遅いAの2つの応答をどちらも捨てる', async () => {
    const guards = createMileageRewardsFetchGuards()
    const applied: string[] = []
    const gateA = deferred()
    const overviewA = guards.overview.issue()
    const redemptionsA = guards.redemptions.issue()
    // Bへ切り替え：どちらの札も世代が進む。
    const overviewB = guards.overview.issue()
    const redemptionsB = guards.redemptions.issue()
    const lateA = gateA.promise.then(() => {
      if (guards.overview.isCurrent(overviewA)) applied.push('overview-A')
      if (guards.redemptions.isCurrent(redemptionsA)) applied.push('redemptions-A')
    })
    const freshB = Promise.resolve().then(() => {
      if (guards.overview.isCurrent(overviewB)) applied.push('overview-B')
      if (guards.redemptions.isCurrent(redemptionsB)) applied.push('redemptions-B')
    })
    gateA.resolve()
    await Promise.all([lateA, freshB])
    expect(applied.sort()).toEqual(['overview-B', 'redemptions-B'])
  })
})

describe('やり直しの店世代（Aで押してBへ切り替え）', () => {
  it('押したときと応答時で店が違えば、読み直しを出さない', async () => {
    // やり直し関数の「掴む→POST待ち→確かめる→読み直す」の順番そのもの。
    const tracker = createAccountTracker()
    let currentAccount: string | null = 'A'
    let refetches = 0
    const retryLikeTab = async (post: Promise<boolean>) => {
      const operation = tracker.track(currentAccount)
      const ok = await post
      if (!tracker.isCurrent(operation)) return 'skipped'
      if (!ok) throw new Error('retry failed')
      refetches += 1
      return 'applied'
    }

    const gate = deferred()
    const flight = retryLikeTab(gate.promise.then(() => true))
    // POSTの最中にBへ切り替え（画面の描き直しで世代が進む）。
    currentAccount = 'B'
    tracker.track(currentAccount)
    gate.resolve()
    await expect(flight).resolves.toBe('skipped')
    expect(refetches).toBe(0)
  })

  it('店が替わっていなければ読み直す', async () => {
    const tracker = createAccountTracker()
    let refetches = 0
    const retryLikeTab = async (post: Promise<boolean>) => {
      const operation = tracker.track('A')
      const ok = await post
      if (!tracker.isCurrent(operation)) return 'skipped'
      if (!ok) throw new Error('retry failed')
      refetches += 1
      return 'applied'
    }
    await expect(retryLikeTab(Promise.resolve(true))).resolves.toBe('applied')
    expect(refetches).toBe(1)
  })

  it('A→B→Aと戻っても、古いAの操作は今のAと別物にする', () => {
    const tracker = createAccountTracker()
    const firstA = tracker.track('A')
    tracker.track('B')
    const secondA = tracker.track('A')
    expect(tracker.isCurrent(firstA)).toBe(false)
    expect(tracker.isCurrent(secondA)).toBe(true)
  })

  it('POST成功後の最初の再取得中にA→Bへ切り替えても、二つ目を出さない', async () => {
    // やり直し関数の「掴む→POST待ち→確かめる→1つ目→確かめる→2つ目」の順番そのもの。
    const tracker = createAccountTracker()
    const guards = createMileageRewardsFetchGuards()
    let currentAccount: string | null = 'A'
    const applied: string[] = []
    const loadFailedLikeTab = async (gate: Promise<void>) => {
      const requestId = guards.redemptions.issue()
      await gate
      if (!guards.redemptions.isCurrent(requestId)) return 'dropped'
      applied.push('redemptions-A')
      return 'ok'
    }
    const loadLikeTab = () => {
      const requestId = guards.overview.issue()
      if (!guards.overview.isCurrent(requestId)) return 'dropped'
      applied.push('overview-A')
      return 'ok'
    }
    const retryLikeTab = async (post: Promise<boolean>, gate: Promise<void>) => {
      const operation = tracker.track(currentAccount)
      const ok = await post
      if (!ok) throw new Error('retry failed')
      if (!tracker.isCurrent(operation)) return 'skipped-before-first'
      await loadFailedLikeTab(gate)
      // 1つ目を待っている間に切り替わったら、2つ目は出さない。
      if (!tracker.isCurrent(operation)) return 'skipped-before-second'
      loadLikeTab()
      return 'done'
    }

    const postGate = deferred()
    const gate = deferred()
    const flight = retryLikeTab(postGate.promise.then(() => true), gate.promise)
    // POSTを成功させ、やり直しが1つ目の再取得待ちに入ってから切り替える。
    // マイクロタスクを空にして、やり直し側の続きを先に進める。
    postGate.resolve()
    await new Promise((done) => setTimeout(done, 0))
    // 1つ目の再取得待ちの最中にBへ切り替え。Bの取得も始まる。
    currentAccount = 'B'
    tracker.track(currentAccount)
    const overviewB = guards.overview.issue()
    const redemptionsB = guards.redemptions.issue()
    gate.resolve()
    await expect(flight).resolves.toBe('skipped-before-second')
    // 1つ目の遅い応答は捨てられ、Bの取得は生きている。
    expect(applied).toEqual([])
    expect(guards.overview.isCurrent(overviewB)).toBe(true)
    expect(guards.redemptions.isCurrent(redemptionsB)).toBe(true)
    // 参考：直前の確認が無ければ、古い閉じ込めが新しい世代を取ってBを上書きする。
    expect(loadLikeTab()).toBe('ok')
    expect(applied).toEqual(['overview-A'])
  })

  it('切り替えが無ければ二つの再取得をどちらも出す', async () => {
    const tracker = createAccountTracker()
    const guards = createMileageRewardsFetchGuards()
    const applied: string[] = []
    const retryLikeTab = async () => {
      const operation = tracker.track('A')
      await Promise.resolve(true)
      if (!tracker.isCurrent(operation)) return 'skipped-before-first'
      const redemptionsId = guards.redemptions.issue()
      if (guards.redemptions.isCurrent(redemptionsId)) applied.push('redemptions-A')
      if (!tracker.isCurrent(operation)) return 'skipped-before-second'
      const overviewId = guards.overview.issue()
      if (guards.overview.isCurrent(overviewId)) applied.push('overview-A')
      return 'done'
    }
    await expect(retryLikeTab()).resolves.toBe('done')
    expect(applied.sort()).toEqual(['overview-A', 'redemptions-A'])
  })
})
