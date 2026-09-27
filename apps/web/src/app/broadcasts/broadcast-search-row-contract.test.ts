import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * U014 → ★V7 `Xn1Mz`（2026-09-27 オーナー指摘）。
 *
 * U014（外部UI監査 ab9d80b07）の旧処方は「検索を独立した全幅の行に」
 * だったが、横いっぱいの検索欄が長すぎるという指摘を受け、正本を
 * 「検索は幅320で『保存した検索・この条件を保存』と同じ行」に変えた。
 * 潰れ対策の意図は残す：検索は320（狭い時は240まで）で折り返し、
 * 読めないほど潰さない。幅の実数は共通 ListToolbar の契約テストで守る。
 *
 * ブラウザの実測幅は vitest では取れないので、**潰れない構造**を
 * 契約として見る: 検索が共通 ListToolbar の1行目にあり、保存した検索と
 * 同じ行で、裸の全幅 input を置かないこと。
 */
describe('一斉配信の検索行（U014 → ★V7 Xn1Mz）', () => {
  it('検索は共通 ListToolbar の1行目に置く', () => {
    expect(PAGE).toContain("import ListToolbar from '@/components/shared/list-toolbar'")
    expect(PAGE).toContain('<ListToolbar')
    expect(PAGE).toContain("search={{ placeholder: 'タイトル・内容で検索'")
  })

  it('保存した検索・この条件を保存は検索と同じ行（actions）に置く', () => {
    const toolbarAt = PAGE.indexOf('<ListToolbar')
    const actionsAt = PAGE.indexOf('actions={', toolbarAt)
    expect(actionsAt).toBeGreaterThan(toolbarAt)
    expect(PAGE.indexOf('aria-label="保存した検索"', actionsAt)).toBeGreaterThan(actionsAt)
    expect(PAGE.indexOf('この条件を保存', actionsAt)).toBeGreaterThan(actionsAt)
  })

  it('検索を横いっぱいに伸ばさない（裸の全幅 input を置かない）', () => {
    expect(PAGE).not.toContain('data-search-row')
    expect(PAGE).not.toContain('type="search"')
    expect(PAGE).not.toMatch(/<input[\s\S]*?w-full/)
  })

  it('絞り込みは2行目の左（filters）、並び順と表示件数は2行目の右（trailing）に置く', () => {
    const toolbarAt = PAGE.indexOf('<ListToolbar')
    const filtersAt = PAGE.indexOf('filters={', toolbarAt)
    const trailingAt = PAGE.indexOf('trailing={', toolbarAt)
    expect(filtersAt).toBeGreaterThan(toolbarAt)
    expect(trailingAt).toBeGreaterThan(filtersAt)
    expect(PAGE.indexOf('予約中のみ', filtersAt)).toBeGreaterThan(filtersAt)
    expect(PAGE.indexOf('aria-label="並び順"', trailingAt)).toBeGreaterThan(trailingAt)
    expect(PAGE.indexOf('aria-label="表示件数"', trailingAt)).toBeGreaterThan(trailingAt)
  })

  it('表示件数だけの行を作らない', () => {
    // 2行目の右端（trailing）にあるので、単独の行は無い。
    expect(PAGE).not.toMatch(/justify-end[^>]*>\s*(<span[^>]*>表示件数<\/span>)?\s*<SelectField/)
  })

  it('狭い幅の1列グリッドは minmax(0,1fr) で画面内に収める', () => {
    /*
     * 暗黙の auto 列は中身の最大幅（表の min-w-[640px]）まで広がるため、
     * 390px で検索行ごと右にはみ出し、横スクロールしないと入力の右端へ
     * 届かなかった（実ブラウザ実測: 検索欄642px / 本文658px）。
     * `grid-cols-1`（= minmax(0,1fr)）で列を容器の幅に止め、
     * 表はカード内の横スクロールに閉じ込める。
     */
    expect(PAGE).toContain('grid grid-cols-1 gap-4 lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]')
  })
})
