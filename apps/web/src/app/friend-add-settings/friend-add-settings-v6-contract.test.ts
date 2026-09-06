import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const LIST_PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const EDITOR = fs.readFileSync(path.join(__dirname, 'friend-add-rule-editor.tsx'), 'utf8')
const API = fs.readFileSync(path.join(__dirname, '../../lib/api.ts'), 'utf8')

describe('V6 友だち追加時配信 7画面の契約', () => {
  it('一覧・5段編集・削除確認を実ノードIDへ対応させる', () => {
    expect(LIST_PAGE).toContain('data-design-node="uLQQc"')
    expect(LIST_PAGE).toContain('designNode="Q3qP1r"')
    for (const node of ['s9gAx', 'W1wzCa', 'K0Dbr2', 'txMO9', 'U3SI5']) {
      expect(EDITOR).toContain(`node: '${node}'`)
    }
    expect(EDITOR).toContain('data-design-node="txMO9"')
  })

  it('一覧から新規作成と編集へ遷移できる', () => {
    expect(LIST_PAGE).toContain('href="/friend-add-settings?view=new"')
    expect(LIST_PAGE).toContain('href={`/friend-add-settings?view=edit&id=${encodeURIComponent(rule.id)}`}')
    expect(LIST_PAGE).toContain("if (view === 'new') return <FriendAddRuleEditor />")
    expect(LIST_PAGE).toContain("if (view === 'edit') return <FriendAddRuleEditor ruleId={searchParams.get('id') ?? undefined} />")
  })

  it('モック固定値ではなく友だち追加時配信APIで読み書きする', () => {
    expect(LIST_PAGE).toContain('api.friendAddRules.list(selectedAccountId, kind)')
    expect(LIST_PAGE).toContain('api.friendAddRules.archive(selectedAccountId, deleting.id)')
    expect(EDITOR).toContain('api.friendAddRules.createDraft(payload, saveIdempotencyKey.current)')
    expect(EDITOR).toContain('api.friendAddRules.saveDraft(ruleId, payload, saveIdempotencyKey.current)')
    expect(EDITOR).toContain('api.friendAddRules.test(selectedAccountId, activeId)')
    expect(API).toContain("'/api/friend-add-rules/drafts'")
    expect(API).toContain("'/api/friend-add-rules/test'")
    expect(API).toContain('JSON.stringify({ accountId, ruleId })')
  })

  it('読込中・空・失敗と再読込を用意する', () => {
    expect(LIST_PAGE).toContain('友だち追加時の配信を読み込んでいます')
    expect(LIST_PAGE).toContain('友だち追加時の配信がまだありません')
    expect(LIST_PAGE).toContain('友だち追加時の配信を表示できませんでした')
    expect(LIST_PAGE).toContain('onRetry={() => void load()}')
    expect(EDITOR).toContain('設定を読み込んでいます')
    expect(EDITOR).toContain('設定を表示できませんでした')
  })

  it('未接続の見せかけアクションを選択肢に出さない', () => {
    expect(EDITOR).toContain("value: 'add_tag'")
    expect(EDITOR).toContain("value: 'remove_tag'")
    expect(EDITOR).toContain("value: 'start_scenario'")
    expect(EDITOR).not.toContain("value: 'send_message'")
    expect(EDITOR).not.toContain("value: 'send_webhook'")
  })

  it('テストが本番データを変更しないことを運用者へ伝える', () => {
    expect(EDITOR).toContain('stateChanged: false')
    expect(EDITOR).toContain('テストは本番の登録、送信、タグ、マイル、回数を更新しません。')
    expect(EDITOR).toContain('本番の登録・送信・タグ・マイルは変更していません。')
  })
})

describe('V6 友だち追加時配信の運用者向け表示', () => {
  it('初回と再追加を分け、経路不明の扱いを説明する', () => {
    expect(LIST_PAGE).toContain('はじめて友だち追加した人')
    expect(LIST_PAGE).toContain('以前からの友だち・ブロック解除した人')
    expect(LIST_PAGE).toContain('経路が分からなかった人')
    expect(LIST_PAGE).toContain('いちばん最後に動く・消せない')
  })

  it('画面にDB名やマイグレーション番号を出さない', () => {
    const screens = `${LIST_PAGE}\n${EDITOR}`
    expect(screens).not.toContain('friend_add_rules')
    expect(screens).not.toContain('definition_snapshot')
    expect(screens).not.toMatch(/マイグレーション\s*\d+/)
  })
})
