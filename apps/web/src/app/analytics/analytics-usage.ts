import type { AnalyticsUsageOverview } from '@/lib/api'
import {
  DEFAULT_FEATURES,
  SPECIALIZED_FEATURE_KEYS,
  itemIsEnabled,
  visibleFeatureGroups,
} from '@/lib/feature-settings'

type FeatureSettings = {
  features: Record<string, boolean>
  specializedFeatureKeys?: string[]
}

export function summarizeMenuFeatures(settings: FeatureSettings): { enabled: number; total: number } {
  const features = { ...DEFAULT_FEATURES, ...settings.features }
  const items = visibleFeatureGroups({
    // staff向けread-modelは専用目録を返さない。表示可否へ畳み込まれた
    // booleanから、実際に表示できる専用項目だけを復元する。
    specializedFeatureKeys: settings.specializedFeatureKeys
      ?? SPECIALIZED_FEATURE_KEYS.filter((key) => settings.features[key] === true),
  }).flatMap((group) => group.items)
  return {
    enabled: items.filter((item) => itemIsEnabled(item, features)).length,
    total: items.length,
  }
}

export function usageObservation(
  item: AnalyticsUsageOverview['data']['categories'][number],
): { text: string; tone: 'normal' | 'warning' | 'unknown' } {
  if (item.brokenReferences.value !== null && item.brokenReferences.value > 0) {
    return { text: `参照切れが${item.brokenReferences.value}件あります`, tone: 'warning' }
  }
  if (item.unused.value !== null && item.unused.value > 0) {
    return { text: `${item.unused.value}個は使われていません`, tone: 'warning' }
  }
  if (item.unused.value === 0) return { text: 'すべて利用中です', tone: 'normal' }
  return { text: item.unused.reason ?? '利用状況を確認できません', tone: 'unknown' }
}

export function canTidyUsage(
  item: AnalyticsUsageOverview['data']['categories'][number],
): boolean {
  return item.unused.value !== null && item.unused.value > 0
}
