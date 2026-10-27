/*
 * 受信箱管理画面・機能2（`xGLVe` `H3lAOB` `Xi4x9` `B7CER8`）。
 *
 * 一覧の日付・待ち時間は関数を呼んで見る。見出しの顧客情報ボタン・ドロワー・絞り込みパネルは
 * inbox-feature2-react.test.tsx、内部メモは inbox-v4-react.test.tsx と
 * app/chats/memo-popover-focus-react.test.tsx が描いて見る。
 * ここに文字で残すのは、**戻してはいけない形**の見張りだけ。
 */
import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formatRelative } from '@/lib/format'
import { formatWaitingDuration } from '@/v8/inbox-chat/inbox-model'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')
const HEAD = readFileSync(join(HERE, '../shared/inbox-conversation-head.tsx'), 'utf8')
const SIDEBAR = readFileSync(join(HERE, 'friend-info-sidebar.tsx'), 'utf8')
const INBOX_FILTER = readFileSync(join(HERE, 'inbox-filter-panel.tsx'), 'utf8')

/**
 * `start` から `end` までを切り出す。**印が無ければ落とす。**
 * 印を消したまま試験が通ると、何も見ていない試験になる。
 */
function region(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`区間の始まりが見つかりません: ${start}`)
  const to = source.indexOf(end, from + start.length)
  if (to < 0) throw new Error(`区間の終わりが見つかりません: ${end}`)
  return source.slice(from, to)
}

describe('xGLVe 一覧の行（日付・待ち時間・担当）', () => {
  const now = Date.parse('2026-10-01T12:00:00.000Z')
  const before = (minutes: number) => new Date(now - minutes * 60_000).toISOString()

  it('取れない日時は空欄や Invalid Date ではなく — を出す', () => {
    expect(formatRelative(null)).toBe('—')
    expect(formatRelative('invalid')).toBe('—')
    expect(formatWaitingDuration(null, now)).toBeNull()
    expect(formatWaitingDuration('invalid', now)).toBeNull()
  })

  it('待ち時間は分・時間で出し、負の値は出さない', () => {
    expect(formatWaitingDuration(before(-5), now)).toBeNull()
    expect(formatWaitingDuration(before(0), now)).toBe('1分未満')
    expect(formatWaitingDuration(before(45), now)).toBe('45分')
    expect(formatWaitingDuration(before(72), now)).toBe('1時間12分')
    expect(formatWaitingDuration(before(180), now)).toBe('3時間0分')
  })
})

describe('H3lAOB / LAY-01 顧客情報の出し方で戻さない形', () => {
  it('「閉じているときだけ出す」ボタンへ戻さない', () => {
    expect(PAGE + HEAD).not.toContain('{!showFriendInfo && (')
  })

  it('顧客情報を `hidden xl:block` で常時非表示にしない（1280px未満で開く手段が無かった）', () => {
    expect(region(PAGE, '<InboxSummaryPane', '</InboxSummaryPane>')).not.toContain('hidden xl:block')
  })
})

describe('LAY-03 / LAY-04 パネルの置き方で戻さない形', () => {
  it('右パネルの表示項目を固定座標 top:430 に置かない', () => {
    expect(SIDEBAR).not.toContain('top: 430')
  })

  it('絞り込みパネルの主操作を、押すまで反映されないと読める「この条件で絞り込む」へ戻さない', () => {
    expect(region(INBOX_FILTER, '<footer', '</footer>')).not.toContain('この条件で絞り込む')
  })
})
