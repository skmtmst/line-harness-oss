import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { element } from './design-fit-slice'

const ROOT = path.resolve(__dirname)
const LIST = fs.readFileSync(path.join(ROOT, 'mark-list.tsx'), 'utf8')
const EDITOR = fs.readFileSync(path.join(ROOT, 'support-mark-editor.tsx'), 'utf8')
const TABS = fs.readFileSync(path.join(ROOT, 'tags-page-v4.tsx'), 'utf8')

describe('V6 対応マーク', () => {
  it('一覧は実Node、KPI、絞り込み、設計の列を持つ', () => {
    expect(LIST).toContain('data-design-node="rIhbN"')
    for (const label of ['マークの種類', '未対応', '対応中', '過去7日の変更']) expect(LIST).toContain(label)
    // 見出しは表の中だけを見る。注釈や他の行に同じ言葉があっても通さない。
    const thead = element(LIST, 'thead')
    for (const label of ['順番', 'マーク', '使用中', '初期値', '自動変更', '表示先', '操作']) expect(thead).toContain(label)
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
    for (const label of ['マーク名', '色', '並び順', '新しい友だちに最初から付ける']) expect(EDITOR).toContain(label)
  })

  it('基本情報・自動変更・使用先を同じ段で確認できる', () => {
    expect(EDITOR).toContain('xl:grid-cols-3')
    expect(EDITOR).toContain('<SupportMarkRulesPanel')
    for (const label of ['受信箱の絞り込み', '友だち一覧の列と絞り込み', 'ダッシュボードの絞り込み', '配信の絞り込み条件', 'オートメーションの動作']) {
      expect(EDITOR).toContain(label)
    }
    expect(EDITOR).not.toContain('メッセージ受信時にこのマークへ変更')
    expect(EDITOR).not.toContain('現在接続済みの受信時設定だけを変更します')
  })

  it('保存と保管の失敗で内部のAPI文言をそのまま表示しない', () => {
    expect(EDITOR).toContain('対応マークを保存できませんでした。状態を読み直してから、もう一度お試しください。')
    expect(LIST).toContain('対応マークを保管できませんでした。状態を読み直してから、もう一度お試しください。')
    expect(EDITOR).not.toContain('reason instanceof ApiError ? reason.message')
    expect(LIST).not.toContain("reason instanceof ApiError ? reason.message : '削除できませんでした'")
  })

  it('影響確認の版と冪等キーを使い、選んだマークへ置換して保管する', () => {
    expect(LIST).toContain('function isUsed(mark: MarkRow)')
    expect(LIST).toContain('referenceCount(mark) > 0')
    expect(LIST).toContain('api.supportMarks.archiveImpact(mark.id, accountId)')
    expect(LIST).toContain('impactRevision: archiveImpact.impactRevision')
    expect(LIST).toContain('expectedVersion: archiveImpact.expectedVersion')
    expect(LIST).toContain('crypto.randomUUID()')
    expect(LIST).toContain('value={replacementMarkId}')
    expect(LIST).toContain('履歴を残します')
    expect(LIST).not.toContain('force: mark.friendCount > 0')
  })

  it('保管確認は zGZMA の位置と幅で、置換先と対象人数に絞る', () => {
    expect(LIST).toContain('data-design-node="zGZMA"')
    expect(LIST).toContain('保管後は新しく選べません')
    expect(LIST).toContain('{impact.friendCount}人を「{selected.name}」へ置き換えます。')
    expect(LIST).toContain("[data-design-part='archive-position']")
    expect(LIST).toContain('margin-top: 310px')
    expect(LIST).toContain('max-width: 680px')
  })

  it('タブ行から追加画面へ進める', () => {
    expect(TABS).toContain('href="/tags/marks/new"')
    expect(TABS).toContain('＋ マークを追加')
  })
})
