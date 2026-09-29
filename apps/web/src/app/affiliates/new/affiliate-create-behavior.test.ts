import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const AFFILIATE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const OFFER = readFileSync(new URL('../../affiliate-offers/new/page.tsx', import.meta.url), 'utf8')

describe('アフィリエイト登録の入力と検索', () => {
  it('友だちを20件ずつ検索し、2ページ目は21件目から取得する', () => {
    expect(AFFILIATE).toContain('const FRIEND_PAGE_SIZE = 20')
    expect(AFFILIATE).toContain('offset: String((Math.max(1, page) - 1) * FRIEND_PAGE_SIZE)')
    expect(AFFILIATE).toContain('search: search.trim() || undefined')
    expect(AFFILIATE).toContain('aria-label="友だち候補のページ"')
  })

  it('割合0%を空欄と区別して保存対象にできる', () => {
    expect(AFFILIATE).toContain('rate < 0 || rate > 100')
    expect(AFFILIATE).not.toContain('rate <= 0')
    expect(AFFILIATE).toContain("commissionRate.trim() ? Number(commissionRate) : undefined")
  })

  it('案件の小数報酬を日本語で送信前に止める', () => {
    expect(OFFER).toContain('Number.isInteger(reward)')
    expect(OFFER).toContain('報酬額は小数ではなく、1円単位の整数で入力してください')
    expect(OFFER).toContain('報酬マイルは小数ではなく、整数で入力してください')
    expect(OFFER).toContain('step={1}')
  })
})
