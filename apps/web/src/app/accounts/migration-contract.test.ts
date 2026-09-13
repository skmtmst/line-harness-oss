import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseUidCsv, splitUidCsvLine } from './migration'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'migration.tsx'), 'utf8')

/**
 * UID移行の対応表（設計 ★V6 機能3 `vtBCu`）。点検 #496 の項目2・6・9。
 *
 * **21件目以降も判断できる**こと（ページ送り＋未判断のみ）、
 * **引用符・列ずれの行を結び付けない**こと、**一致先なしに
 * 新規作成を選ばせない**ことを守る。
 */
describe('V6 機能3 UID移行の対応表', () => {
  it('引用符の中のカンマで列をずらさない', () => {
    expect(splitUidCsvLine('U1,"山田,太郎",x')).toEqual(['U1', '山田,太郎', 'x'])
  })

  it('二重引用符を1つに戻す', () => {
    expect(splitUidCsvLine('U1,"山田 ""T"" 太郎",x')).toEqual(['U1', '山田 "T" 太郎', 'x'])
  })

  it('閉じていない引用符の行は捨てる', () => {
    expect(splitUidCsvLine('U1,"山田,太郎')).toBeNull()
  })

  it('引用符付きの対応表を取り込める', () => {
    expect(parseUidCsv('old_uid,new_uid\n"old,1","new,1"\nold-2,new-2')).toEqual([
      { oldUid: 'old,1', newUid: 'new,1', evidenceType: 'operator_csv' },
      { oldUid: 'old-2', newUid: 'new-2', evidenceType: 'operator_csv' },
    ])
  })

  it('列の数が合わない行は結び付けず読み飛ばす', () => {
    expect(parseUidCsv('old_uid,new_uid\nold-1,new-1,余分\nold-2')).toEqual([])
  })

  it('必須列がなければ空にする', () => {
    expect(parseUidCsv('foo,bar\nold-1,new-1')).toEqual([])
  })

  it('対応表をページで区切って読む', () => {
    expect(PAGE).toContain('limit')
    expect(PAGE).toContain('offset')
    expect(PAGE).toContain('ITEM_PAGE_SIZE')
    expect(PAGE).not.toContain('.slice(0, 20)')
  })

  it('分類と未判断のみの絞り込みを持つ', () => {
    expect(PAGE).toContain('分類で絞り込む')
    expect(PAGE).toContain('未判断のみ')
    expect(PAGE).toContain('pendingOnly')
  })

  it('一致先なしの行に新規作成を選ばせない', () => {
    expect(PAGE).toContain('一致先なし')
    expect(PAGE).toContain("onDecide(item, 'link')")
    expect(PAGE).not.toContain("item.newUid ? 'link' : 'create'")
  })
})
