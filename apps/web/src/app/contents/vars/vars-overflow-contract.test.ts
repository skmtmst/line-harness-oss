import { readFileSync } from 'node:fs'
import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, 'page.tsx'), 'utf8')
const CSS = readFileSync(join(HERE, '../../../v8/common-vars/list.module.css'), 'utf8')
const FRAME = readFileSync(join(HERE, '../../../components/templates/page-templates.module.css'), 'utf8')
const TEMPLATE = readFileSync(join(HERE, '../../../components/templates/list-page.tsx'), 'utf8')

/*
 * #973 U026: 共通情報の一覧（/contents/vars）で、フォルダ・検索・表を
 * 包む親グリッドが右へ広がり、ページ全体が横にはみ出していた。
 */
describe('共通情報一覧のはみ出し（#973 U026）', () => {
  it('一覧側のグリッド子は min-w-0 で縮める', () => {
    expect(PAGE).toContain('<ListPage')
    expect(FRAME).toContain('minmax(0, 1fr)')
    expect(FRAME).toContain('min-width: 0')
    expect(CSS).toContain('min-width: 0')
  })

  it('狭い幅ではフォルダを縦パネルではなく1行の選択欄にする', () => {
    expect(PAGE).toContain('folderNav={{ rows: folderRows')
    expect(TEMPLATE).toContain('options={rows.map(')
    expect(TEMPLATE).toContain('folderNav')
    expect(FRAME).toContain('1100px')
  })

  it('検索は現役の共通道具欄に置き、はみ出す最小幅を課さない', () => {
    expect(PAGE).toContain('<ListToolbar')
    expect(PAGE).toContain("label: '共通情報を検索'")
    // かつての `min-w-64 flex-1` のインライン検索欄は狭い幅ではみ出す元。
    expect(PAGE).not.toContain('min-w-64')
  })

  it('読み込み・空の状態は表の外へ出す', () => {
    // 空状態の主操作が横スクロールの奥へ切れないよう、表のセルに入れない。
    expect(PAGE).not.toContain('colSpan={7}')
    const emptyState = PAGE.indexOf('<EmptyList')
    const table = PAGE.indexOf('<DataTable')
    expect(PAGE).toContain('aria-label="読み込み中"')
    expect(emptyState).toBeGreaterThan(-1)
    expect(table).toBeGreaterThan(-1)
    expect(emptyState).toBeLessThan(table)
  })
})
