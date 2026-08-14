import { describe, expect, it, vi } from 'vitest'
import { shouldShowReferralRow } from './visibility'

describe('shouldShowReferralRow', () => {
  it('keeps a newly created route visible when no Pool is assigned', () => {
    const poolRoutesToAccount = vi.fn(() => false)
    expect(shouldShowReferralRow({
      source: 'entry_route',
      poolId: null,
      friendCount: 0,
    }, 'account-1', poolRoutesToAccount)).toBe(true)
    expect(poolRoutesToAccount).not.toHaveBeenCalled()
  })

  it('still filters Pool-assigned routes by the selected account', () => {
    expect(shouldShowReferralRow({
      source: 'entry_route',
      poolId: 'pool-1',
      friendCount: 0,
    }, 'account-1', () => false)).toBe(false)
  })
})
