import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildSupportEmailInboxQuery } from '@/v8/inbox-chat/support-email-query'

/*
 * 受信箱V4で**戻してはいけない形**を文字で見張る。
 * 既読・送信・担当・対応状況・メモ・テンプレート・見出し・顧客情報の読み先は
 * inbox-v4-react.test.tsx と app/chats/*-react.test.tsx が本物の画面で見る。
 * メールの担当・未読・待ち時間の絞り込みは Worker の inbox-server-filters.test.ts が実 HTTP で見る。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')
const TEMPLATE_PICKER = readFileSync(join(HERE, 'template-picker.tsx'), 'utf8')
const EMAIL_THREAD = readFileSync(join(HERE, '..', 'support', 'email-thread.tsx'), 'utf8')
const VISUAL_QA_MOCK = readFileSync(
  join(HERE, '..', '..', '..', '..', '..', 'scripts', 'visual-qa', 'mock-api.mjs'),
  'utf8',
)

function region(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  expect(from, start).toBeGreaterThanOrEqual(0)
  const to = source.indexOf(end, from + start.length)
  expect(to, end).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('受信箱V4で既存機能を失わない', () => {
  it('テンプレートは選択だけでは送信しない', () => {
    expect(TEMPLATE_PICKER).not.toContain('api.chats.send(')
  })
})

describe('受信箱V4の画面契約', () => {
  it('一括確認を画面に出さない', () => {
    expect(PAGE).not.toContain('すべて確認済みにする')
  })

  it('メールの内部メモの窓に自前の閉じるボタンを足さない', () => {
    expect(EMAIL_THREAD).not.toContain('>閉じる</button>')
  })

  it('自分担当チップを戻さず、メールの絞り込みは担当・未読・要返信をそのまま口へ渡す', () => {
    expect(PAGE).not.toContain("{ key: 'mine' as const, label: '自分担当' }")
    for (const assignee of ['staff-1', 'unassigned']) {
      for (const quickFilter of ['reply', 'overdue'] as const) {
        const query = new URLSearchParams(buildSupportEmailInboxQuery({ status: 'all', assignee, unreadOnly: true, quickFilter }))
        expect(query.get('assignee')).toBe(assignee)
        expect(query.get('unreadOnly')).toBe('1')
        expect(query.get('quickFilter')).toBe(quickFilter)
      }
    }
  })

  it('取得済みの200件を担当・未読・待ち時間で再び絞り込まない', () => {
    // 表示内容や既読印は残し、行の選別部分だけを検査する。印が欠けても失敗する。
    const emailFilters = region(PAGE, 'const mailRows =', '.map((item) =>')
    const lineFilters = region(PAGE, 'const lineRows =', '.map((chat) =>')
    for (const filters of [emailFilters, lineFilters]) {
      expect(filters).not.toMatch(/assigneeFilter|assignedStaffId|operatorId|unreadOnly|isUnread|quickFilter|isOlderThanOneHour/)
    }
  })

  it('トーク見出しに本名・注目・代替アバターを出す', () => {
    /*
      画面確認の偽 API の注目の印。本名は inbox-chat-detail-mock.test.ts が偽 API を立てて見るが、
      注目付きの会話が画面確認の固定データに無いので、注目だけはここで文字のまま見る。
    */
    expect(VISUAL_QA_MOCK).toContain("isAttention: friend?.metadata?.__attention === '1'")
  })

  it('会話を切り替えた後の詳細の失敗を、内部の文のまま出さない', () => {
    expect(PAGE).not.toContain('チャット詳細の読み込みに失敗しました:')
  })
})
