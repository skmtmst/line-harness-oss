import { describe, expect, it } from 'vitest'
import { conflictMessage, formatSavedAt } from './form-conflict-message'

/**
 * 競合(409)の言い方(#723)。
 *
 * 保管・削除の「影響が変わりました」とは意味が違う。混ぜると運用者が次に
 * することを間違えるので、言い方が分かれていることを固定する。
 */
describe('編集保存が競合したときの言い方', () => {
  it('相手がいつ保存したかを日本時間で添える', () => {
    // +09:00 の 14:32。別の時差から見ても日本時間で出す。
    expect(conflictMessage('2026-09-11T14:32:00.000+09:00'))
      .toBe('ほかの人が9/11 14:32に先に保存しました。最新の内容を読み込んでから、もう一度お試しください。')
    expect(conflictMessage('2026-09-11T05:32:00.000Z'))
      .toContain('9/11 14:32')
  })

  it('時刻が読めないときは嘘の時刻を出さず、時刻なしで言う', () => {
    for (const broken of ['', 'あとで', 'not-a-date']) {
      expect(formatSavedAt(broken)).toBe('')
      expect(conflictMessage(broken))
        .toBe('ほかの人が先に保存しました。最新の内容を読み込んでから、もう一度お試しください。')
    }
  })

  it('保管・削除の文言を流用しない', () => {
    // あちらは「回答や利用先が増えた」という意味。ここは「人が先に保存した」。
    expect(conflictMessage('2026-09-11T14:32:00.000+09:00')).not.toContain('影響が変わりました')
  })
})
