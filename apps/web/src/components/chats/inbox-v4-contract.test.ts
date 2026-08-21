import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')
const TEMPLATE_PICKER = readFileSync(join(HERE, 'template-picker.tsx'), 'utf8')
const FRIEND_INFO = readFileSync(join(HERE, 'friend-info-sidebar.tsx'), 'utf8')
const INBOX_KPIS = readFileSync(join(HERE, 'inbox-kpis.tsx'), 'utf8')
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
    expect(PAGE).toContain('/notes`')
  })

  it('テンプレートは選択だけでは送信せず入力欄へ挿入する', () => {
    expect(TEMPLATE_PICKER).toContain('入力欄へ挿入')
    expect(TEMPLATE_PICKER).toContain('すべてのフォルダ')
    expect(TEMPLATE_PICKER).toContain('送信内容のプレビュー')
    expect(PAGE).toContain('setMessageContent')
    expect(TEMPLATE_PICKER).toContain('createPortal')
    expect(TEMPLATE_PICKER).toContain('z-[100]')
  })

  it('カード影は右1px・下1pxに統一する', () => {
    expect(PAGE).toContain('shadow-[1px_1px_2px_rgba(29,29,31,0.13)]')
    expect(TEMPLATE_PICKER).toContain('shadow-[1px_1px_2px_rgba(29,29,31,0.13)]')
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
    expect(PAGE).toContain('顧客情報を開く')
    expect(PAGE).toContain('aria-label="顧客情報を閉じる"')
    expect(PAGE).not.toContain("showFriendInfo ? '顧客情報を閉じる'")
    expect(EMAIL_THREAD).toContain('顧客情報を開く')
    expect(PAGE).toContain('新しい順')
  })

  it('メール表示と並び順の形をLINEにそろえる', () => {
    expect(PAGE).toContain('MAIL')
    expect(PAGE).toContain('aria-label="並び順"')
    expect(PAGE).toContain('shrink-0 items-center')
    expect(PAGE).toContain('whitespace-nowrap')
    expect(PAGE).not.toContain('新しい順⌄')
  })

  it('一括確認を画面に出さず、送信元と担当者を分けて表示する', () => {
    expect(PAGE).not.toContain('すべて確認済みにする')
    expect(PAGE).toContain('selectedAccount?.pictureUrl')
    expect(PAGE).toContain("msg.sentByStaffName ?? '担当者'")
  })

  it('内部メモは送信欄と分けたダイアログで編集できる', () => {
    expect(PAGE).toContain('handleSaveMemo')
    expect(PAGE).toContain('createPortal(')
    expect(PAGE).toContain('aria-labelledby="chat-internal-memo-title"')
    expect(PAGE).toContain('担当者だけに表示され、相手には送信されません。')
  })

  it('顧客情報の操作と情報順をV4へそろえる', () => {
    expect(FRIEND_INFO).toContain('whitespace-nowrap')
    expect(FRIEND_INFO).toContain("{ key: 'names', label: '基本情報' }")
    expect(FRIEND_INFO.indexOf("{ key: 'mileage', label: 'マイル' }")).toBeGreaterThan(
      FRIEND_INFO.indexOf("{ key: 'forms', label: 'フォーム回答' }"),
    )
    expect(FRIEND_INFO).toContain('chat.friendInfoSections.v4')
  })

  it('会話IDではなく友だちIDで顧客情報を読み込み、集計欠損でも画面を止めない', () => {
    expect(PAGE).toContain('const activeFriendId = selectedFriendId')
    expect(PAGE).toContain('chatDetail.friendId')
    expect(PAGE).toContain('friendId={activeFriendId}')
    expect(INBOX_KPIS).toContain('stats?.todayByChannel?.email')
  })
})
