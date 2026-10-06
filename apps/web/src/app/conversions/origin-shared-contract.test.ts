import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const NEW_PAGE = readFileSync(new URL('./new/page.tsx', import.meta.url), 'utf8')
const LIST_PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
/* 詳細・編集の窓は v7/V8 共用の `_components/conversion-dialogs.tsx` にある。 */
const DIALOGS = readFileSync(new URL('./_components/conversion-dialogs.tsx', import.meta.url), 'utf8')

/**
 * R41: 起点の説明は対応表(origin-labels)が正本。作成・一覧・詳細・編集の
 * 4つが同じものを使う。起点ごとに言葉を書き分けると、タグ起点なのに
 * 「注文」「EC連携」と出る取り違えが起きる。
 */
describe('起点の説明の共通化(R41)', () => {
  it('作成と一覧は対応表から引く', () => {
    expect(NEW_PAGE).toContain("from '../origin-labels'")
    expect(NEW_PAGE).toContain('originInfoOf(eventType)')
    expect(LIST_PAGE).toContain("from './origin-labels'")
    expect(LIST_PAGE).toContain('originInfoOf(')
  })

  it('一覧・詳細は起点ごとの分岐を直書きしない', () => {
    // タグ起点でも注文の説明が出ていた分岐。対応表へ移したので残さない。
    expect(LIST_PAGE).not.toContain('EC連携からの通知')
    expect(NEW_PAGE).not.toContain('すべての注文を対象に保存します')
  })

  it('詳細と編集は対象・金額・起点の確認を出す', () => {
    expect(DIALOGS).toContain('対象</dt>')
    expect(DIALOGS).toContain('金額</dt>')
    expect(DIALOGS).toContain('数えない条件</dt>')
    expect(DIALOGS).toContain('起点：')
  })
})

/**
 * R40: 数えない条件は作成・編集の両方で共通の条件部品を使う。
 * 試算の注意(excludedReasons)は作成画面に出す。
 */
describe('数えない条件の共通化(R40)', () => {
  it('作成と編集は ConditionBuilder を使う', () => {
    expect(NEW_PAGE).toContain('ConditionBuilder')
    expect(NEW_PAGE).toContain('showCount={false}')
    expect(DIALOGS).toContain('ConditionBuilder')
  })

  it('作成は試算の注意を出す', () => {
    expect(NEW_PAGE).toContain('preview.excludedReasons')
  })

  it('自由文のメモ欄は条件の部品とは別にある', () => {
    expect(NEW_PAGE).toContain('cv-exclusion-memo')
    expect(NEW_PAGE).not.toContain('cv-excluded-condition')
  })
})

/**
 * 起点に合う金額の出し方: 使える出し方と既定は対応表が持ち、作成は
 * そこから選ぶ。起点を切り替えて合わなくなったら既定へ戻して知らせる。
 */
describe('起点に合う金額の出し方', () => {
  it('作成は金額の出し方を対応表から作る', () => {
    expect(NEW_PAGE).toContain('origin.valueModes')
    expect(NEW_PAGE).toContain('defaultValueMode')
    // 3択の直書きは残さない(起点に金額が無いとき注文の金額が出てしまう)。
    expect(NEW_PAGE).not.toContain("{ value: 'source', label: '注文の金額をそのまま使う' }")
  })

  it('作成は起点切替で合わない選択を既定へ戻して知らせる', () => {
    expect(NEW_PAGE).toContain('valueModeNotice')
    expect(NEW_PAGE).toContain('role="status"')
  })

  it('編集も金額の決め方を対応表から作る', () => {
    expect(DIALOGS).toContain('originInfoOf(editForm.sourceType).valueModes')
    expect(LIST_PAGE).toContain('EDIT_VALUE_MODE_LABELS')
    expect(LIST_PAGE).toContain('editValueModeNotice')
    // 3択の固定一覧は残さない(起点に金額が無いとき注文の金額が出てしまう)。
    expect(LIST_PAGE).not.toContain('VALUE_MODE_OPTIONS')
  })
})

/**
 * R42: 金額なしは0円と区別して出す。
 */
describe('金額なしの区別(R42)', () => {
  it('詳細の成果1件ずつは金額なしを字で出す', () => {
    expect(LIST_PAGE).toContain('金額なし')
  })
})
