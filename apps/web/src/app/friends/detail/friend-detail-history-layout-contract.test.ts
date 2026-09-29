import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

/**
 * Issue #1015 CHK-04（#985 の対応を固定）+ Issue #773:
 * 友だち詳細「最近の履歴」を狭い幅でも読める形にする。
 *
 * #773 で判明した実害:
 * - 右ペインのカードは lg 帯で 500px 台前半までしか広がらず、
 *   固定列 140+140+110+64+gap+padding が全域を食い、「内容」の 1fr が
 *   実測 3px に潰れて1文字ずつ縦積みになっていた。
 * - 画面幅(md)ではなく「カードの幅」で切り替える必要があるため、
 *   コンテナクエリ(@container / @lg:)で表組み⇔折り返しを切り替える。
 * - 各列には minmax で下限を持たせ、1fr が 3px に潰れないようにする。
 * - タブ帯はV7の方針(折らずに横へ流す)を維持しつつ、はみ出し中だけ
 *   右端フェードで続きがあることを示す。
 */
describe('CHK-04 友だち詳細「最近の履歴」の狭幅表示', () => {
  it('表組みはカード幅(@lg)でのみ。狭いカードでは見出しを畳み各行カードにする', () => {
    // カード自身がコンテナになり、その幅で表組み/折り返しを切り替える。
    expect(PAGE).toContain('@container bg-canvas rounded-card border-hairline overflow-hidden border shadow-card')
    expect(PAGE).toContain('@container bg-canvas rounded-card border-hairline overflow-hidden border')
    // 見出し行はコンテナが狭いとき消す（hidden ... @lg:grid）。
    expect(PAGE).toContain('hidden border-y px-4 py-3 text-xs font-semibold text-ink-faint @lg:grid')
    expect(PAGE).toContain('hidden border-b px-4 py-3 text-xs font-semibold text-ink-faint @lg:grid')
    // 各行は flex-wrap のカード。本文は行いっぱいに折り返す。
    expect(PAGE).toContain('flex flex-wrap items-baseline gap-x-3 gap-y-1')
    expect(PAGE).toContain('min-w-0 flex-1 basis-full @lg:basis-auto')
  })

  it('1fr 列が 3px に潰れないよう、全列に minmax の下限を持たせる', () => {
    // 固定 px 列のままだと 500px 台のカードで内容列が潰れる。
    expect(PAGE).not.toContain("const TIMELINE_ROW_COLUMNS = '140px 140px 1fr 110px 64px'")
    expect(PAGE).toContain('minmax(6rem,1fr)')
  })

  it('タブ帯ははみ出し中だけ右端フェードで続きを示す', () => {
    // V7 の「折らずに横へ流す」を維持しつつ、切断が壊れに見えないようにする。
    expect(PAGE).toContain('overflow-x-auto')
    expect(PAGE).toContain('tabsOverflowing')
    expect(PAGE).toContain('bg-gradient-to-l')
  })

  it('「すべてを見る」は実際の履歴タブへつながる', () => {
    expect(PAGE).toContain('&tab=history')
    // 履歴タブは追加の履歴をカーソルで読む。
    expect(PAGE).toContain('historyNextCursor')
  })
})
