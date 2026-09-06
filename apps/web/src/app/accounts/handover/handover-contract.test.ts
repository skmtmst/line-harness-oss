import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DIFFERENT_PROVIDER_NOTE,
  HANDOVER_STEPS,
  MATCH_BUCKETS,
  totalsMatch,
} from './handover-view'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * LINEアカウントの乗り換え・引き継ぎ（設計 ★V6 33-4 `nx3XW`）。
 *
 * 実 API の事前確認結果を読み、合計が一致した値だけを表示する。
 */
describe('V6 33-4 乗り換え・引き継ぎ', () => {
  it('設計の5段を持つ', () => {
    expect(HANDOVER_STEPS.map((s) => s.label)).toEqual([
      '引き継ぎコードを出す',
      '受け取り先で読む',
      '事前確認',
      '競合の判断',
      '本実行と照合',
    ])
  })

  it('事前確認の4区分を、設計の言葉で持つ', () => {
    expect(MATCH_BUCKETS.map((b) => b.label)).toEqual([
      '自動で一致', '要確認', '一致しない', '別人の可能性',
    ])
    // 「要確認」は人が決める。**決めるまで本実行できない**ことを書く。
    expect(PAGE).toContain('「要確認」を全部決めるまで本実行できません')
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

  it('固定値を画面で作らず、APIの人数を合計確認して表示する', () => {
    expect(PAGE).toContain('api.accountHandovers.listForAccount(id)')
    expect(PAGE).toContain('api.accountHandovers.get(current.id)')
    expect(PAGE).toContain('totalsMatch(handover.counts, handover.counts.sourceTotal)')
    expect(PAGE).toContain("countsAreComplete ? `${handover.counts?.[bucket.key].toLocaleString('ja-JP')}人` : '—'")
  })

  it('事前確認では元のアカウントが変わらないと書く', () => {
    // 押す前に、戻れるかどうかを読ませる。
    expect(PAGE).toContain('ここで止めても、元のアカウントは何も変わりません')
  })

  it('事前確認をやり直す操作を実APIへつなぐ', () => {
    expect(PAGE).toContain('api.accountHandovers.preview(handover.id')
    expect(PAGE).toContain('事前確認をやり直す')
    expect(PAGE).toContain('disabled={(handover.unresolvedReviews ?? 1) > 0}')
  })

  it('プロバイダーが違うときの断りを持つ', () => {
    /*
      **同じ人でも別のIDになる。** これを書かずに進めると、事前確認で
      「一致しない」が大量に出た理由が分からない。
    */
    expect(DIFFERENT_PROVIDER_NOTE).toContain('同じ人でも別のIDになります')
    expect(DIFFERENT_PROVIDER_NOTE).toContain('対応表を取り込むか')
  })

  it('動的セグメントを使わない', () => {
    // 静的書き出しなので `[id]` は書き出せない。
    expect(PAGE).toContain("search?.get('id')")
  })
})
