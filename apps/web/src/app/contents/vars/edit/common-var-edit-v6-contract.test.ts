import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const CSS = readFileSync(join(HERE, 'common-var-edit-v6.module.css'), 'utf8')

/** 共通情報を変える前に影響を見る（設計 `uNBlA` 14-1-B）。 */
describe('共通情報の編集をV6 uNBlA へ寄せる', () => {
  it('画面が名乗っているNodeを面に付ける', () => {
    expect(PAGE).toContain('data-design-node="uNBlA"')
  })

  it('画面名は共通トップバーに置き、本文へ見出しを二重に出さない', () => {
    expect(PAGE).toContain("usePageTitle('共通情報を編集')")
    expect(PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('<h1')
  })

  it('設計の「影響の要約」と「影響の一覧」を節として置く', () => {
    // 節ごと無いと、口が付いたときにどこへ入れるのか分からない。
    expect(PAGE).toContain('IMPACT_CARDS.map')
    expect(PAGE).toContain('{NOT_CONNECTED_VALUE}')
    expect(PAGE).toContain('{IMPACT_LIST_COUNT_TEXT}')
    expect(PAGE).toContain('{IMPACT_LIST_REASON}')
  })

  it('CSVは押せる形で置かず、理由を本文に出す', () => {
    expect(PAGE).toContain('CSVで書き出す')
    expect(PAGE).toContain('disabled aria-describedby="cv-csv-reason"')
    expect(PAGE).toContain('id="cv-csv-reason"')
    expect(PAGE).toContain('{CSV_BLOCKED_REASON}')
  })

  it('読込中・取得失敗・権限不足・見つからないを言い分ける', () => {
    expect(PAGE).toContain("import ListState from '@/components/shared/list-state'")
    expect(PAGE).toContain('title="読み込んでいます"')
    expect(PAGE).toContain('title="読み込めませんでした"')
    expect(PAGE).toContain('title="見る権限がありません"')
    expect(PAGE).toContain("e.status === 403 ? 'forbidden' : 'error'")
    expect(PAGE).toContain('再読み込み')
    // 4つを1つにまとめていた文。戻したら落とす。
    expect(PAGE).not.toContain('読み込み中...')
    expect(PAGE).not.toContain("setError('読み込みに失敗しました')")
  })

  it('保存は下部追従バーにだけ置き、押せない理由を本文に出す', () => {
    expect(PAGE).toContain("import StickyBar from '@/components/shared/sticky-bar'")
    expect(PAGE).toContain('<StickyBar')
    expect(PAGE).toContain('disabled={saveBlocked !== null}')
    expect(PAGE).toContain('saveBlocked ?? DELETE_MOVED_NOTE')
  })

  it('使用先を確かめない削除をこの画面から投げない', () => {
    /*
      以前はここに素の `confirm()` の削除があり、使われていれば Worker が
      409 を返して「削除に失敗しました」としか出なかった。使用先を数える
      確認は一覧側（設計 `yPkWe`）にある。
    */
    expect(PAGE).not.toContain('api.commonVars.delete(')
    expect(PAGE).not.toContain('confirm(')
    expect(PAGE).toContain('saveBlocked ?? DELETE_MOVED_NOTE')
  })

  it('設計の寸法を数字で置く', () => {
    // 要約カード r10 / pad16、編集カード r10 / pad18、CSV h40 / pad[0,14]。
    expect(CSS).toContain('border-radius: var(--radius-tile)')
    expect(CSS).toMatch(/\.summaryCard \{[^}]*padding: 16px/s)
    expect(CSS).toMatch(/\.editCard \{[^}]*padding: 18px/s)
    expect(CSS).toMatch(/\.csvButton \{[^}]*height: 40px/s)
    expect(CSS).toMatch(/\.csvButton \{[^}]*padding: 0 14px/s)
    // 値 22/700、ラベル 13/600、注記 12/500。
    expect(CSS).toMatch(/\.summaryValue \{[^}]*font-size: var\(--text-metric\)/s)
    expect(CSS).toMatch(/\.summaryLabel \{[^}]*font-size: var\(--text-label\)/s)
    expect(CSS).toMatch(/\.summaryNote \{[^}]*font-weight: 500/s)
    expect(CSS).toMatch(/\.sectionCount \{[^}]*font-weight: 600/s)
  })

  it('入力欄は共通部品（h40 / r8 / 13）を使う', () => {
    expect(PAGE).toContain("import { TextField } from '@/components/shared/text-field'")
    expect(PAGE).toContain("import SelectField from '@/components/shared/select-field'")
    expect(PAGE).not.toContain('border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm')
  })
})
