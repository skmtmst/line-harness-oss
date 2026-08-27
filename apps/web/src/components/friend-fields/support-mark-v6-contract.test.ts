import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname)
const LIST = fs.readFileSync(path.join(ROOT, 'mark-list.tsx'), 'utf8')
const EDITOR = fs.readFileSync(path.join(ROOT, 'support-mark-editor.tsx'), 'utf8')
const TABS = fs.readFileSync(path.join(ROOT, 'tags-page-v4.tsx'), 'utf8')

describe('V6 対応マーク', () => {
  it('一覧は実Node、KPI、絞り込み、設計の列を持つ', () => {
    expect(LIST).toContain('data-design-node="rIhbN"')
    for (const label of ['マークの種類', '未対応', '対応中', '過去7日の変更']) expect(LIST).toContain(label)
    for (const label of ['順番', 'マーク', '使用中', '初期値', '自動変更', '表示先', '操作']) expect(LIST).toContain(label)
    expect(LIST).toContain('利用状態：すべて')
    expect(LIST).toContain('api.supportMarks.list(accountId)')
  })

  it('追加編集画面は本文タイトルを置かず、トップバーへ画面名を渡す', () => {
    expect(EDITOR).toContain('data-design-node="GMvBd"')
    expect(EDITOR).toContain("usePageTitle(editing ? '対応マークを編集' : '対応マークを追加')")
    expect(EDITOR).not.toContain('<Header')
    expect(EDITOR).toContain('api.supportMarks.create')
    expect(EDITOR).toContain('api.supportMarks.update')
    expect(EDITOR).toContain('api.supportMarks.list(selectedAccountId)')
  })

  it('タブ行から追加画面へ進める', () => {
    expect(TABS).toContain('href="/tags/marks/new"')
    expect(TABS).toContain('＋ マークを追加')
  })
})
