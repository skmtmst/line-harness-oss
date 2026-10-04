import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = dirname(fileURLToPath(import.meta.url))
const OVERVIEW = readFileSync(join(DIR, 'nen-overview.tsx'), 'utf8')

/*
 * NEN配信の件数表示。**取れない数を 0 で埋めない。**
 * 「0件」は「1つも無い」という別の意味になり、読み込み中・失敗中と
 * 空っぽを見分けられなくなる。まだ無いときは「—」か出さない。
 */
describe('NEN配信 ゼロ件の表示', () => {
  it('自動配信の見出し件数は読み込み中・失敗中は「—」', () => {
    expect(OVERVIEW).toContain(`{loading || tabError ? '—' : \`\${shown.length}件\`}`)
  })

  it('コラムの見出し本数は読み込み中・失敗中は「—」', () => {
    expect(OVERVIEW).toContain(`{loading || tabError ? '—' : (columnsTruncated ?`)
  })

  it('送った履歴の件数とページ送りは一覧が無い間は出さない', () => {
    expect(OVERVIEW).toContain('{!deliveryList || tabError ? null : (')
    expect(OVERVIEW).not.toContain('pagination.total ?? 0')
  })

  it('履歴のチップは取れない数を「—」で出す', () => {
    for (const chip of [
      'すべて ${deliveryList?.pagination.total',
      '送りました ${summary?.sent',
      'これから ${summary ?',
      '届きませんでした ${summary?.failed',
      '送りませんでした ${summary?.skipped',
    ]) {
      expect(OVERVIEW, `${chip} が無い`).toContain(chip)
    }
  })
})
