import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '../../v8/settings/accounts/accounts.tsx'), 'utf8')

/**
 * 板 ：検索と絞り込みは同じ白い板に入れる。
 * 検索欄は1つだけ。件数は絞り込みの行にまとめる。
 */
const searchRowBlock = (): string => {
  const start = PAGE.indexOf('className={styles.toolbar}')
  const end = PAGE.indexOf('</div>', start)
  return PAGE.slice(start, end)
}

describe('V7vn3 アカウント一覧の検索行', () => {
  it('検索欄は現役の道具の段に1つだけ置く', () => {
    const row = searchRowBlock()
    expect(row).toContain('アカウント名・チャネル ID で探す')
    expect(PAGE.match(/<SearchField\b/g)).toHaveLength(1)
    expect(row).toContain('ACCOUNT_FILTERS')
  })

  it('選べない件数表示は置かず、状態ごとの実数を同じ道具の段にまとめる', () => {
    expect(PAGE).not.toContain('20件表示')
    expect(PAGE).toContain('filterCount(item.value)')
    expect(PAGE).toContain("const filterCount = (value: AccountFilter) => (ready ?")
  })
})
