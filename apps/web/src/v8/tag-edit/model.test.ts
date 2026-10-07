import { describe, expect, it } from 'vitest'
import { actionCategory, actionsSummary, buildUsageRows, mileageSummary } from './model'
import { headUsageText, optionsWithCurrent, usageRowsOf } from './search-model'

describe('タグの編集の計算', () => {
  it('タグ連動の要約は数と種類（重ねない）。オフ・空はそれと分かる言葉', () => {
    const actions = [
      { id: '1', type: 'シナリオ開始', label: 'a', timing: 'すぐに' },
      { id: '2', type: 'タグ追加', label: 'b', timing: 'すぐに' },
      { id: '3', type: '対応マーク変更', label: 'c', timing: 'すぐに' },
      { id: '4', type: 'タグ解除', label: 'd', timing: 'すぐに' },
    ]
    expect(actionCategory('対応マーク変更')).toBe('対応マーク')
    expect(actionsSummary(actions, true)).toBe('4つの動き（シナリオ・タグ・対応マーク）')
    expect(actionsSummary([], true)).toBe('動きはまだありません')
    expect(actionsSummary(actions, false)).toContain('連動はオフ')
  })

  it('マイルの要約は倍率を先に、無ければ付与の数', () => {
    expect(mileageSummary('12000', 10, 0)).toBe('今のマイル倍率 1.2倍')
    expect(mileageSummary('', 10, 5)).toBe('付くと本人 10 mile・紹介者 5 mile')
    expect(mileageSummary('', 0, 0)).toBe('マイルの設定はありません')
  })

  it('使っている所：一斉配信・回答フォーム・オートメーションは常に、ほかは使っているときだけ。影響確認の数を先に使う', () => {
    const dependencies = {
      referenceCounts: { broadcasts: 3, forms: 0, automations: 0, scenarios: 2, autoReplies: 0, savedSearches: 0 },
      references: [{ kind: 'broadcast', name: '一斉配信', href: '/broadcasts', count: 3, state: 'active', definitionVersion: null }],
    } as never
    const rows = buildUsageRows(dependencies, { broadcasts: 9 })
    expect(rows.map((r) => [r.label, r.count, r.href])).toEqual([
      ['一斉配信', 3, '/broadcasts'],
      ['回答フォーム', 0, null],
      ['オートメーション', 0, null],
      ['シナリオ', 2, null],
    ])
    // 影響確認が取れないときはタグの一覧の数。分からない所は known=false（「なし」と言い切らない）。
    const fallback = buildUsageRows(null, { broadcasts: 4 })
    expect(fallback[0]).toMatchObject({ count: 4, known: true })
    expect(fallback[2]).toMatchObject({ label: 'オートメーション', known: false })
  })
})

describe('保存した検索の編集の計算', () => {
  it('使っている所：一斉配信・自動処理は常に。固定は（固定）。取れていないときは —', () => {
    const usedIn = [
      { kind: 'broadcast' as const, id: 'b', name: '秋の案内', mode: 'live' as const, lastUsedAt: null },
      { kind: 'scenario' as const, id: 's', name: '3日後', mode: 'fixed' as const, lastUsedAt: null },
    ]
    expect(usageRowsOf(usedIn)).toEqual([
      { label: '一斉配信', value: '秋の案内' },
      { label: '自動処理', value: 'なし' },
      { label: 'シナリオ', value: '3日後（固定）' },
    ])
    expect(usageRowsOf(undefined)).toEqual([{ label: '一斉配信', value: '—' }, { label: '自動処理', value: '—' }])
    expect(headUsageText(usedIn)).toBe('一斉配信「秋の案内」で使っている（ほか1件）')
    expect(headUsageText([])).toBe('使っている所はありません')
  })

  it('一覧に無い保存済みの値は消さず「選択済み」で残す', () => {
    expect(optionsWithCurrent([{ value: 'a', label: 'A' }], 'x', '選択済み', '選ぶ')).toEqual([
      { value: '', label: '選ぶ' }, { value: 'x', label: '選択済み' }, { value: 'a', label: 'A' },
    ])
  })
})
