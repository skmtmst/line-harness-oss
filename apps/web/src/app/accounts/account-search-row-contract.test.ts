import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * 板 V7vn3：検索と絞り込みは同じ白い板に入れる。
 * 検索欄は1つだけ。件数は絞り込みの行にまとめる。
 */
const searchRowBlock = (): string => {
  const start = PAGE.indexOf('data-search-row')
  const end = PAGE.indexOf('</div>', start)
  return PAGE.slice(start, end)
}

describe('V7vn3 アカウント一覧の検索行', () => {
  it('検索欄は data-search-row に1つだけ置く', () => {
    const row = searchRowBlock()
    expect(row).toContain('アカウント名・チャネルIDで検索')
    // 同じ行に絞り込みや件数を置かない。
    expect(row).not.toContain('ACCOUNT_FILTERS')
    expect(row).not.toContain('ListRange')
  })

  it('選べない件数表示は置かず、結果の件数は絞り込みの行にまとめる', () => {
    expect(PAGE).not.toContain('20件表示')
    expect(PAGE.indexOf('<ListRange')).toBeGreaterThan(PAGE.indexOf('ACCOUNT_FILTERS.map'))
  })
})
