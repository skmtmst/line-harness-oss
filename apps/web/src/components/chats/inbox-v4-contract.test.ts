import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')
const TEMPLATE_PICKER = readFileSync(join(HERE, 'template-picker.tsx'), 'utf8')
const FRIEND_INFO = readFileSync(join(HERE, 'friend-info-sidebar.tsx'), 'utf8')
const INBOX_KPIS = readFileSync(join(HERE, 'inbox-kpis.tsx'), 'utf8')
const INBOX_DROPDOWN = readFileSync(join(HERE, 'inbox-dropdown.tsx'), 'utf8')
const EMAIL_THREAD = readFileSync(join(HERE, '..', 'support', 'email-thread.tsx'), 'utf8')
const WORKER_CHATS = readFileSync(
  join(HERE, '..', '..', '..', '..', 'worker', 'src', 'routes', 'chats.ts'),
  'utf8',
)
const WORKER_EMAIL = readFileSync(
  join(HERE, '..', '..', '..', '..', 'worker', 'src', 'routes', 'support-inbox.ts'),
  'utf8',
)
const VISUAL_QA_MOCK = readFileSync(
  join(HERE, '..', '..', '..', '..', '..', 'scripts', 'visual-qa', 'mock-api.mjs'),
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
    expect(PAGE + EMAIL_THREAD).toContain('/notes`')
  })

  it('テンプレートは選択だけでは送信せず入力欄へ挿入する', () => {
    expect(TEMPLATE_PICKER).toContain('入力欄へ挿入')
    expect(TEMPLATE_PICKER).toContain('TemplateFolderSelect')
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
  it('V6共通トップバーと重なる本文タイトル・マニュアルを置かない', () => {
    expect(PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(PAGE).not.toContain('<Header title="受信箱"')
    expect(PAGE).not.toContain('<Button href="/support">マニュアル</Button>')
  })

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
    // 設計 `H3lAOB`：開閉は同じ場所の1つのボタン。閉じる口が右パネルの中だけ
    // だと、閉じたあと戻す口を別の場所で探すことになる。
    expect(PAGE).toContain("showFriendInfo ? '顧客情報を閉じる' : '顧客情報を表示'")
    expect(PAGE).toContain('aria-label="顧客情報を閉じる"')
    expect(EMAIL_THREAD).toContain('顧客情報を開く')
    expect(PAGE).toContain('新しい順')
  })

  it('メール表示と並び順の形をLINEにそろえる', () => {
    expect(PAGE).toContain('MAIL')
    expect(PAGE).toContain('aria-label={item.label}')
    expect(PAGE).toContain("{item.key === 'all' && item.label}")
    expect(PAGE).not.toContain('{item.label}\n                </button>')
    expect(PAGE).toContain('aria-label="並び順"')
    expect(PAGE).toContain('shrink-0 items-center')
    expect(PAGE).toContain('whitespace-nowrap')
    expect(PAGE).not.toContain('新しい順⌄')
  })

  it('見出しと会話まわりの余分な高さを詰める', () => {
    expect(PAGE).not.toContain('返信が必要な会話を見つけ、担当・期限・顧客情報を見ながら対応できます。')
    expect(FRIEND_INFO).not.toContain('対応に必要な情報をまとめて確認できます')
    expect(FRIEND_INFO).toContain('inline-flex h-8 shrink-0 items-center justify-center')
    expect(PAGE).toContain("isOutgoing ? 'items-end justify-end' : 'items-start justify-start'")
    expect(PAGE).toContain('flex w-24 shrink-0 flex-col items-center')
  })

  it('一括確認を画面に出さず、送信元と担当者を分けて表示する', () => {
    expect(PAGE).not.toContain('すべて確認済みにする')
    expect(PAGE).toContain('selectedAccount?.pictureUrl')
    expect(PAGE).toContain("msg.sentByStaffName ?? '担当者'")
  })

  it('担当変更では、絞り込み用の「すべて」を担当者として送らない', () => {
    /*
      「すべて」は**一覧を絞るための行**で、担当者ではない。
      担当を変える口に出したままだと、押せば「すべて」という人へ
      割り当てようとする。設計 `L35UOV`（2-9）も 河野・菅野・未割り当て の
      3つだけで、「すべて」を置いていない。
    */
    expect(PAGE).toContain('allowAll={false}')
    expect(PAGE).toContain("if (next === 'all') return")
  })

  it('内部メモは送信欄と分けて編集でき、保存の口を残す', () => {
    // 設計 `B7CER8` で画面を覆う窓から「内部メモ」ボタンの上に出る紙へ移した。
    // 覆う窓のままだと、直前のやり取りを見ながら書けない。
    expect(PAGE).toContain('handleSaveMemo')
    expect(PAGE).toContain('aria-labelledby="chat-internal-memo-title"')
    expect(EMAIL_THREAD).toContain('createPortal(')
    expect(EMAIL_THREAD).toContain('aria-labelledby="email-internal-memo-title"')
    expect(EMAIL_THREAD).toContain('/notes`')
    expect(EMAIL_THREAD).toContain('担当者だけに表示され、相手には送信されません。')
    expect(EMAIL_THREAD).not.toContain('>閉じる</button>')
  })

  it('自分担当チップを外し、担当者プルダウンでLINEとメールを絞る', () => {
    expect(PAGE).not.toContain("{ key: 'mine' as const, label: '自分担当' }")
    expect(PAGE).toContain('ariaLabel="担当者で絞り込む"')
    expect(PAGE).toContain("assigneeFilter === 'unassigned'")
    expect(PAGE).toContain('item.assignedStaffId === assigneeFilter')
    expect(PAGE).toContain('chat.operatorId !== assigneeFilter')
  })

  it('担当と対応をV6専用プルダウンで操作し、開状態も確認できる', () => {
    expect(PAGE).toContain('import { OperatorDropdown, StatusDropdown')
    expect(PAGE).toContain('ariaLabel="担当者を変える"')
    expect(PAGE).toContain('ariaLabel="対応状況を変える"')
    expect(INBOX_DROPDOWN).toContain('role="listbox"')
    expect(INBOX_DROPDOWN).toContain('担当者名を検索')
  })

  it('トーク見出しに本名・注目・代替アバターを出す', () => {
    expect(PAGE).toContain('chatDetail.friendRealName')
    expect(PAGE).toContain('chatDetail.isAttention')
    expect(PAGE).toContain('handleAttentionUpdate')
    expect(PAGE).toContain("__attention: next ? '1' : null")
    expect(WORKER_CHATS).toContain('friendRealName: friend?.real_name || null')
    expect(WORKER_CHATS).toContain("isAttention: friendMetadata.__attention === '1'")
    expect(VISUAL_QA_MOCK).toContain('friendRealName: friend?.realName ?? null')
    expect(VISUAL_QA_MOCK).toContain("isAttention: friend?.metadata?.__attention === '1'")
  })

  it('会話を切り替えた後に古い詳細応答を表示・操作へ使わない', () => {
    expect(PAGE).toContain('const detailRequestIdRef = useRef(0)')
    expect(PAGE).toContain('requestId !== detailRequestIdRef.current')
    expect(PAGE).toContain('detailRequestIdRef.current += 1')
    expect(PAGE).toContain('detailAccountRef.current === selectedAccountId')
    expect(PAGE).toContain('setSelectedChatId(null)')
    expect(PAGE).toContain('current?.id === updatingChatId')
    expect(PAGE).toContain('if (!chatDetail || attentionSaving) return')
    expect(PAGE).not.toContain('チャット詳細の読み込みに失敗しました:')
  })

  it('シナリオ開始の札と時刻を分ける', () => {
    expect(PAGE).toContain('<Link2 aria-hidden="true"')
    expect(PAGE).toContain('<time className="text-micro text-ink-faint">{startedAt}</time>')
  })

  it('狭い画面でも対応状況の見出しを1行で表示する', () => {
    expect(INBOX_KPIS).toContain('whitespace-nowrap text-[11px] font-semibold')
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
