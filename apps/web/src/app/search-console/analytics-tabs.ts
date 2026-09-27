import type { MergedTab } from '@/components/layout/merged-tabs'

/**
 * 分析タブの定義。Search Console 画面と試験で共有する。
 * Next.js の page.tsx からは default 以外を export できないため、
 * ここに切り出して page.tsx と試験の両方から import する。
 */
export const ANALYTICS_TABS: readonly MergedTab[] = [
  { key: 'messages', label: '送信数' },
  { key: 'funnel', label: 'ファネル' },
  { key: 'cross', label: 'クロス集計' },
  { key: 'url-clicks', label: 'URLクリック' },
  { key: 'search', label: 'Search Console', href: '/search-console' },
]
