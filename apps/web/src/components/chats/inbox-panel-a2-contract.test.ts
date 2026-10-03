import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIDEBAR = readFileSync(join(HERE, 'friend-info-sidebar.tsx'), 'utf8')
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('受信箱A-2 右パネルでその場で直す', () => {
  it('対応状況は3つのボタンで1タップ（未対応・対応中・対応済み）', () => {
    expect(SIDEBAR).toContain('unread')
    expect(SIDEBAR).toContain('in_progress')
    expect(SIDEBAR).toContain('resolved')
    expect(SIDEBAR).toContain('対応状況を変える')
    expect(SIDEBAR).toContain('saveChatStatus')
  })

  it('担当は選ぶ欄、タグは×で外す・＋で探して付ける・↑↓Enter・新規作成', () => {
    expect(SIDEBAR).toContain('inbox-panel-assignee')
    expect(SIDEBAR).toContain('を外す')
    expect(SIDEBAR).toContain('探して付ける')
    expect(SIDEBAR).toContain('ArrowDown')
    expect(SIDEBAR).toContain('ArrowUp')
    expect(SIDEBAR).toContain('api.tags.create')
  })

  it('メモは書くのをやめて1秒で自動保存', () => {
    expect(SIDEBAR).toContain('inbox-panel-memo')
    expect(SIDEBAR).toContain('1000')
    expect(SIDEBAR).toContain('queueMemoSave')
  })

  it('友だち情報は押すとその場で書き換え（InlineEdit）', () => {
    expect(SIDEBAR).toContain('InlineEdit')
    expect(SIDEBAR).toContain('api.friends.updateMetadata')
  })

  it('購入は直近3件と合計、無いときは0にしない', () => {
    expect(SIDEBAR).toContain('購入')
    expect(SIDEBAR).toContain('合計')
    expect(SIDEBAR).toContain('slice(0, 3)')
  })

  it('押した瞬間に変えて裏で保存（runOptimistic）、失敗は戻して「もう一度」', () => {
    expect(SIDEBAR).toContain('runOptimistic')
    expect(SIDEBAR).toContain('revert')
    expect(SIDEBAR).toContain('failureMessage')
  })

  it('キーボード T・M・S（書く欄では効かない）', () => {
    expect(SIDEBAR).toContain("'t'")
    expect(SIDEBAR).toContain("'m'")
    expect(SIDEBAR).toContain("'s'")
    expect(SIDEBAR).toContain('isContentEditable')
  })

  it('右パネルは340幅、狭い幅では畳んで頭のボタンで出す', () => {
    expect(PAGE).toContain('w-[340px]')
    expect(PAGE).toContain('customer-info-toggle')
  })

  it('前払いのみの印は顔の下（友だち詳細と同じ置き場所）', () => {
    expect(SIDEBAR).toContain('PrepayBadgeV8')
    expect(SIDEBAR).toContain('accountId')
    expect(SIDEBAR).toContain('canClearPrepay')
    expect(PAGE).toContain('accountId={selectedAccountId')
  })

  it('前払い判定の口がAPIにある', () => {
    expect(API).toContain('getFriendNoshow')
    expect(API).toContain('setFriendPrepay')
    expect(API).toContain('BookingPrepayDecision')
  })
})
