import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * U015: リッチメニューの検索欄の潰れ（外部UI監査 ab9d80b07）。
 *
 * 390pxで作成操作・並び順・表示件数と同じ行に押し込まれ、検索欄が
 * 潰れて検索対象の説明も入力内容も読めなかった。検索は独立した
 * 全幅の行にし、並び順・表示件数は次の行へ。
 *
 * ブラウザの実測幅は vitest では取れないので、**潰れない構造**を
 * 契約として見る: 検索欄が `data-search-row` の専用行に1つだけあり、
 * 全幅（`w-full`）で、同じ行に他の操作を置かないこと。
 */
const barBlock = PAGE.slice(PAGE.indexOf('data-design="Bar"'), PAGE.indexOf('data-design="Saved"'))
const searchRowBlock = (): string => {
  const start = barBlock.indexOf('data-search-row')
  const end = barBlock.indexOf('</div>', start)
  return barBlock.slice(start, end)
}

describe('リッチメニューの検索行（U015）', () => {
  it('検索欄は独立した全幅の行に1つだけ置く', () => {
    const row = searchRowBlock()
    expect(row).toContain('メニュー名・ボタン名で検索')
    expect(row, '検索欄が全幅でない').toContain('className="w-full"')
    // 同じ行に他の操作を押し込まない（潰れの再発防止）。
    expect(row).not.toContain('SelectField')
    expect(row).not.toContain('Button')
    expect(row).not.toContain('Link')
  })

  it('共通の検索部品を使う', () => {
    expect(PAGE).toContain("import SearchField from '@/components/shared/search-field'")
  })

  it('作成操作→検索→並び順・表示件数の順に別行へ分ける', () => {
    // 既存契約（rich-menus-v6-contract.test.ts）の道具列順を保ったまま、
    // 検索は作成操作の次・並び順の前の独立行にする。
    expect(barBlock.indexOf('メニューを作る')).toBeLessThan(barBlock.indexOf('出す順番を変える'))
    expect(barBlock.indexOf('出す順番を変える')).toBeLessThan(barBlock.indexOf('data-search-row'))
    const rowEnd = barBlock.indexOf('</div>', barBlock.indexOf('data-search-row'))
    expect(barBlock.indexOf('aria-label="並び順"')).toBeGreaterThan(rowEnd)
    expect(barBlock.indexOf('aria-label="表示件数"')).toBeGreaterThan(rowEnd)
  })
})
