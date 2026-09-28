import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * シナリオ一覧の崩れ止め（m21p・オーナー指摘）。
 *
 * 検証環境の撮影で見つかった3つの崩れを、文字の検査で守る。
 * 幅の確認そのものは司令塔が撮影で行う。ここでは崩れの原因
 * （帯の余白の付け方・開閉欄の数・導線ラベルの長さ）を固定する。
 *
 * - 作成ボタンと下のフォルダの枠の間に余白が無く、くっついていた
 * - 「配信を始める方法」の開閉欄が数のカードの上下に2つ出ていた
 * - 一覧の「購読 / 読了」列で導線が「配信を始め…」と切れていた
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const LIST = readFileSync(
  join(HERE, '..', '..', 'components', 'scenarios', 'scenario-list.tsx'),
  'utf8',
)

/** `needle` が現れる回数。 */
function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1
}

describe('シナリオ一覧の帯の間隔（m21p・その1）', () => {
  it('縦の間隔は親の gap-4 だけで作る（一斉配信の一覧と同じ値）', () => {
    // 子ごとの mb/mt を足すと帯ごとに値がばらつく。親の gap-4 だけにする。
    expect(PAGE).toContain('<div className="flex flex-col gap-4">')
    expect(PAGE, '案内帯に mb が残っている').not.toContain('tone="info" className')
    expect(PAGE, '件数行に mb が残っている').not.toContain('mb-3 text-xs tabular-nums')
    expect(PAGE, '失敗帯に mb が残っている').not.toContain('message={actionError} className')
    expect(PAGE, 'ページ送り行に mt が残っている').not.toContain('mt-4 flex flex-wrap')
  })

  it('作成ボタンは一覧本体の外にあり、下の枠との間が空く', () => {
    // ボタン行を Body の中へ置くと親の gap-4 が効かず、フォルダの枠に
    // くっつく。ボタン行→Body の順で、どちらも親の直接の子にする。
    const buttonAt = PAGE.indexOf('＋ シナリオを作る')
    const bodyAt = PAGE.indexOf('data-design="Body"')
    expect(buttonAt, '作成ボタンが無い').toBeGreaterThan(-1)
    expect(bodyAt, 'Body が無い').toBeGreaterThan(buttonAt)
    const railAt = PAGE.indexOf('<div style={FOLDER_RAIL_STYLE}')
    expect(railAt, 'フォルダの枠が Body の外にある').toBeGreaterThan(bodyAt)
  })
})

describe('シナリオ一覧の開閉欄（m21p・その2）', () => {
  it('「配信を始める方法」の開閉欄は1つだけ', () => {
    // 数のカードの上下に2つ出すと、どちらが本物か分からない。
    expect(
      countOf(PAGE, 'title="配信を始める方法"'),
      '開閉欄が2つある（または0個）',
    ).toBe(1)
  })

  it('並びは「説明の開閉 → 数のカード → ＋作る → 一覧」（★V7）', () => {
    const guideAt = PAGE.indexOf('title="配信を始める方法"')
    const kpisAt = PAGE.indexOf('data-design="KPIs"')
    const buttonAt = PAGE.indexOf('＋ シナリオを作る')
    const bodyAt = PAGE.indexOf('data-design="Body"')
    expect(guideAt, '開閉欄が無い').toBeGreaterThan(-1)
    expect(kpisAt, '開閉欄が数のカードより下にある').toBeGreaterThan(guideAt)
    expect(buttonAt, '作成ボタンが数のカードより上にある').toBeGreaterThan(kpisAt)
    expect(bodyAt, '一覧が作成ボタンより上にある').toBeGreaterThan(buttonAt)
  })
})

describe('シナリオ一覧の購読列の導線（m21p・その3）', () => {
  it('0人時の導線は全文が読める短い言い回しにする', () => {
    // 「購読 / 読了」列は w-28（112px）。7文字の「配信を始める方法」は
    // 「配信を始め…」と途中で切れていた。見える文字は6文字にする。
    expect(LIST).toContain('配信の始め方')
    expect(LIST, '切れる長いラベルが表示文に残っている').not.toMatch(/>\s*配信を始める方法\s*</)
  })

  it('導線の全文は title で読め、行内で折れない', () => {
    expect(LIST).toContain('title="配信を始める方法"')
    expect(LIST, '導線の省略が無い').toMatch(/title="配信を始める方法"[\s\S]{0,200}?truncate/)
    expect(LIST, '導線が途中で折れる').toMatch(/title="配信を始める方法"[\s\S]{0,200}?whitespace-nowrap/)
  })
})
