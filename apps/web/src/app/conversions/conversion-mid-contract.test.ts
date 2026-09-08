import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * #513「中」M2〜M6 の契約(成果地点一覧)。
 *
 * M2: 先頭100件の切り取りをやめ、cursor/nextCursor で条件に合うものを残らず読む。
 * M3: 探す言葉と並びは口(q/sort)へ渡す。画面で探し直し・並べ直しはしない。
 * M4: 影響が読めていない確定は黙って終わらせず、読み込み中は確定を止める。
 * M5: レポート側のCSVボタンは中身(成果地点の一覧)を名乗る。
 * M6: 古い読み込みの応答は捨て、新しい表示を上書きさせない。
 */
describe('成果地点一覧の点検契約(#513 中)', () => {
  it('M2: 先頭だけの表示をやめ、nextCursor を追って50頁まで読む', () => {
    expect(PAGE).toContain('pagination.nextCursor')
    expect(PAGE).toContain('page < 50')
    expect(PAGE).toContain('truncated')
    expect(PAGE, '無制限の取得に戻っている').not.toContain('for (;;)')
  })

  it('M3: 探す言葉と並びを口へ渡し、画面で探し直さない', () => {
    expect(PAGE).toContain('SORT_TO_API')
    expect(PAGE).toContain('q: debouncedQuery')
    expect(PAGE).toContain('sort: SORT_TO_API[sort]')
    expect(PAGE).toContain("'cv-desc': 'count_desc'")
    expect(PAGE).toContain("'value-desc': 'value_desc'")
    expect(PAGE).toContain("'name': 'name_asc'")
    expect(PAGE, '画面内で探し直している').not.toContain('p.name.includes(q)')
  })

  it('M4: 影響なしの確定は理由を出し、読み込み中は確定を止める', () => {
    expect(PAGE).toContain('if (!stopTarget || stopping) return')
    expect(PAGE).toContain('if (stopImpactLoading) return')
    expect(PAGE).toContain('利用先と停止の影響を読み込めませんでした。画面を閉じて、もう一度お試しください。')
    expect(PAGE).toContain('busy={stopping || stopImpactLoading}')
  })

  it('M5: レポートのCSVボタンは一覧の中身を名乗る', () => {
    expect(PAGE).toContain('成果地点の一覧をCSVで書き出す')
    expect(PAGE, '古いボタン名が残っている').not.toContain('この画面をCSVで書き出す')
  })

  it('M6: 世代番号で古い応答を捨てる', () => {
    expect(PAGE).toContain('loadSeq')
    expect(PAGE).toContain('loadSeq.current !== seq')
  })
})
