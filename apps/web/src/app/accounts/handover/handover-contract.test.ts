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
    expect(PAGE).toContain("countsAreComplete && handover.counts ? countsLine(handover.counts)")
    expect(countsLine({sourceTotal:2,auto:1,review:1,unmatched:0,lookalike:0})).toBe('元の友だち 2 人：自動で同じ人 1・要確認 1')
  })

  it('事前確認では元のアカウントが変わらないと書く', () => {
    // 押す前に、戻れるかどうかを読ませる。
    expect(PAGE).toContain('元のアカウントの友だち・履歴・配信は消しません')
  })

  it('事前確認をやり直す操作を実APIへつなぐ', () => {
    expect(PAGE).toContain('api.accountHandovers.preview(handover.id')
    expect(PAGE).toContain('事前確認をやり直す')
    expect(PAGE).toContain('const executeDisabled = unresolved > 0')
  })

  it('プロバイダーが違うときの断りを持つ', () => {
    /*
      **同じ人でも別のIDになる。** これを書かずに進めると、事前確認で
      「一致しない」が大量に出た理由が分からない。
    */
    expect(DIFFERENT_PROVIDER_DETAIL).toContain('同じ人でも別のIDになる')
    expect(DIFFERENT_PROVIDER_DETAIL).toContain('対応表を取り込むか')
  })

  it('?id= なしで開いたとき、無限ローディングにせず一覧へ戻す', () => {
    /*
      `load` は `!id` で何もせず帰るので、ガードがないと
      「読み込んでいます」が消えない（監査 Issue #1058）。
      対象未指定は失敗ではないので、再読み込みではなく一覧への口を出す。
    */
    expect(PAGE).toContain('if (!id)')
    expect(PAGE).toContain('乗り換えるアカウントが指定されていません')
    expect(PAGE).toContain('backHref="/accounts"')
  })

  it('動的セグメントを使わない', () => {
    // 静的書き出しなので `[id]` は書き出せない。
    expect(PAGE).toContain("search?.get('id')")
  })

  it('変更の可否は共通の出し分けで決め、手元の保存値で決めない（R522）', () => {
    // サーバの requireRole('owner', 'admin') と同じ境目を使う。
    // 直しを戻すと赤くなること: staff.me を読まない・canManage の分岐を外す。
    // `api.staff.me` の呼び出し本体は共通の出し分け側にあり、ここでは読む。
    const HELPER = readFileSync(join(HERE, '..', '..', '..', 'lib', 'staff-role.ts'), 'utf8')
    expect(PAGE).toContain("from '@/lib/staff-role'")
    expect(PAGE).toContain('useStaffRole')
    expect(PAGE).toContain('canManageRole')
    expect(HELPER).toContain('api.staff.me()')
    expect(PAGE).not.toContain("localStorage.getItem('lh_staff_role')")
  })

  it('見るだけには変更の入口を出さず、理由を1つの帯で案内する（R522）', () => {
    // 入口の描画から1000字以内に canManage の分岐があること。
    // 注釈文の同名語に当たらないよう、描画だけの形で探す。
    // 直しを戻すと赤くなること: 分岐を外して入口を無条件表示に戻す。
    const gated = (entry: string, label: string) => {
      const at = PAGE.indexOf(entry)
      expect(at, `${label} が画面にありません`).toBeGreaterThan(-1)
      expect(
        PAGE.slice(Math.max(0, at - 1000), at),
        `${label} が canManage で守られていません`,
      ).toContain('canManage')
    }
    gated('onClick={() => { setExecuteError(\'\'); void issueCode() }}', '引き継ぎコードを出す')
    gated('onClick={() => void submitLinkCode()}', 'コードを読む')
    gated('onClick={() => void rerunPreview()}', '事前確認をやり直す')
    gated('onClick={() => void saveDecisions()}', '判断を保存する')
    gated('disabled={executeDisabled}', '本実行する')
    gated('onClick={() => setCancelOpen(true)}', '引き継ぎをやめる')
    gated('onClick={() => { setRollbackError(\'\'); setRollbackOpen(true) }}', '切り戻す')
    expect(PAGE).toContain('引き継ぎの変更はオーナーと管理者だけができます')
    expect(PAGE).toContain('<ReadOnlyNotice')

  })
})
