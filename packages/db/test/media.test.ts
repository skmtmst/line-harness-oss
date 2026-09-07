import { describe, expect, it, vi } from 'vitest'
import { countMedia, getMedia } from '../src/media.js'

describe('登録メディア一覧', () => {
  it('使用先件数を同じ問い合わせで取得する', async () => {
    const all = vi.fn().mockResolvedValue({
      results: [
        {
          id: 'media-1',
          filename: '案内.png',
          usage_count: 4,
        },
      ],
    })
    const bind = vi.fn(() => ({ all }))
    const prepare = vi.fn(() => ({ bind }))
    const db = { prepare } as unknown as D1Database

    const rows = await getMedia(db, { lineAccountId: 'account-1' })

    const sql = String(prepare.mock.calls[0]?.[0])
    expect(sql).toContain('FROM media_usages u WHERE u.media_id = m.id')
    expect(sql).toContain('m.line_account_id = ?')
    expect(rows[0]?.usage_count).toBe(4)
    expect(bind).toHaveBeenCalledWith('account-1', 200, 0)
  })

  it('201件目をoffsetで取得し、総件数を別に返せる', async () => {
    const all = vi.fn().mockResolvedValue({ results: [{ id: 'media-201' }] })
    const first = vi.fn().mockResolvedValue({ total: 201 })
    const prepare = vi.fn((sql: string) => sql.includes('COUNT(*) AS total')
      ? { bind: vi.fn(() => ({ first })) }
      : { bind: vi.fn((...values: unknown[]) => {
          expect(values.at(-2)).toBe(1)
          expect(values.at(-1)).toBe(200)
          return { all }
        }) })
    const db = { prepare } as unknown as D1Database

    const [items, total] = await Promise.all([
      getMedia(db, { lineAccountId: 'account-1', limit: 1, offset: 200 }),
      countMedia(db, { lineAccountId: 'account-1' }),
    ])

    expect(items[0]?.id).toBe('media-201')
    expect(total).toBe(201)
  })

  it('差し替え元を除いた候補だけを数える', async () => {
    const all = vi.fn().mockResolvedValue({ results: [] })
    const first = vi.fn().mockResolvedValue({ total: 50 })
    const binds: unknown[][] = []
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => {
        binds.push(values)
        return sql.includes('COUNT(*) AS total') ? { first } : { all }
      }),
    }))
    const db = { prepare } as unknown as D1Database

    await getMedia(db, { lineAccountId: 'account-1', kind: 'image', excludeId: 'source-1', limit: 50 })
    await countMedia(db, { lineAccountId: 'account-1', kind: 'image', excludeId: 'source-1' })

    expect(prepare.mock.calls.every(([sql]) => String(sql).includes('m.id != ?'))).toBe(true)
    expect(binds[0]).toEqual(['account-1', 'image', 'source-1', 50, 0])
    expect(binds[1]).toEqual(['account-1', 'image', 'source-1'])
  })
})
