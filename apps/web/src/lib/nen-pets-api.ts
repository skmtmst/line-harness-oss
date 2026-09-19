import { fetchApi } from './api'
import type { ApiResponse } from '@line-crm/shared'

/**
 * 然-NEN- マイペット（★V6 37-3）／健康日記（★V6 37-4）。
 * Worker `apps/worker/src/routes/nen-pets.ts`。ペットの正本は LINE 側（お客様がマイページで登録・更新）。
 */

export type PetNeutered = 'yes' | 'no' | 'unknown'
export type PetActivity = 'low' | 'normal' | 'high'

export interface NenPetRow {
  id: string
  name: string
  /** 呼び名（男の子＝くん、女の子＝ちゃん） */
  callName: string
  gender: 'male' | 'female' | 'unknown'
  animalType: 'dog' | 'cat' | 'other'
  breed: string
  birthday: string | null
  ageLabel: string
  weightKg: number | null
  neutered: PetNeutered
  activityLevel: PetActivity
  activityLabel: string
  productName: string | null
  feeding: { dailyKcal: number; dailyGrams: number | null; factorLabel: string; stageLabel: string; venisonGrams: number | null; venisonKcal: number; treatName: string | null } | null
  imageUrl: string | null
  updatedAt: string
  weightStale: boolean
  owner: { friendId: string; name: string; pictureUrl: string | null; customerId: string | null }
}

export interface NenPetKpis {
  total: number
  dogs: number
  cats: number
  newThisMonth: number
  computable: number
  staleWeight: number
}

export interface NenPetListData {
  items: NenPetRow[]
  total: number
  page: number
  pageSize: number
  kpis: NenPetKpis
  products: Array<{ id: string; name: string }>
  treatLimitPercent: number
}

export type NenPetSort = 'updated_desc' | 'name' | 'weight_desc' | 'age_desc'
export type NenPetWeightFilter = '' | 'stale' | 'fresh'

export interface NenHealthChange {
  key: 'weight_drop' | 'weight_gain' | 'stool_abnormal' | 'appetite_poor' | 'silent'
  label: string
  tone: 'warn' | 'faint'
}

export interface NenHealthRow {
  pet: { id: string; name: string; callName: string; animalType: 'dog' | 'cat'; breed: string; ageLabel: string; imageUrl: string | null }
  owner: { friendId: string; name: string; customerId: string | null }
  lastLoggedOn: string | null
  lastLoggedLabel: string
  daysSinceLast: number | null
  count30d: number
  totalRecords: number
  weightSeries: Array<number | null>
  latestWeightKg: number | null
  weightChangePercent: number | null
  latestStool: string | null
  latestAppetite: string | null
  changes: NenHealthChange[]
  concerning: boolean
}

export interface NenHealthKpis {
  recordsThisWeek: number
  petsWithRecords: number
  petsTotal: number
  concerning: number
  silent30: number
}

export interface NenHealthListData {
  items: NenHealthRow[]
  total: number
  page: number
  pageSize: number
  kpis: NenHealthKpis
}

export type NenHealthChangeFilter = '' | 'concern' | 'silent' | 'none'
export type NenHealthLastFilter = '' | '7' | '30' | 'over30'
export type NenHealthSort = 'concern' | 'recent' | 'records_desc'

export interface NenHealthSummaryData {
  pet: { id: string; name: string; callName: string; animalType: 'dog' | 'cat'; breed: string; ageLabel: string; weightKg: number | null }
  owner: { friendId: string; name: string }
  generatedAt: string
  summary: {
    days: number
    records: number
    weight: { first: number; last: number; min: number; max: number } | null
    heartRateAvg: number | null
    respiratoryRateAvg: number | null
    stool: Record<string, number>
    appetite: Record<string, number>
    skin: Record<string, number>
    tearStain: Record<string, number>
    notes: Array<{ loggedOn: string; note: string }>
    logs: Array<{
      loggedOn: string; weightKg: number | null; heartRateBpm: number | null; respiratoryRateBpm: number | null
      stool: string; appetite: string; skin: string | null; tearStain: string | null
    }>
  }
  labels: { stool: Record<string, string>; appetite: Record<string, string> }
}

function qs(params: Record<string, string | number | undefined>): string {
  const out = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') out.set(key, String(value))
  }
  return out.toString()
}

export const nenPetsApi = {
  pets: (accountId: string, params: { q?: string; species?: string; product?: string; weight?: NenPetWeightFilter; sort?: NenPetSort; page?: number; pageSize?: number | 'all' } = {}) =>
    fetchApi<ApiResponse<NenPetListData>>(`/api/nen/pets?${qs({ accountId, ...params })}`),
  health: (accountId: string, params: { q?: string; change?: NenHealthChangeFilter; last?: NenHealthLastFilter; sort?: NenHealthSort; page?: number } = {}) =>
    fetchApi<ApiResponse<NenHealthListData>>(`/api/nen/health?${qs({ accountId, ...params })}`),
  healthSummary: (accountId: string, petId: string) =>
    fetchApi<ApiResponse<NenHealthSummaryData>>(`/api/nen/health/${encodeURIComponent(petId)}/summary?${qs({ accountId })}`),
}
