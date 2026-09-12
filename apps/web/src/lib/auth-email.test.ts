import { describe, expect, it } from 'vitest'
import { confirmError, emailError, isPublicAuthPath, passwordError, PUBLIC_AUTH_PATHS } from './auth-email'

describe('会員登録・ログインの入力の決まり（36-4）', () => {
  it('メールは @ の両側に何かあり、空白が無い', () => {
    expect(emailError('')).toContain('入力')
    expect(emailError('abc')).toContain('形式')
    expect(emailError('a b@example.com')).toContain('形式')
    expect(emailError(' owner@example.com ')).toBeNull()
  })

  it('パスワードは Worker と同じ決まり（8文字以上・英数・空白なし）', () => {
    expect(passwordError('abc1')).toContain('8文字')
    expect(passwordError('abcdefgh')).toContain('英字と数字')
    expect(passwordError('abcd 1234')).toContain('空白')
    expect(passwordError('abcdefg1')).toBeNull()
  })

  it('確認は一致だけを見る', () => {
    expect(confirmError('abcdefg1', '')).toContain('もう一度')
    expect(confirmError('abcdefg1', 'abcdefg2')).toContain('一致')
    expect(confirmError('abcdefg1', 'abcdefg1')).toBeNull()
  })
})

describe('ログイン前に開ける画面', () => {
  it('ログイン・登録 3 画面・再設定 2 画面。末尾の / があっても同じ', () => {
    expect([...PUBLIC_AUTH_PATHS]).toEqual(['/login', '/login/two-factor', '/register', '/register/sent', '/register/complete', '/password/forgot', '/password/reset'])
    expect(isPublicAuthPath('/register/complete/')).toBe(true)
    expect(isPublicAuthPath('/hq')).toBe(false)
    expect(isPublicAuthPath(null)).toBe(false)
  })
})
