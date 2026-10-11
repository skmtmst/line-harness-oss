import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { element } from './design-fit-slice'

const ROOT = path.resolve(__dirname)
const LIST = fs.readFileSync(path.join(ROOT, '../../v8/tags/marks-tab.tsx'), 'utf8') + fs.readFileSync(path.join(ROOT, 'mark-list.tsx'), 'utf8')
const EDITOR = fs.readFileSync(path.join(ROOT, '../../v8/tags/mark-editor.tsx'), 'utf8')
const TABS = fs.readFileSync(path.join(ROOT, '../../v8/tags/list.tsx'), 'utf8')

describe('V8 対応マーク', () => {
  it('一覧は実Node、KPI、絞り込み、設計の列を持つ', () => {
    expect(TABS).toContain("'vKDj5'")
    for (const label of ['マーク', '未対応', '対応中', '過去7日の変更']) expect(LIST).toContain(label)
    // 見出しは表の中だけを見る。注釈や他の行に同じ言葉があっても通さない。
    const thead = element(LIST, 'thead')
    for (const label of ['並び替え', 'マーク', '付いている人', 'はじめの値', '自動で変わる', '出す場所', '操作']) expect(thead).toContain(label)
    // 絞り込みは共通 Select。題と「すべて」の選択肢が分かれている。
    expect(LIST).toContain('aria-label="使っているかで絞り込む"')
    expect(LIST).toContain("{ value: 'all', label: '使っている：すべて' }")
    // ATTR-01: 取得時のアカウントを退避し、応答が届いた時点の選択と照合する。
    expect(LIST).toContain('api.supportMarks.list(account, { includeArchived: true })')
  })

  it('追加編集画面は本文タイトルを置かず、トップバーへ画面名を渡す', () => {
    expect(EDITOR).toContain('boardId="ulq9Y"')
    expect(EDITOR).toContain("usePageTitle(editing ? '対応マークを編集' : '対応マークを作る')")
    expect(EDITOR).not.toContain('<Header')
    expect(EDITOR).toContain('api.supportMarks.create')
    expect(EDITOR).toContain('api.supportMarks.update')
    // R510: 一覧の取得は再試行できる形（load 関数）に切り出した。
    // 取得時のアカウントを退避し、その口を呼ぶ約束は変えない。
    expect(EDITOR).toContain('api.supportMarks.list(account)')
    const basic = fs.readFileSync(path.join(ROOT, '../../v8/tags/mark-basic-fields.tsx'), 'utf8')
    for (const label of ['マーク名', '色']) expect(basic).toContain(label)
    expect(EDITOR).toContain('新しい友だちに最初から付ける')
    expect(EDITOR).toContain('name: name.trim(), color, displayOrder, isDefault')
  })

  it('保存と保管の失敗で内部のAPI文言をそのまま表示しない', () => {
    // R511: 保存の失敗文は共通関数（失敗の文の共通関数）に寄せた。
    // 403 の権限不足と通信の失敗を分け、API の本文をそのまま出さない約束は変えない。
    expect(EDITOR).toContain('describeSaveFailure(reason)')
    expect(LIST).toContain('対応マークを保管できませんでした。状態を読み直してから、もう一度お試しください。')
    expect(EDITOR).not.toContain('reason instanceof ApiError ? reason.message')
    expect(LIST).not.toContain("reason instanceof ApiError ? reason.message : '削除できませんでした'")
  })

  it('影響確認の版と冪等キーを使い、選んだマークへ置換して保管する', () => {
    expect(LIST).toContain('function isUsed(mark: MarkRow)')
    expect(LIST).toContain('referenceCount(mark) > 0')
    expect(LIST).toContain('api.supportMarks.archiveImpact(mark.id, account)')
    expect(LIST).toContain('impactRevision: archiveImpact.impactRevision')
    expect(LIST).toContain('expectedVersion: archiveImpact.expectedVersion')
    expect(LIST).toContain('crypto.randomUUID()')
    expect(LIST).toContain('value={replacementMarkId}')
    expect(LIST).toContain('履歴に残します')
    expect(LIST).not.toContain('force: mark.friendCount > 0')
  })

  it('保管確認は fy5dz の位置と幅で、置換先と対象人数に絞る', () => {
    expect(LIST).toContain('data-design-node="fy5dz"')
    expect(LIST).toContain('そのまま保管できます')
    expect(LIST).toContain('{impact.friendCount}人を「{selected.name}」へ置き換えます。')
    /*
      #1014 ATTR-17: 上から310px固定はやめる。390×480では下部の
      「やめる」「置き換えて保管する」が画面外に出て、スクロールでも
      届かなかった。画面の中に収め、中身が溢れたら内側だけを流す。
      見出しと操作は常に見える。
    */
    expect(LIST).toContain('data-design-part="archive-position"')
    expect(LIST).toContain('items-center')
    expect(LIST).toContain('max-h-[calc(100dvh-2rem)]')
    expect(LIST).toContain('overflow-y-auto')
    expect(LIST).not.toContain('margin-top: 310px')
  })

  it('タブ行から追加画面へ進める', () => {
    expect(TABS).toContain('href="/tags/marks/new"')
    expect(TABS).toContain('マークを作る')
  })
})
