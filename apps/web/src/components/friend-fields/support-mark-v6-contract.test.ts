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
    for (const label of ['マーク名', '色', '並び順', '新着時の初期値にする']) expect(EDITOR).toContain(label)
  })

  it('未接続の自動変更ルールを作ったように見せず、既存の受信時設定だけを残す', () => {
    expect(EDITOR).not.toContain('>自動変更ルール</h2>')
    expect(EDITOR).toContain('メッセージ受信時にこのマークへ変更')
    expect(EDITOR).toContain('現在接続済みの受信時設定だけを変更します')
    expect(EDITOR).not.toContain('担当者割当・期限超過')
  })

  it('保存と削除の失敗で内部のAPI文言をそのまま表示しない', () => {
    expect(EDITOR).toContain('対応マークを保存できませんでした。状態を読み直してから、もう一度お試しください。')
    expect(LIST).toContain('対応マークを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    expect(EDITOR).not.toContain('reason instanceof ApiError ? reason.message')
    expect(LIST).not.toContain("reason instanceof ApiError ? reason.message : '削除できませんでした'")
  })

  it('タブ行から追加画面へ進める', () => {
    expect(TABS).toContain('href="/tags/marks/new"')
    expect(TABS).toContain('＋ マークを追加')
  })
})
