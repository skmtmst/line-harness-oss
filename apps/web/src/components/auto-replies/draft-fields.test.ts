import { describe, expect, it } from 'vitest'
import {
  applyMatchType,
  emptyKeywordRule,
  exactAllMismatchNotice,
  initialMatchType,
  readKeywordRules,
  toKeywordPayload,
} from './draft-fields'

/**
 * 監査 R29（部分一致が保存に反映されない）の画面側の契約。
 *
 * 一致方法の選択（`matchType` の状態）と保存される複数行
 * （`keywords` の中身）を1つにする。選択を変えたら全行へ載せ、
 * 行を足したらいまの選択を引き継ぐ。保存時は空行を落とし、
 * 先頭の `keyword / matchType` も行と同じ当て方にする。
 */
describe('initialMatchType: 開いたときに効いている当て方を出す', () => {
  it('複数行が無ければこれまでの1行を見る', () => {
    expect(initialMatchType({ keyword: '予約', matchType: 'contains', keywords: null })).toBe(
      'contains',
    )
  })

  it('保存された複数行がそろっていればその当て方を出す', () => {
    expect(
      initialMatchType({
        keyword: '予約',
        matchType: 'exact',
        keywords: [
          { keyword: '予約', matchType: 'contains' },
          { keyword: '変更', matchType: 'contains' },
        ],
      }),
    ).toBe('contains')
  })

  it('行がばらばらなら先頭の行を出す（行はそのまま残す）', () => {
    expect(
      initialMatchType({
        keyword: '予約',
        matchType: 'exact',
        keywords: [
          { keyword: '予約', matchType: 'contains' },
          { keyword: '変更', matchType: 'exact' },
        ],
      }),
    ).toBe('contains')
  })
})

describe('emptyKeywordRule: 足した行はいまの選択を引き継ぐ', () => {
  it('何も言わなければ完全一致（これまでどおり）', () => {
    expect(emptyKeywordRule()).toMatchObject({ keyword: '', matchType: 'exact' })
  })

  it('部分一致を選んでいるときに足すと部分一致になる', () => {
    expect(emptyKeywordRule('contains')).toMatchObject({ keyword: '', matchType: 'contains' })
  })
})

describe('applyMatchType: 選択を変えたら全行へ載せる', () => {
  it('言葉はそのまま、当て方だけ変わる', () => {
    const rows = readKeywordRules({
      keyword: '予約',
      matchType: 'exact',
      keywords: [{ keyword: '予約', matchType: 'exact' }],
    })
    const next = applyMatchType(rows, 'contains')
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ keyword: '予約', matchType: 'contains' })
    // 元の配列は壊さない
    expect(rows[0].matchType).toBe('exact')
  })
})

describe('toKeywordPayload: 行の当て方を落とさない', () => {
  it('部分一致の行は部分一致のまま送る', () => {
    expect(toKeywordPayload({ keyword: '予約', matchType: 'contains', minLength: '', caseSensitive: true })).toEqual({
      keyword: '予約',
      matchType: 'contains',
    })
  })
})

/**
 * R257: 異なる文言の完全一致をすべて必須にすると不成立になる。
 * 理由付きの案内を出し、条件の変更も保存の停止もしない。
 */
describe('exactAllMismatchNotice: 不成立の組み合わせだけ案内する', () => {
  const row = (keyword: string, matchType: 'exact' | 'contains' = 'exact', caseSensitive = true) => ({
    keyword,
    matchType,
    minLength: '',
    caseSensitive,
  })

  it('異なる2語の完全一致allで案内が出る', () => {
    const notice = exactAllMismatchNotice([row('予約'), row('キャンセル')], 'all')
    expect(notice).toContain('このままでは応答しません')
    expect(notice).toContain('部分一致')
  })

  it('部分一致all・完全一致any・同じ1語・1行だけでは出ない', () => {
    expect(exactAllMismatchNotice([row('予約', 'contains'), row('キャンセル', 'contains')], 'all')).toBeNull()
    expect(exactAllMismatchNotice([row('予約'), row('キャンセル')], 'any')).toBeNull()
    expect(exactAllMismatchNotice([row('予約'), row('予約')], 'all')).toBeNull()
    expect(exactAllMismatchNotice([row('予約')], 'all')).toBeNull()
  })

  it('空行は数えない（未入力の2行目では出ない）', () => {
    expect(exactAllMismatchNotice([row('予約'), row('')], 'all')).toBeNull()
  })

  it('区別しない行が混ざるときは出さない（成立し得るため）', () => {
    expect(exactAllMismatchNotice([row('予約'), row('キャンセル', 'exact', false)], 'all')).toBeNull()
  })
})
