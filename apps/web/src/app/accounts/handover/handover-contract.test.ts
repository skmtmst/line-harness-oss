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
 * **口がまだ無い**（台帳 #133）。流れを描いて止める。
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

  it('人数を作らない', () => {
    // 事前確認の口がまだ無い。**0 と書くと「1人もいない」と読まれる。**
    expect(PAGE).toContain('<p className="text-ink mt-1 text-2xl font-semibold">—</p>')
  })

  it('事前確認では元のアカウントが変わらないと書く', () => {
    // 押す前に、戻れるかどうかを読ませる。
    expect(PAGE).toContain('ここで止めても、元のアカウントは何も変わりません')
  })

  it('できない口を置かず、理由を書く', () => {
    // `v6-common-rules.md` §7-10「出す＝使える」。
    expect(PAGE).toContain('まだ始められません')
    expect(PAGE).toContain('引き継ぎコードを出す仕組みと、事前確認の突合が、まだ繋がっていません。')
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
