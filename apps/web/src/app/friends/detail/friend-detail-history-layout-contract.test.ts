import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
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

  it('「すべてを見る」は実際の履歴タブへつながる', () => {
    expect(PAGE).toContain('&tab=history')
    // 履歴タブは追加の履歴をカーソルで読む。
    expect(PAGE).toContain('historyNextCursor')
  })
})
