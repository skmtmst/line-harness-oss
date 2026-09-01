import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(process.cwd(), 'src/app/tags/searches/edit/page.tsx'), 'utf8')

describe('保存した検索の条件編集', () => {
  it('対応マーク・シナリオ・友だち情報を既存APIから名前で選ぶ', () => {
    expect(PAGE).toContain('api.supportMarks.list(selectedAccountId)')
    expect(PAGE).toContain('api.scenarios.list({ accountId: selectedAccountId })')
    expect(PAGE).toContain('api.friendFields.list()')
    expect(PAGE).toContain('marks.map((mark) => ({ value: mark.id, label: mark.name }))')
    expect(PAGE).toContain('scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))')
    expect(PAGE).toContain('fields.map((field) => ({ value: field.fieldKey, label: field.name }))')
  })

  it('参照先を取得できない状態と0件を同じ言葉にしない', () => {
    expect(PAGE).toContain("'対応マークを取得できません'")
    expect(PAGE).toContain("'対応マークがありません'")
    expect(PAGE).toContain("'シナリオを取得できません'")
    expect(PAGE).toContain("'シナリオがありません'")
    expect(PAGE).toContain("'友だち情報を取得できません'")
    expect(PAGE).toContain("'友だち情報がありません'")
  })

  it('対応マークとシナリオを内部IDの自由入力へ戻さない', () => {
    expect(PAGE).toContain('condition.kind === \'mark\'')
    expect(PAGE).toContain('condition.kind === \'scenario\'')
    expect(PAGE).toContain('optionsWithCurrent(')
  })
})
