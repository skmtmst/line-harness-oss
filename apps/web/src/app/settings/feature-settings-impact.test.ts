import { describe, expect, it } from 'vitest'
import { createAccountRequestGuard } from '@/v8/settings/features/account-request-guard'

describe('機能設定のアカウント境界', () => {
  it('Aで取った応答をBへ混ぜず、Aの版でBへ保存しない', async () => {
    const guard = createAccountRequestGuard()
    // Aで読み始める。
    const ticketA = guard.issue('account-a')
    expect(guard.isCurrent(ticketA, 'account-a')).toBe(true)
    // Bへ切り替える。
    guard.advance()
    // 遅れて届いたAの応答は捨てる。
    expect(guard.isCurrent(ticketA, 'account-a')).toBe(false)
    // Aの切符をBの画面に使えない。
    expect(guard.isCurrent(ticketA, 'account-b')).toBe(false)
    // Bで取り直した応答だけ通る。
    const ticketB = guard.issue('account-b')
    expect(guard.isCurrent(ticketB, 'account-b')).toBe(true)
    expect(guard.isCurrent(ticketB, 'account-a')).toBe(false)
    // Aに戻っても古い切符は復活しない。
    guard.advance()
    expect(guard.isCurrent(ticketA, 'account-a')).toBe(false)
  })
})
