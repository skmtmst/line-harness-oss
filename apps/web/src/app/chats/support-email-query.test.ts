import { describe, expect, it } from 'vitest'
import { buildSupportEmailInboxQuery } from './support-email-query'

describe('buildSupportEmailInboxQuery', () => {
  it('LINEアカウントの選択に関係なくメール問い合わせを取得する', () => {
    const query = new URLSearchParams(buildSupportEmailInboxQuery({
      status: 'all',
      query: '定期便',
    }))

    expect(query.get('channel')).toBe('email')
    expect(query.get('status')).toBe('all')
    expect(query.get('q')).toBe('定期便')
    expect(query.get('limit')).toBe('200')
    expect(query.has('lineAccountId')).toBe(false)
  })
})
