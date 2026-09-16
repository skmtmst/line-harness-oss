import { describe, expect, it } from 'vitest'
import { isOpsTwoFactorReturn } from './admin-session'

describe('二段階認証後の戻り先', () => {
  it('query の next=ops を最優先で運営コンソールとして扱う', () => {
    expect(isOpsTwoFactorReturn('?next=ops', '', null)).toBe(true)
  })

  it('従来の hash と sessionStorage の印も後方互換で扱う', () => {
    expect(isOpsTwoFactorReturn('', '#lh_2fa=challenge&lh_next=ops', null)).toBe(true)
    expect(isOpsTwoFactorReturn('', '', 'ops')).toBe(true)
  })

  it('通常のログインは運営コンソールへ送らない', () => {
    expect(isOpsTwoFactorReturn('', '#lh_2fa=challenge', null)).toBe(false)
    expect(isOpsTwoFactorReturn('?next=hq', '', null)).toBe(false)
  })
})
