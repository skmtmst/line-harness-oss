import { describe, expect, it } from 'vitest'
import { buildSupportEmailInboxQuery } from './support-email-query'

describe('buildSupportEmailInboxQuery', () => {
  it('R110 選択中のLINEアカウントは件数と同じ条件で送る', () => {
    const query = new URLSearchParams(buildSupportEmailInboxQuery({
      status: 'all',
      query: '定期便',
      accountId: 'account-a',
    }))

    expect(query.get('channel')).toBe('email')
    expect(query.get('status')).toBe('all')
    expect(query.get('q')).toBe('定期便')
    expect(query.get('limit')).toBe('200')
    expect(query.get('lineAccountId')).toBe('account-a')
  })

  it('R110 アカウント未選択のときは送らず全メールのままにする', () => {
    const query = new URLSearchParams(buildSupportEmailInboxQuery({ status: 'all' }))

    expect(query.get('channel')).toBe('email')
    expect(query.has('lineAccountId')).toBe(false)
  })

  it('2ページ目以降はoffsetを付けて遡れる', () => {
    const first = new URLSearchParams(buildSupportEmailInboxQuery({ status: 'all' }))
    expect(first.has('offset')).toBe(false)

    const next = new URLSearchParams(buildSupportEmailInboxQuery({ status: 'all', offset: 200 }))
    expect(next.get('offset')).toBe('200')
    expect(next.get('limit')).toBe('200')
  })
})
