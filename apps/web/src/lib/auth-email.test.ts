import { describe, expect, it } from 'vitest'
import { confirmError, emailError, isPublicAuthPath, passwordError, PUBLIC_AUTH_PATHS } from './auth-email'

describe('会員登録・ログインの入力の決まり（36-4）', () => {
  it('メールは @ の両側に何かあり、空白が無い', () => {
    expect(emailError('')).toContain('入力')
    expect(emailError('abc')).toContain('形式')
    expect(emailError('a b@example.com')).toContain('形式')
    expect(emailError(' owner@example.com ')).toBeNull()
  })

  it('パスワードは Worker と同じ決まり（13文字以上・大小英字・数字・特殊記号）', () => {
    expect(passwordError('abc1')).toContain('13文字')
    expect(passwordError('a'.repeat(13))).toContain('英大文字')
    expect(passwordError('A'.repeat(13))).toContain('英小文字')
    expect(passwordError('Aa'.repeat(7))).toContain('数字')
    expect(passwordError('Aa1'.repeat(5))).toContain('特殊記号')
    expect(passwordError('Aa1! '.repeat(3))).toContain('空白')
    expect(passwordError('StrongPassword1!')).toBeNull()
  })

  it('確認は一致だけを見る', () => {
    expect(confirmError('abcdefg1', '')).toContain('もう一度')
    expect(confirmError('abcdefg1', 'abcdefg2')).toContain('一致')
    expect(confirmError('abcdefg1', 'abcdefg1')).toBeNull()
  })
})

describe('ログイン前に開ける画面', () => {
  it('ログイン・招待・メール変更・登録 3 画面・再設定 2 画面・運営ログインと運営の招待。末尾の / があっても同じ', () => {
    expect([...PUBLIC_AUTH_PATHS]).toEqual(['/login', '/login/two-factor', '/login/two-factor/setup', '/staff/invite', '/staff/email-change', '/register', '/register/sent', '/register/complete', '/password/forgot', '/password/reset', '/ops/login', '/ops/invite'])
    expect(isPublicAuthPath('/staff/invite')).toBe(true)
    expect(isPublicAuthPath('/staff/email-change')).toBe(true)
    expect(isPublicAuthPath('/register/complete/')).toBe(true)
    expect(isPublicAuthPath('/hq')).toBe(false)
    expect(isPublicAuthPath(null)).toBe(false)
  })
})
