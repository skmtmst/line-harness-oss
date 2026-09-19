import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/*
 * #972 U035: 390pxでは右の「つくる」「マニュアル」が見出し・パンくず・
 * 説明を押しつぶして縦に割れ、下の画面切替タブと6列の表も潰れていた。
 * 見出し帯は折り返し、タブは折り返し、表は枠の内側で横へ動かす。
 */
describe('U035 共通アクションの見出し・パンくずの縦割れ', () => {
  it('見出し帯に折り返しの印と上書きがある', () => {
    expect(PAGE).toContain('data-page-header-wrap')
    expect(PAGE).toContain('[data-page-header-wrap] > div { flex-wrap: wrap; }')
    expect(PAGE).toContain('[data-page-header-wrap] > div > div + div')
  })

  it('画面切替タブも折り返す', () => {
    expect(PAGE).toContain('data-tabs-row')
    expect(PAGE).toContain('[data-tabs-row] nav:has(> span)')
  })

  it('6列の表は枠の内側で横へ動かせる', () => {
    expect(PAGE).toContain('data-scroll-table')
    expect(PAGE).toContain('[data-scroll-table] > div { overflow-x: auto; }')
    expect(PAGE).toContain('[data-scroll-table] table { min-width: 800px; }')
  })
})
