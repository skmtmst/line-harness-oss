import { beforeEach, describe, expect, it, vi } from 'vitest'
import { accountsMethods } from './accounts'

const fetchApi = vi.hoisted(() => vi.fn())
vi.mock('../transport/request', () => ({ fetchApi }))

beforeEach(() => fetchApi.mockReset())

describe('友だち引き継ぎのAPI要求', () => {
  it('ステップPOSTには有効なJSON本文を付ける', async () => {
    await accountsMethods.lineAccounts.stepFollowerImport('the-shed')
    expect(fetchApi).toHaveBeenCalledWith('/api/line-accounts/the-shed/follower-import/step', {
      method: 'POST', body: '{}',
    })
  })
})
