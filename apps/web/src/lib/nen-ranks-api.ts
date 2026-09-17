import { fetchApi } from './api'
import type { ApiResponse } from '@line-crm/shared'

/**
 * 然-NEN- 会員（ランク・ライフタイム・マイル）。★V6 37-1／37-1-A／37-1-B。
 * Worker `apps/worker/src/routes/nen-ranks.ts`。
 */

export interface NenRank {
  id: string
  key: string
  name: string
  annualThresholdYen: number
  mileRatePercent: number
  tagId: string | null
  tagName: string | null
  memberCount: number
}

export interface NenRankRules {
  yearStartMonth: number
  applyOnReach: string
  keepUntil: string
  countOrders: string
  version: number
  syncStatus: 'pending' | 'synced' | 'failed'
  syncError: string | null
  syncedAt: string | null
  updatedAt: string
}

export interface NenLifetimeMilestone {
  id: string
  thresholdYen: number
  title: string
  benefitKind: string | null
  benefitNote: string | null
  notifyOnReach: boolean
  reachedCount: number
}

export interface NenMemberKpis {
  members: number
  annualTotalYen: number
  lifetimeTotalYen: number
  balanceTotal: number
  usedThisMonth: number
  byRank: Record<string, number>
}

export interface NenRankSettingsData {
  ranks: NenRank[]
  rules: NenRankRules | null
  milestones: NenLifetimeMilestone[]
  kpis: NenMemberKpis
  sync?: { status: 'synced' | 'failed' | 'skipped'; error: string | null }
}

export interface NenMemberRow {
  friendId: string
  name: string
  pictureUrl: string | null
  customerId: string | null
  rankKey: string | null
  rankName: string
  mileRatePercent: number | null
  annualMilesYen: number
  lifetimeMilesYen: number
  mileBalance: number
  rankValidUntil: string | null
  lastPurchasedAt: string | null
  purchaseCount: number
  petCount: number
  petNames: string | null
  syncedAt: string
}

export interface NenMemberListData {
  items: NenMemberRow[]
  total: number
  page: number
  pageSize: number
  kpis: NenMemberKpis
  ranks: Array<{ key: string; name: string; annualThresholdYen: number; mileRatePercent: number }>
}

export type NenMemberSort = 'annual_desc' | 'lifetime_desc' | 'balance_desc' | 'recent'

export interface NenFeedingProduct {
  id: string
  name: string
  kcalPer100g: number
  isDefault: boolean
}

export interface NenFeedingData {
  products: NenFeedingProduct[]
  petCount: number
  refreshedPets?: number
}

export const nenRanksApi = {
  feeding: (accountId: string) =>
    fetchApi<ApiResponse<NenFeedingData>>(`/api/nen/feeding-products?accountId=${encodeURIComponent(accountId)}`),
  saveFeeding: (accountId: string, products: Array<{ id?: string | null; name: string; kcalPer100g: number; isDefault: boolean }>) =>
    fetchApi<ApiResponse<NenFeedingData>>('/api/nen/feeding-products', {
      method: 'PUT', body: JSON.stringify({ accountId, products }),
    }),
  settings: (accountId: string) =>
    fetchApi<ApiResponse<NenRankSettingsData>>(`/api/nen/rank-settings?accountId=${encodeURIComponent(accountId)}`),
  saveRanks: (accountId: string, ranks: Array<{ id?: string | null; name: string; annualThresholdYen: number; mileRatePercent: number }>) =>
    fetchApi<ApiResponse<NenRankSettingsData>>('/api/nen/rank-settings', {
      method: 'PUT', body: JSON.stringify({ accountId, ranks }),
    }),
  saveMilestones: (accountId: string, milestones: Array<{ id?: string | null; thresholdYen: number; title: string; notifyOnReach: boolean }>) =>
    fetchApi<ApiResponse<NenRankSettingsData>>('/api/nen/lifetime-milestones', {
      method: 'PUT', body: JSON.stringify({ accountId, milestones }),
    }),
  resync: (accountId: string) =>
    fetchApi<ApiResponse<NenRankSettingsData>>('/api/nen/rank-settings/resync', {
      method: 'POST', body: JSON.stringify({ accountId }),
    }),
  members: (accountId: string, params: { rank?: string; pet?: 'any' | 'with' | 'without'; q?: string; sort?: NenMemberSort; page?: number } = {}) => {
    const search = new URLSearchParams({ accountId })
    if (params.rank) search.set('rank', params.rank)
    if (params.pet && params.pet !== 'any') search.set('pet', params.pet)
    if (params.q) search.set('q', params.q)
    if (params.sort) search.set('sort', params.sort)
    if (params.page && params.page > 1) search.set('page', String(params.page))
    return fetchApi<ApiResponse<NenMemberListData>>(`/api/nen/members?${search.toString()}`)
  },
}
