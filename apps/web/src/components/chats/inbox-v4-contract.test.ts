import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')
const TEMPLATE_PICKER = readFileSync(join(HERE, 'template-picker.tsx'), 'utf8')
const EMAIL_THREAD = readFileSync(join(HERE, '..', 'support', 'email-thread.tsx'), 'utf8')
const WORKER_CHATS = readFileSync(
  join(HERE, '..', '..', '..', '..', 'worker', 'src', 'routes', 'chats.ts'),
  'utf8',
)
const WORKER_EMAIL = readFileSync(
  join(HERE, '..', '..', '..', '..', 'worker', 'src', 'routes', 'support-inbox.ts'),
  'utf8',
)

describe('受信箱V4で既存機能を失わない', () => {
  it('担当者別既読をLINEとメールの両方に残す', () => {
    expect(PAGE).toContain('api.chats.markRead(chatId)')
    expect(PAGE).toContain('/api/support/email/threads/${encodeURIComponent(item.threadId)}/read')
    expect(WORKER_CHATS).toContain("'/api/chats/:id/read'")
    expect(WORKER_EMAIL).toContain("'/api/support/email/threads/:id/read'")
  })

  it('返信・担当・対応状態・メモの経路を残す', () => {
    expect(PAGE).toContain('api.chats.send(sendingChatId')
    expect(PAGE).toContain('handleOperatorUpdate')
    expect(PAGE).toContain('handleStatusUpdate')
    expect(EMAIL_THREAD).toContain('/reply`')
    expect(EMAIL_THREAD).toContain('/assignee`')
    expect(EMAIL_THREAD).toContain('/notes`')
  })

  it('テンプレートは選択だけでは送信せず入力欄へ挿入する', () => {
    expect(TEMPLATE_PICKER).toContain('入力欄へ挿入')
    expect(TEMPLATE_PICKER).toContain('すべてのフォルダ')
    expect(PAGE).toContain('setMessageContent')
  })
})

describe('受信箱V4の画面契約', () => {
  it('承認済みV4の主要領域を持つ', () => {
    for (const marker of [
      'data-inbox-v4="summary"',
      'data-inbox-v4="quick-filters"',
      'data-inbox-v4="conversation-list"',
      'data-inbox-v4="talk-pane"',
      'data-inbox-v4="customer-panel"',
      'data-inbox-v4="composer"',
    ]) {
      expect(PAGE).toContain(marker)
    }
  })

  it('V4の検索・チャネル・表示切替を持つ', () => {
    expect(PAGE).toContain('名前・メールアドレス・内容で検索')
    expect(PAGE).toContain('顧客情報を閉じる')
    expect(PAGE).toContain('顧客情報を表示')
    expect(PAGE).toContain('新しい順')
  })
})
