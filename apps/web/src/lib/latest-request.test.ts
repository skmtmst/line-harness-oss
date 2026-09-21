import { describe, expect, it } from 'vitest'
import { createResponseGate } from './latest-request'

describe('createResponseGate（古い応答を捨てる世代管理）', () => {
  it('最後に始めた要求だけが最新になる', () => {
    const gate = createResponseGate()
    const first = gate.begin()
    const second = gate.begin()
    expect(gate.current(first)).toBe(false)
    expect(gate.current(second)).toBe(true)
  })

  it('invalidate で飛んでいる要求がすべて古い扱いになる', () => {
    const gate = createResponseGate()
    const inFlight = gate.begin()
    gate.invalidate()
    expect(gate.current(inFlight)).toBe(false)
    // 無効化のあとに始めた要求は最新として通る
    const next = gate.begin()
    expect(gate.current(next)).toBe(true)
  })

  it('条件変更→古い応答到着→新しい要求の順でも新しい要求だけ通る', () => {
    const gate = createResponseGate()
    const stale = gate.begin()
    gate.invalidate() // 利用者が条件を変えた
    const fresh = gate.begin()
    expect(gate.current(stale)).toBe(false)
    expect(gate.current(fresh)).toBe(true)
  })
})
