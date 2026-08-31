import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/** メディアの削除確認（設計 `YfTfJ` 15-1-C ／ 契約 #610）。 */
describe('メディアの削除確認', () => {
  it('窓を開けてから使用先を読む', () => {
    // 一覧を出すたびに全件ぶん読むと、消さない人にも7種類の走査が走る。
    expect(PAGE).toContain('void openDelete(item)')
    expect(PAGE).toContain('api.media.deleteImpact')
  })

  it('使用先が読めないときは消させない', () => {
    /*
     * 7種類のどれかに残ったまま消すと、その画面が壊れた画像を指す。
     */
    expect(PAGE).toContain('使われている場所を確認できませんでした')
    expect(PAGE).toContain('canDeleteMedia({ impact, busy: deleteBusy })')
  })

  it('消せないときは押し口ごと出さない', () => {
    // 押せるように見えて何も起きない形にしない。
    expect(PAGE).toContain('canDeleteMedia({ impact, busy: deleteBusy }) ? (')
    expect(PAGE).not.toContain('confirm(`')
  })

  it('409 は読み直してから見せる', () => {
    // 読んだあとに使われ始めた場合。消せない理由が変わっている。
    expect(PAGE).toContain('e.status === 409')
    expect(PAGE).toContain('いま使われ始めたため')
  })

  it('開ける先があるときだけリンクにする', () => {
    expect(PAGE).toContain('ref.href ? (')
    expect(PAGE).toContain('開けません')
  })

  it('いつ時点で確かめたかを書く', () => {
    // 「いつの話か」が無いと、消す判断ができない。
    expect(PAGE).toContain('checkedAtText(impact.checkedAt)')
    expect(PAGE).toContain('7種類を確認しました')
  })

  it('まだ無い操作を押し口にしない', () => {
    // 設計の「別の画像に差し替える」は口がまだ無い。
    expect(PAGE).toContain('まとめて差し替える操作は、まだ用意していません')
    expect(PAGE).not.toContain('別の画像に差し替え<')
  })

  it('撮影の押し口に印を付ける', () => {
    expect(PAGE).toContain('data-qa-open="YfTfJ"')
    expect(PAGE).toContain('data-design-node="YfTfJ"')
  })

  it('遅れて返った別のメディアの結果を映さない', () => {
    /*
     * Aを読み込み中に窓を閉じてBを開くと、あとから返るAの結果がBの窓に
     * 出る。読んでいるものと押せるものが食い違う。
     */
    expect(PAGE).toContain('impactRequestRef.current = item.id')
    expect(PAGE).toContain('impactRequestRef.current !== item.id')
  })
})
