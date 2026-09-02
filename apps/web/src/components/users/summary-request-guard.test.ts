import { describe, expect, it } from 'vitest'
import { createLatestRequestGuard } from './summary-request-guard'

describe('統合ユーザー指標の読み込み世代', () => {
  it('新しい読み込みを始めたら、先に始めた返事を採用しない', () => {
    const guard = createLatestRequestGuard()
    const first = guard.begin()
    const second = guard.begin()

    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  it('画面を離れた後に届いた返事を採用しない', () => {
    const guard = createLatestRequestGuard()
    const request = guard.begin()
    guard.invalidate()

    expect(guard.isCurrent(request)).toBe(false)
  })
})
