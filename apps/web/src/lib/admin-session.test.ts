// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { adminSessionHandoffPath, isOpsTwoFactorReturn } from './admin-session'

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

  it('クロスサイト用sessionを遷移先のfragmentにも引き渡す', () => {
    const url = new URL(adminSessionHandoffPath('/ops', 'opaque+/token=', 'csrf token'), 'https://test.invalid')
    const params = new URLSearchParams(url.hash.slice(1))
    expect(params.get('lh_session')).toBe('opaque+/token=')
    expect(params.get('lh_csrf')).toBe('csrf token')
    expect(params.get('lh_nonce')).toMatch(/^[0-9a-f-]{36}$/)
    expect(adminSessionHandoffPath('/ops', undefined, 'csrf')).toBe('/ops')
  })
})
