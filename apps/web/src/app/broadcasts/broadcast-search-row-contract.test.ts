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
    // 同じ input タグの中に全幅指定があるものだけを見る。
    // 離れた表の w-full（別タグ）は対象外。
    expect(PAGE).not.toMatch(/<input[^>]*w-full/)
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

  it('日付の入力2つは狭い幅で2行目に置き、並び順・表示件数を3行目へ落とさない', () => {
    /*
     * 各208px（w-52）では1440pxで並び順と表示件数だけの3行目が
     * できていた。各132pxの共通決まり（ListToolbarのdata-date-input）
     * で同じ2行目に収める。中の文字は「開始日」「終了日」へ短くする
     * （「日付を選ぶ」のままでは132pxで欠ける）。1152px以下での
     * 折り返しは許す。
     */
    expect(PAGE).not.toMatch(/<div className="w-52"><DateField/)
    const toolbarAt = PAGE.indexOf('<ListToolbar')
    const filtersAt = PAGE.indexOf('filters={', toolbarAt)
    const trailingAt = PAGE.indexOf('trailing={', toolbarAt)
    expect(filtersAt).toBeGreaterThan(toolbarAt)
    expect(trailingAt).toBeGreaterThan(filtersAt)
    const firstDateAt = PAGE.indexOf('data-date-input', filtersAt)
    expect(firstDateAt).toBeGreaterThan(filtersAt)
    expect(firstDateAt).toBeLessThan(trailingAt)
    expect(PAGE.indexOf('aria-label="配信日（開始）"', filtersAt)).toBeGreaterThan(filtersAt)
    expect(PAGE.indexOf('aria-label="配信日（開始）"', filtersAt)).toBeLessThan(trailingAt)
    expect(PAGE.indexOf('aria-label="配信日（終了）"', filtersAt)).toBeGreaterThan(filtersAt)
    expect(PAGE.indexOf('aria-label="配信日（終了）"', filtersAt)).toBeLessThan(trailingAt)
    expect(PAGE.indexOf('placeholder="開始日"', filtersAt)).toBeGreaterThan(filtersAt)
    expect(PAGE.indexOf('placeholder="終了日"', filtersAt)).toBeGreaterThan(filtersAt)
  })

  it('並び順・表示件数は短い文字と狭い幅で2行目の右に置く', () => {
    /*
     * 既定幅（176px・128px）と長い文字（「配信日が新しい順」
     * 「20件表示」）のままでは、1440pxで右の2つだけ3行目へ落ちた。
     * 共通 ListToolbar の印（data-sort-select＝150px・
     * data-per-page-select＝96px）で幅をそろえ、文字は「新しい順」
     * 「20件」へ短くする（何の順かは aria-label、件数は左の見出しで
     * 分かる）。幅の合計が835px以下であることは次の試験で見る。
     */
    const toolbarAt = PAGE.indexOf('<ListToolbar')
    const trailingAt = PAGE.indexOf('trailing={', toolbarAt)
    expect(trailingAt).toBeGreaterThan(toolbarAt)
    expect(PAGE.indexOf('data-sort-select', trailingAt)).toBeGreaterThan(trailingAt)
    expect(PAGE.indexOf('data-per-page-select', trailingAt)).toBeGreaterThan(trailingAt)
    expect(PAGE.indexOf("label: '新しい順'", trailingAt)).toBeGreaterThan(trailingAt)
    expect(PAGE.indexOf("label: '古い順'", trailingAt)).toBeGreaterThan(trailingAt)
    expect(PAGE.indexOf("label: '20件'", trailingAt)).toBeGreaterThan(trailingAt)
    expect(PAGE.indexOf("label: '100件'", trailingAt)).toBeGreaterThan(trailingAt)
    expect(PAGE).not.toContain("label: '配信日が新しい順'")
    expect(PAGE).not.toContain("label: '20件表示'")
    // 「20件」だけでは意味が分からないので、左に見出しを置く。
    expect(PAGE.indexOf('>表示件数</span>', trailingAt)).toBeGreaterThan(trailingAt)
  })

  it('2行目の部品幅の合計＋間は835px以下（1440で1行に収める）', () => {
    /*
     * 描画の試験。中身の幅835px（1440pxの一斉配信の一覧列）のときに
     * 2行目の部品の幅の合計＋間が835px以下なら、並び順と表示件数は
     * 3行目へ落ちない。CSSの幅指定を読んで足すので、直しを戻すと
     * 赤くなる（日付150px・既定176px・128pxでは約924pxで落ちる）。
     *
     * 札と見出しの幅は実測の切り上げ（ヒラギノ・太さ600の最幅）：
     * 予約中のみ91・下書き65・配信日40・〜12・表示件数48。
     * 間は8px（row2・filters・trailingのgap）。
     * 日付を絞ったときだけ出る「日付を外す」は含めない（出たときは
     * 折り返す。依頼の内訳どおり）。
     */
    const css = readFileSync(join(HERE, '../../components/shared/list-toolbar.module.css'), 'utf8')
    const widthOf = (pattern: RegExp, name: string): number => {
      const found = css.match(pattern)
      expect(found, `${name}の幅指定がありません`).toBeTruthy()
      return Number(found![1])
    }
    const dateWidth = widthOf(/\.filters\s*>\s*\[data-date-input\]\s*{[^}]*?width:\s*(\d+)px/s, '日付入力')
    const sortWidth = widthOf(/\.trailing\s*>\s*\[data-sort-select\]\s*{[^}]*?width:\s*(\d+)px/s, '並び順')
    const perPageWidth = widthOf(/\.trailing\s*>\s*\[data-per-page-select\]\s*{[^}]*?width:\s*(\d+)px/s, '表示件数')
    // 札2つ＋配信日＋日付2つ（filtersの子6つ・間5つ）。
    const filtersTotal = 91 + 65 + 40 + dateWidth * 2 + 12 + 8 * 5
    // 並び順＋表示件数の見出し＋表示件数（trailingの子3つ・間2つ）。
    const trailingTotal = sortWidth + 48 + perPageWidth + 8 * 2
    // 2行目の左右の間1つ。
    expect(filtersTotal + 8 + trailingTotal).toBeLessThanOrEqual(835)
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
