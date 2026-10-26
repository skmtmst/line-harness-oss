import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DIFFERENT_PROVIDER_DETAIL,
  HANDOVER_PILLS,
  countsLine,
  MATCH_BUCKETS,
  totalsMatch,
} from '@/v8/accounts-detail/handover-view'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '../../../v8/accounts-detail/handover.tsx'), 'utf8')

/**
 * LINEアカウントの乗り換え・引き継ぎ（設計 ★管理画面 33-4 `nx3XW`）。
 *
 * 実 API の事前確認結果を読み、合計が一致した値だけを表示する。
 * 画面の動き（口の呼び出し・確認窓・?id= なし・役割の出し分け）は
 * `handover-v8.test.tsx` と `handover-viewer-gating-react.test.tsx` が描いて確かめる。
 */
describe("管理画面 33-4 乗り換え・引き継ぎ", () => {
  it('設計の5段を持つ', () => {
    expect(HANDOVER_PILLS).toEqual([
      '引き継ぎコード', '事前確認', '要確認を決める', '本実行',
    ])
  })

  it('事前確認の4区分を、設計の言葉で持つ', () => {
    expect(MATCH_BUCKETS.map((b) => b.label)).toEqual([
      '自動で同じ人', '要確認', '一致しない', '別人の可能性',
    ])
  })

  it('合計が元の友だち数と合わないとき、数を出さない', () => {
    /*
      **合わない結果を画面に出さない。** 出すと、運用者は「どこかの人が
      消えた」と読む。
    */
    const counts = { auto: 186, review: 23, unmatched: 18, lookalike: 4 }
    expect(totalsMatch(counts, 231)).toBe(true)
    expect(totalsMatch(counts, 230)).toBe(false)
    expect(totalsMatch(null, 231)).toBe(false)
    expect(totalsMatch(counts, null)).toBe(false)
  })

  it('人数の1行は 0 の区分を省いて言う', () => {
    expect(countsLine({sourceTotal:2,auto:1,review:1,unmatched:0,lookalike:0})).toBe('元の友だち 2 人：自動で同じ人 1・要確認 1')
  })

  it('プロバイダーが違うときの断りを持つ', () => {
    /*
      **同じ人でも別のIDになる。** これを書かずに進めると、事前確認で
      「一致しない」が大量に出た理由が分からない。
    */
    expect(DIFFERENT_PROVIDER_DETAIL).toContain('同じ人でも別のIDになる')
    expect(DIFFERENT_PROVIDER_DETAIL).toContain('対応表を取り込むか')
  })

  it('変更の可否を手元の保存値で決めない（R522）', () => {
    // サーバの requireRole('owner', 'admin') と同じ境目を使う。役割ごとの出し分けは描画の試験で見る。
    expect(PAGE).not.toContain("localStorage.getItem('lh_staff_role')")
  })
})
