import type { AdvancedSearchResult } from '@/components/friends/advanced-search-dialog'
export function scoreBoundary(raw: string | null) {
  if (raw === null || !/^-?\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

export function validAdvancedSearch(value: unknown): value is AdvancedSearchResult | null {
  if (value === null) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Partial<AdvancedSearchResult>
  return !!result.params && typeof result.params === 'object' && !Array.isArray(result.params)
    && Array.isArray(result.summary) && result.summary.every(item => typeof item === 'string')
}
