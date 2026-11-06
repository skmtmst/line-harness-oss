import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const NEW_PAGE = readUiSource(new URL('./new/page.tsx', import.meta.url), 'utf8')
const LIST_PAGE = readUiSource(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * 起点の説明・金額の出し方は対応表(origin-labels)が正本。起点ごとの言葉の直書きや
 * 3択の固定一覧へ戻さない禁止の見張り。
 * 対応表を引いて出すこと（作成・一覧の詳細・編集）、数えない条件の共通部品とメモ欄、試算の注意、
 * 起点に合う金額の出し方と知らせ、金額なしの区別は描画の試験が確かめる
 * （app/conversions/new/audit-detail.test.tsx・exclusion-empty-or.test.tsx、conversion-revise-react.test.tsx、
 * v8/conversions/list.test.tsx・create.test.tsx、origin-labels.test.ts）。
 */
describe('起点の説明の共通化', () => {
  it('一覧・詳細は起点ごとの分岐を直書きしない', () => {
    // タグ起点でも注文の説明が出る分岐。対応表へ移したので残さない。
    expect(LIST_PAGE).not.toContain('EC連携からの通知')
    expect(NEW_PAGE).not.toContain('すべての注文を対象に保存します')
  })
})

describe('数えない条件の共通化', () => {
  it('自由文のメモ欄を条件の欄と取り違えない', () => {
    expect(NEW_PAGE).not.toContain('cv-excluded-condition')
  })
})

describe('起点に合う金額の出し方', () => {
  it('作成と編集は金額の出し方の3択を直書きしない', () => {
    // 3択の直書きは残さない(起点に金額が無いとき注文の金額が出てしまう)。
    expect(NEW_PAGE).not.toContain("{ value: 'source', label: '注文の金額をそのまま使う' }")
    expect(LIST_PAGE).not.toContain('VALUE_MODE_OPTIONS')
  })
})
