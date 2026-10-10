import { describe, expect, it } from 'vitest'
// @ts-expect-error Nodeで実行するmjsには宣言ファイルを置かない
import { applyTemporaryAllowances, patternFindingKey, skeletonFindingKey } from './visual-qa/temporary-allowances.mjs'

const permit = { match: 'known', count: 1, reason: '固定Penの値に合わせる修正待ち', owner: 'pendec', expires: '2026-10-17' }
const check = (values: string[], entries = [permit]) => applyTemporaryAllowances(values, entries, (v: string) => v, '2026-10-10')

describe('列車16の期限付き一時許可', () => {
  it('生の結果を残し、既知の対象だけを許可する', () => {
    const values = ['known', 'new']
    const result = check(values)
    expect(result.allowed[0]).toMatchObject({ finding: 'known', reason: permit.reason, owner: 'pendec' })
    expect(result.unexpected).toEqual(['new'])
    expect(values).toEqual(['known', 'new'])
  })
  it('同じ違反が1件増えた場合も止める', () => { expect(check(['known', 'known']).unexpected).toEqual(['known']) })
  it('設計の値やコードの内容が変われば許可しない', () => { expect(check(['known changed']).unexpected).toEqual(['known changed']) })
  it('解消した違反を生の結果へ足さない', () => { expect(check([])).toEqual({ allowed: [], unexpected: [] }) })
  it('期限切れを止める', () => { expect(() => check(['known'], [{ ...permit, expires: '2026-10-09' }])).toThrow('期限切れ') })
  it.each([{ reason: '' }, { owner: '' }, { count: 0 }, { count: 1.5 }, { expires: '2026-02-30' }, { expires: '*' }])('不完全な許可を止める: %j', change => {
    expect(() => check(['known'], [{ ...permit, ...change }])).toThrow('不正')
  })
  it('重複した許可で件数を広げられない', () => { expect(() => check(['known'], [permit, permit])).toThrow('不正') })
  it('一覧の型の一時許可はルート・幅・違反の種類を広げられない', () => {
    const hit = { route: '/restaurant-test/reservations?view=list', width: 1152, failure: 'B-178 一覧の型なし' }
    const entries = [{ ...permit, match: skeletonFindingKey(hit) }]
    for (const change of [{ route: '/friends' }, { width: 1440 }, { failure: 'B-178 一覧のはみ出し' }]) {
      const result = applyTemporaryAllowances([hit, { ...hit, ...change }], entries, skeletonFindingKey, '2026-10-10')
      expect(result.allowed).toHaveLength(1)
      expect(result.unexpected).toHaveLength(1)
    }
  })
  it('行番号の変化は許し、ファイル・型・内容の変化は区別する', () => {
    const hit = { category: 'a', pattern: 'field', file: 'screen.tsx', signal: 'raw', text: '<Field   />', line: 1 }
    expect(patternFindingKey(hit)).toBe(patternFindingKey({ ...hit, line: 99, text: '<Field />' }))
    for (const change of [{ file: 'other.tsx' }, { pattern: 'picker' }, { text: '<Field value={x} />' }]) expect(patternFindingKey({ ...hit, ...change })).not.toBe(patternFindingKey(hit))
  })
})
