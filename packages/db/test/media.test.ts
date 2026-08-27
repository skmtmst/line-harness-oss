import { describe, expect, it, vi } from 'vitest'
import { getMedia } from '../src/media.js'

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

    const rows = await getMedia(db)

    const sql = String(prepare.mock.calls[0]?.[0])
    expect(sql).toContain('FROM media_usages u WHERE u.media_id = m.id')
    expect(rows[0]?.usage_count).toBe(4)
    expect(bind).toHaveBeenCalledWith(200)
  })
})
