import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * U015 → ★V7 `Xn1Mz`（2026-09-27 オーナー指摘）。
 *
 * U015（外部UI監査 ab9d80b07）の旧処方は「検索を独立した全幅の行に」
 * だったが、正本を「検索は幅320で1行目、2行目は左に絞り込み・右端に
 * 並び順と表示件数」に変えた。潰れ対策の意図は残す：検索は320
 * （狭い時は240まで）で折り返し、読めないほど潰さない。幅の実数は
 * 共通 ListToolbar の契約テストで守る。
 */
const barBlock = PAGE.slice(PAGE.indexOf('data-design="Bar"'), PAGE.indexOf('data-design="Saved"'))

describe('リッチメニューの検索行（U015 → ★V7 Xn1Mz）', () => {
  it('検索は共通 ListToolbar の1行目に置く', () => {
    expect(PAGE).toContain("import ListToolbar from '@/components/shared/list-toolbar'")
    expect(barBlock).toContain('<ListToolbar')
    expect(barBlock).toContain("search={{ placeholder: 'メニュー名・ボタン名で検索'")
  })

  it('検索を横いっぱいに伸ばさない（裸の全幅 input を置かない）', () => {
    expect(PAGE).not.toContain('data-search-row')
    expect(PAGE).not.toContain('type="search"')
    expect(PAGE).not.toMatch(/<SearchField[\s\S]*?className="w-full"/)
  })

  it('共通の検索部品を使う（ListToolbar の中の SearchField）', () => {
    expect(PAGE).toContain('<ListToolbar')
  })

  it('作成操作→検索→絞り込み→並び順・表示件数の順に並べる', () => {
    // 既存契約（rich-menus-v6-contract.test.ts）の道具列順を保ったまま、
    // 検索は作成操作の次、絞り込み・並び順の前に置く。
    expect(barBlock.indexOf('メニューを作る')).toBeLessThan(barBlock.indexOf('<ListToolbar'))
    const toolbarAt = barBlock.indexOf('<ListToolbar')
    const filtersAt = barBlock.indexOf('filters={', toolbarAt)
    const trailingAt = barBlock.indexOf('trailing={', toolbarAt)
    expect(filtersAt).toBeGreaterThan(toolbarAt)
    expect(trailingAt).toBeGreaterThan(filtersAt)
    expect(barBlock.indexOf('よく使う絞り込み', filtersAt)).toBeGreaterThan(filtersAt)
    expect(barBlock.indexOf('aria-label="並び順"', trailingAt)).toBeGreaterThan(trailingAt)
    expect(barBlock.indexOf('aria-label="表示件数"', trailingAt)).toBeGreaterThan(trailingAt)
  })
})
