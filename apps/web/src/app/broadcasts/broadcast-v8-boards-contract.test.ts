import { readFileSync } from 'node:fs'
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
  it('一覧の外枠に EML2F（一覧）と bIdqV（一覧の状態）を付ける', () => {
    const list = read('list-v8.tsx')
    // 閲覧のみは NtCE3 に切り替わる形で両方の印を残す（印を消さない）。
    expect(list, '一覧の板が無い').toContain("data-design-node={canEdit ? 'EML2F bIdqV' : 'NtCE3'}")
  })

  it('一覧の道具の段に rfdmA（1152）を付ける', () => {
    const list = read('list-v8.tsx')
    expect(list, '1152 の板が無い').toContain('data-design-node="rfdmA"')
  })

  it('予約した後の外枠に CRtK8 を付ける', () => {
    const reserved = read('reserved-v8.tsx')
    expect(reserved, '予約した後の板が無い').toContain('data-design-node="CRtK8"')
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
