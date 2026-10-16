import type { TrafficPool } from '@line-crm/shared'
/** 既定のプール（main）を先頭に、あとは作った順。 */
export function orderPools(pools: readonly TrafficPool[]): TrafficPool[] {
  return [...pools].sort((a, b) => {
    if (a.slug === 'main') return -1
    if (b.slug === 'main') return 1
    return a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name, 'ja')
  })
}
