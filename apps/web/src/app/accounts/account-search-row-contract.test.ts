import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '../../v8/settings/accounts/accounts.tsx'), 'utf8')

/**
 * 板 ：検索と絞り込みは同じ白い板に入れる。
 * 検索欄が1つだけ・札に状態ごとの実数・失敗中は数を出さないことは
 * accounts-row-actions-react.test.tsx が描いて確かめる。ここは「置かないもの」だけ。
 */
describe('V7vn3 アカウント一覧の検索行', () => {
  it('選べない件数表示は置かない', () => {
    expect(PAGE).not.toContain('20件表示')
  })
})
