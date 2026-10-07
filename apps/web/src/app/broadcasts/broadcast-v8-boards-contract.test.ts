import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => readFileSync(join(HERE, relative), 'utf8')

/*
 * V8 再撮の9板（`EML2F` `bIdqV` `rfdmA` `CRtK8` `dK1aE` `wfHIE` `tPm3e`
 * `p15At` `G9C4Uw`）。画面はどれも作り済みなので、同じ画面の外枠か
 * 該当の場所に `data-design-node` を付けるだけ——付けないと進み具合に
 * 数えられない。v7・見せ方・API は何も変えない。
 */
describe('V8 再撮9板の印（友だち情報の欄・友だち）', () => {
  /*
   * 一覧の入口は src/v8/broadcasts/list.tsx（古い list-v8.tsx はもう描かれない）。
   * 新しい一覧は板IDを型（ListPage の boardId）に渡す：1440＝l5V9a・閲覧のみ＝NtCE3・1152＝jjFNi。
   */
  it('一覧は板IDを型へ渡し、閲覧のみは NtCE3 と帯を出す', () => {
    const list = read('../../v8/broadcasts/list.tsx')
    expect(list, '一覧の板が無い').toContain("const boardId = narrow ? 'jjFNi' : canEdit ? 'l5V9a' : 'NtCE3'")
    expect(list).toContain('boardId={boardId}')
    expect(list).toContain('閲覧のみで見ています。変える操作は管理者に頼んでください。')
  })

  it('予約した後の外枠に CRtK8 を付ける', () => {
    const reserved = read('reserved-v8.tsx')
    expect(reserved, '予約した後の板が無い').toContain('data-design-node="CRtK8"')
  })

  it('予約の取消の窓は板 BeNtj・取り消す／やめる／残すの3つを出す', () => {
    const reserved = read('reserved-v8.tsx')
    expect(reserved, 'BeNtj の板が無い').toContain('designNode="BeNtj"')
    expect(reserved, 'やめるが無い').toContain('やめる')
    expect(reserved, '予約のまま残すが無い').toContain('予約のまま残す')
  })

  it('詳細の外枠に dK1aE（下書き）・wfHIE（承認待ち）・tPm3e（送った後）を付ける', () => {
    const detail = read('detail-v8.tsx')
    expect(detail, '詳細の3状態の板が無い').toContain('data-design-node="dK1aE wfHIE tPm3e"')
  })

  it('重複検出の数の帯に G9C4Uw（1152）を付ける', () => {
    const duplicates = read('../duplicates/duplicates-v8.tsx')
    expect(duplicates, '重複検出1152 の板が無い').toContain('data-design-node="G9C4Uw"')
  })

  it('比べて決めるの A/B の並びに p15At（1152）を付ける', () => {
    const candidates = read('../friends/identity-candidates/identity-candidates-v8.tsx')
    expect(candidates, '比べて決める1152 の板が無い').toContain('data-design-node="p15At"')
  })
})
