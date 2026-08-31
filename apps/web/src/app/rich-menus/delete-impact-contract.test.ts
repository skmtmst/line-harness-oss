import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/** リッチメニューの削除確認（設計 `szXsT` 12-1-E ／ 契約 #608）。 */
describe('リッチメニューの削除確認', () => {
  it('窓を開けてから影響を読む', () => {
    // 一覧を出すたびに全件ぶん読むと、消さない人にも重い問い合わせが走る。
    expect(PAGE).toContain('void loadImpact(group.id)')
    expect(PAGE).toContain('api.richMenuGroups.deleteImpact')
  })

  it('影響が読めないときは消させない', () => {
    /*
     * 何が起きるか分からないまま取り消せない操作をさせるより、
     * 読み直してもらうほうがよい。
     */
    expect(PAGE).toContain('消したときの影響を確認できませんでした')
    /*
     * 押せるように見えて何も起きない形にしない。塞がれているときは
     * 確認のボタンごと出さない（`onConfirm` を渡さない）。
     */
    expect(PAGE).toContain('canDeleteImpact({ impact, busy: deleteBusy })')
    expect(PAGE).toContain('{ onConfirm: () => void confirmDelete() }')
    expect(PAGE).not.toContain('() => undefined')
  })

  it('読込・失敗・通常を分ける', () => {
    expect(PAGE).toContain("impactPhase === 'loading'")
    expect(PAGE).toContain("impactPhase === 'error'")
  })

  it('4つの影響を出す', () => {
    for (const label of ['いま表示している人数', '次に出るメニュー', '切替元', '使っている自動処理']) {
      expect(PAGE).toContain(label)
    }
  })

  it('取得できた0件を「ありません」と書き、未取得と混ぜない', () => {
    expect(PAGE).toContain("=== 0\n                    ? 'ありません'")
    expect(PAGE).toContain('audienceText(impact.currentAudience)')
  })

  it('消せない理由を内部の記号で出さない', () => {
    expect(PAGE).toContain('blockerTexts(impact.blockers)')
    expect(PAGE).not.toContain('impact.blockers.join')
  })

  it('窓を閉じたら影響も捨てる', () => {
    // 前に開いたメニューの影響が、次の窓に残ってはいけない。
    expect(PAGE).toContain('setImpactPhase(\'idle\')')
  })

  it('409 は最新の影響へ描き直す', () => {
    // 消せると出したまま失敗を出さない。何が変わったのか読めなくなる。
    expect(PAGE).toContain('e.status === 409')
    expect(PAGE).toContain('impactFromError(e.data)')
  })

  it('遅れて返った別のメニューの結果を映さない', () => {
    /*
     * Aを読み込み中に窓を閉じてBを開くと、あとから返るAの結果がBの窓に
     * 出る。読んでいるものと押せるものが食い違う。
     */
    expect(PAGE).toContain('impactRequestRef.current = groupId')
    expect(PAGE).toContain('impactRequestRef.current !== groupId')
  })
})
