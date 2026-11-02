import { describe, expect, it } from 'vitest'
import { eventOperationAccounts } from './event-draft-shared'

describe('イベントの操作対象', () => {
  it('保存された共有先の順序を保ち重複だけ除く', () => {
    expect(eventOperationAccounts({ target_type: 'multi-account-dedup', account_ids: '["a","b","a"]' }, 'a')).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('対象が不明な応答は選択中のアカウントで穴埋めしない', () => {
    for (const account_ids of [null, '壊れた値', '[]', '["a",null]']) {
      expect(eventOperationAccounts({ target_type: 'multi-account-dedup', account_ids }, 'a')).toEqual([{ id: '' }])
    }
    expect(eventOperationAccounts({ account_ids: null }, 'a')).toEqual([{ id: '' }])
  })
})
