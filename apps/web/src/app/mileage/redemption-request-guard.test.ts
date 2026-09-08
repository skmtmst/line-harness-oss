/*
 * 世代札の振る舞い。A→B と店を切り替えたとき、遅れて届いた A の応答で
 * B の画面を上書きしないことが要点。DOM は要らないので node で回す。
 */
import { describe, expect, it } from 'vitest'

import { createRequestGuard } from './redemption-request-guard'

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
