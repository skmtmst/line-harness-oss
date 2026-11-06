import { describe, expect, it } from 'vitest'
import { isDuplicateChannelError, matchRegisteredAccountId } from './account-recovery'

/**
 * R523: 保存の応答消失・重複時に、登録済み1件を特定して詳細へ復帰する。
 */
describe('R523 登録済みアカウントの照合', () => {
  const accounts = [
    { id: 'acc-a', channelId: '2007000001' },
    { id: 'acc-b', channelId: '2007000002' },
  ]

  it('同じチャネルIDが1件だけならその詳細へ復帰できる', () => {
    expect(matchRegisteredAccountId(accounts, '2007000002')).toBe('acc-b')
    expect(matchRegisteredAccountId(accounts, '  2007000002  ')).toBe('acc-b')
  })

  it('0件・複数・空文字は特定しない（行き止まりにしない）', () => {
    expect(matchRegisteredAccountId(accounts, '2007999999')).toBeNull()
    expect(matchRegisteredAccountId([...accounts, { id: 'acc-c', channelId: '2007000002' }], '2007000002')).toBeNull()
    expect(matchRegisteredAccountId(accounts, '')).toBeNull()
    expect(matchRegisteredAccountId(accounts, '   ')).toBeNull()
  })

  it('サーバの重複エラーの目印を見分ける', () => {
    expect(isDuplicateChannelError('channelId already registered')).toBe(true)
    expect(isDuplicateChannelError('UNIQUE constraint failed: line_accounts.channel_id')).toBe(true)
    expect(isDuplicateChannelError('認証状態を確認できなかったため、アカウントは保存していません')).toBe(false)
    expect(isDuplicateChannelError('')).toBe(false)
  })
})
