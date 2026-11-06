import { describe, expect, it } from 'vitest'
import type { TrafficPool } from '@line-crm/shared'
import { orderPools } from './pools'

const pool = (slug: string, name: string, createdAt: string): TrafficPool => ({
  id: slug, slug, name, activeAccountId: null, isActive: true, createdAt, updatedAt: createdAt,
})

describe('★V8 プール管理（u3iab3）の並び', () => {
  it('既定のプール（main）を先頭に、あとは作った順', () => {
    const ordered = orderPools([
      pool('event', 'イベント用', '2026-06-02T00:00:00.000Z'),
      pool('main', '既定', '2026-07-01T00:00:00.000Z'),
      pool('shibuya', '渋谷エリア', '2026-06-01T00:00:00.000Z'),
    ])
    expect(ordered.map((p) => p.slug)).toEqual(['main', 'shibuya', 'event'])
  })
})
