import { describe, expect, it } from 'vitest'
import { isTwoFactorChallengeGone, twoFactorFailureMessage } from './two-factor-error'

/**
 * R506: 二段階認証の失敗文。通信断の技術文言や予期しない本文を
 * そのまま出さず、日本語の理由と再試行の案内にする。
 * サーバーが返した日本語の理由（誤コード・期限切れ・回数制限）はそのまま出す。
 */
describe('二段階認証の失敗文（R506）', () => {
  it('通信断（TypeError）は接続確認と再試行の案内にする', () => {
    expect(twoFactorFailureMessage(new TypeError('Failed to fetch'))).toBe(
      '通信が切れています。接続を確かめて、もう一度お試しください。',
    )
  })

  it('技術文言を持つ失敗も接続案内にする', () => {
    expect(twoFactorFailureMessage(new Error('Network request failed'))).toBe(
      '通信が切れています。接続を確かめて、もう一度お試しください。',
    )
  })

  it('サーバーの日本語の理由（誤コード）はそのまま出す', () => {
    expect(twoFactorFailureMessage(new Error('認証コードが正しくありません'))).toBe(
      '認証コードが正しくありません',
    )
  })

  it('サーバーの回数制限・期限切れの理由はそのまま出す', () => {
    expect(twoFactorFailureMessage(new Error('入力回数を超えました。ログインからやり直してください'))).toBe(
      '入力回数を超えました。ログインからやり直してください',
    )
  })

  it('予期しない応答本文は汎用文にする', () => {
    expect(twoFactorFailureMessage(new SyntaxError('Unexpected token < in JSON'))).toBe(
      '認証できませんでした',
    )
  })

  it('Error以外は汎用文にする', () => {
    expect(twoFactorFailureMessage(null)).toBe('認証できませんでした')
  })

  it('呼び出し側の汎用文を指定できる', () => {
    expect(twoFactorFailureMessage(null, '登録を完了できませんでした')).toBe(
      '登録を完了できませんでした',
    )
    expect(twoFactorFailureMessage(new SyntaxError('x'), '登録を完了できませんでした')).toBe(
      '登録を完了できませんでした',
    )
  })
})

/**
 * R508: 合言葉が使えなくなった確認応答（期限切れ401・回数制限429）。
 * 入力欄を終わらせてログインへ戻す。誤コード400などは入力を直せるままにする。
 */
describe('合言葉の失効判定（R508）', () => {
  it.each([401, 429])('%i は合言葉が使えなくなった応答', (status) => {
    expect(isTwoFactorChallengeGone(status)).toBe(true)
  })

  it.each([200, 400, 409, 500, 503])('%i は入力を直せる応答のまま', (status) => {
    expect(isTwoFactorChallengeGone(status)).toBe(false)
  })
})
