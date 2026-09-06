import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const EDITOR = fs.readFileSync(
  path.join(__dirname, '../../components/auto-replies/edit-dialog.tsx'),
  'utf8',
)
const PUBLISH = fs.readFileSync(
  path.join(__dirname, 'publish/page.tsx'),
  'utf8',
)
const PUBLISH_CSS = fs.readFileSync(
  path.join(__dirname, 'publish/publish.css'),
  'utf8',
)
const LIST = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const EDIT_PAGE = fs.readFileSync(path.join(__dirname, 'edit/page.tsx'), 'utf8')

describe('V6 自動応答一覧の契約', () => {
  it('共通の編集用変換と保存本文で所属フォルダを引き継ぐ', () => {
    expect(EDITOR).toContain('folderId: rule.folderId ?? null')
    expect(EDITOR).toContain("useState(draft.folderId ?? '')")
    expect(EDITOR).toContain('folderId: folderId || null')
  })

  it('フォルダの未取得を0件に見せず、同じ編集画面で再取得できる', () => {
    expect(EDITOR).toContain('res.success && Array.isArray(res.data)')
    expect(EDITOR).toContain("foldersLoadState === 'error'")
    expect(EDITOR).toContain("disabled={foldersLoadState !== 'ready'}")
    expect(EDITOR).toContain('フォルダを読み込めませんでした')
    expect(EDITOR).toContain('現在のフォルダ（名前を確認できません）')
    expect(EDITOR).toContain('フォルダを確認できないため、選択を変更できません。')
    expect(EDITOR).toContain('setFoldersReloadToken((value) => value + 1)')
  })

  it('公開前テストは実在する友だちを選び、本番と同じdry-run APIへ渡す', () => {
    expect(PUBLISH).toContain('api.friends.list({')
    expect(PUBLISH).toContain('friendId: selectedFriendId')
    expect(PUBLISH).toContain('api.autoReplies.testDraft(autoReplyId')
    expect(PUBLISH).toContain('setDryRun(res.data)')
  })

  it('テスト・最終確認・有効化完了を実Nodeと5段表示へ結び付ける', () => {
    for (const node of ['g46ja', 'Yj6CQ', 'e6iJG']) expect(PUBLISH).toContain(node)
    for (const label of ['基本設定', 'どんなときに動くか', '何を返すか', '優先順位', '確認']) {
      expect(PUBLISH).toContain(label)
    }
    expect(PUBLISH_CSS).toContain('grid-template-columns: minmax(0, 1fr) 390px')
  })

  it('取得できなかった過去28日の数を0件に見せない', () => {
    expect(PUBLISH).toContain("? '—（未取得）'")
    expect(PUBLISH).toContain('`${draft.matchedLast28Days}件／28日`')
  })

  it('一覧を設計の6列に収め、ルール名の下に一致方法と返信の要約を出す', () => {
    for (const heading of ['ルール名', '状態', 'どんなときに動くか', '何を返すか', '今月の応答', '操作']) {
      expect(LIST).toContain(`>${heading}</th>`)
    }
    expect(LIST).toContain('ruleSubtitle(r,')
    expect(LIST).toContain('table-fixed')
    expect(LIST).not.toContain('min-w-[1080px]')
  })

  it('URL編集は5段と設定内容・LINEプレビューを持つページ表示にする', () => {
    expect(EDIT_PAGE).toContain('<EditDialog')
    expect(EDIT_PAGE).toContain('page')
    for (const word of ['基本設定', 'どんなときに動くか', '何を返すか', '優先順位', '確認', 'LINEプレビュー']) {
      expect(EDITOR).toContain(word)
    }
    expect(EDITOR).not.toContain('Flex（JSONを直接書く）')
    expect(EDITOR).not.toContain('画像（JSONを直接書く）')
  })

  it('URL編集は基本設定・反応条件・返信を別々の段として開ける', () => {
    expect(EDIT_PAGE).toContain("requestedStep === 'trigger' || requestedStep === 'response'")
    expect(EDIT_PAGE).toContain('step={step}')
    expect(EDIT_PAGE).toContain('onStepChange={(nextStep) =>')
    for (const node of ['K7vg2', 'nzWIX', 'ivDoe']) expect(EDITOR).toContain(node)
    expect(EDITOR).toContain("step === 'basic'")
    expect(EDITOR).toContain("step === 'trigger'")
    expect(EDITOR).toContain("step === 'response'")
  })

  it('4画面を版管理・実行集計・競合集計の実APIへ接続する', () => {
    expect(LIST).toContain('actionExecutionCount')
    expect(LIST).toContain('api.autoReplies.summary(selectedAccountId)')
    expect(LIST).toContain('summaryRes.data.conflictCount')
    expect(EDIT_PAGE).toContain('api.autoReplies.getDraft(id)')
    expect(EDIT_PAGE).toContain('api.autoReplies.conflicts(id)')
    expect(EDIT_PAGE).toContain('toVersionDraft(draftRes.data')
    for (const field of ['internalMemo', 'replyDelaySeconds', 'unmatchedAction', 'expectedVersion']) {
      expect(EDITOR).toContain(field)
    }
    expect(EDITOR).toContain('api.autoReplies.saveDraft(draft.id')
    expect(EDITOR).not.toContain('現在のAPIは遅延秒数を保存しません。')
    expect(EDITOR).not.toContain('現在のAPIは未一致時の別返信を保存しません。')
  })

  it('競合画面は現在のルールを含む優先順位と判定例・監視を同時に示す', () => {
    for (const word of ['arp-priorityList', 'このルール', '判定例', '運用監視', 'ループ防止']) {
      expect(PUBLISH).toContain(word)
    }
    expect(PUBLISH).toContain('conflicts.map((conflict, index)')
    expect(PUBLISH).toContain('LINEプレビュー')
  })
})
