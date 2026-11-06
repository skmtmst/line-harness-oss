import { describe, expect, it } from 'vitest'
import {
  describeMileageCsvExportFailure,
  mileageConnectedAccounts,
  mileagePaginationTotal,
  mileageRewardedActions,
} from './mileage-response-state'

describe('マイルAPIの未取得値', () => {
  it('pagination の入れ子が欠けても 0 件にせず未取得にする', () => {
    expect(mileagePaginationTotal(null)).toBeNull()
    expect(mileagePaginationTotal({})).toBeNull()
    expect(mileagePaginationTotal({ pagination: null })).toBeNull()
    expect(mileagePaginationTotal({ pagination: {} })).toBeNull()
    expect(mileagePaginationTotal({ pagination: { total: 0 } })).toBe(0)
    expect(mileagePaginationTotal({ pagination: { total: 12 } })).toBe(12)
  })

  it('付与記録の未取得と実値0を分ける', () => {
    expect(mileageRewardedActions(null)).toBeNull()
    expect(mileageRewardedActions({})).toBeNull()
    expect(mileageRewardedActions({ rewardedActions: 0 })).toBe(0)
    expect(mileageRewardedActions({ rewardedActions: 3 })).toBe(3)
  })

  it('M503: CSV書き出しの通信断で権限確認を案内しない', () => {
    // 通信断（応答なし）だけ通信の確認。
    expect(describeMileageCsvExportFailure(null)).toContain('通信を確認')
    // 403 だけ権限の確認。
    expect(describeMileageCsvExportFailure(403)).toContain('権限を確認')
    expect(describeMileageCsvExportFailure(403)).not.toContain('通信を確認')
    // 取れない応答（500など）は時間をおいての案内。
    expect(describeMileageCsvExportFailure(500)).toContain('時間をおいて')
    expect(describeMileageCsvExportFailure(500)).not.toContain('権限を確認')
    expect(describeMileageCsvExportFailure(500)).not.toContain('通信を確認')
  })

  it('接続先の未取得と取得できた空配列を分ける', () => {
    expect(mileageConnectedAccounts(undefined)).toBeNull()
    expect(mileageConnectedAccounts({})).toBeNull()
    expect(mileageConnectedAccounts([])).toEqual([])
    expect(mileageConnectedAccounts([{ accountId: 'account-1', accountName: '本店', friendId: 'friend-1' }]))
      .toHaveLength(1)
  })
})
