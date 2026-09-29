import { describe, expect, it } from 'vitest'
import { isCurrentTagListRequest } from './tag-list-state'

describe('tag list request ownership', () => {
  it('rejects a late response from the store selected before the current one', () => {
    const storeA = { accountId: 'account-a', generation: 1 }
    const storeB = { accountId: 'account-b', generation: 2 }

    expect(isCurrentTagListRequest(storeB, storeB)).toBe(true)
    expect(isCurrentTagListRequest(storeB, storeA)).toBe(false)
  })

  it('rejects an earlier refresh even when the selected store is unchanged', () => {
    expect(isCurrentTagListRequest(
      { accountId: 'account-a', generation: 3 },
      { accountId: 'account-a', generation: 2 },
    )).toBe(false)
  })
})
