'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { parseStickerMessageContent, stickerFallback } from '@line-crm/shared'
import { api, fetchApi } from '@/lib/api'
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import TemplatePicker from '@/components/chats/template-picker'
import InboxKpis from '@/components/chats/inbox-kpis'
import FlexPreviewComponent from '@/components/flex-preview'
import FriendInfoSidebar from '@/components/chats/friend-info-sidebar'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ImageUploader, { type ImageUploaderValue } from '@/components/shared/image-uploader'
import { Suspense } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import EmailThread from '@/components/support/email-thread'

interface Chat {
  id: string
  friendId: string
  friendName: string
  friendPictureUrl: string | null
  operatorId: string | null
  status: 'unread' | 'in_progress' | 'resolved'
  notes: string | null
  lastMessageAt: string | null
  lastMessageContent: string | null
  lastMessageDirection: 'incoming' | 'outgoing' | null
  lastMessageType: string | null
  /** ログイン中の担当者だけの未読。対応状態とは別。 */
  isUnread: boolean
  createdAt: string
  updatedAt: string
}

interface ChatMessage {
  id: string
  direction: 'incoming' | 'outgoing'
  messageType: string
  content: string
  source?: string | null
  originKind?: string | null
  sentByStaffId?: string | null
  sentByStaffName?: string | null
  scenarioName?: string | null
  createdAt: string
}

interface ChatDetail extends Chat {
  friendName: string
  friendPictureUrl: string | null
  messages?: ChatMessage[]
}

type StatusFilter = 'all' | 'unread' | 'in_progress' | 'resolved'

/** 受信箱に混ぜるメールの1件（/api/support/inbox の email ぶん）。 */
interface EmailInboxItem {
  id: string
  threadId: string
  customerName: string
  /** 相手のメールアドレス。友だちを手で探すときの手がかりになる。 */
  customerIdentifier?: string
  subject: string
  preview: string
  status: 'unread' | 'in_progress' | 'resolved'
  assignedStaffId?: string | null
  assignedStaffName?: string | null
  lastIncomingAt: string
  isUnread: boolean
}

function EmailCustomerMemo({ threadId }: { threadId: string }) {
  const [notes, setNotes] = useState('')
  const [savedNotes, setSavedNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')
    void fetchApi<{
      success: boolean
      data: { thread: { notes: string | null } }
    }>(`/api/support/email/threads/${encodeURIComponent(threadId)}`)
      .then((response) => {
        if (cancelled || !response.success) return
        const value = response.data.thread.notes ?? ''
        setNotes(value)
        setSavedNotes(value)
      })
      .catch(() => {
        if (!cancelled) setError('内部メモを読み込めませんでした')
      })
    return () => { cancelled = true }
  }, [threadId])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const response = await fetchApi<{ success: boolean; error?: string }>(
        `/api/support/email/threads/${encodeURIComponent(threadId)}/notes`,
        { method: 'PATCH', body: JSON.stringify({ notes }) },
      )
      if (!response.success) {
        setError(response.error || '内部メモを保存できませんでした')
        return
      }
      setSavedNotes(notes)
    } catch {
      setError('内部メモを保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-5 border-t border-[#E5E7EB] pt-4" aria-label="メール相手の内部メモ">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-[#344054]">内部メモ</h3>
        {notes === savedNotes && <span className="text-[10px] text-[#98A2B3]">保存済み</span>}
      </div>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={5}
        placeholder="担当者だけに見えるメモ"
        className="mt-2 w-full resize-y rounded-lg border border-[#D0D5DD] bg-canvas px-3 py-2 text-xs leading-5 outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/15"
      />
      {error && <p className="mt-1 text-xs text-[#D92D20]">{error}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || notes === savedNotes}
        className="mt-2 w-full rounded-lg bg-[#06C755] px-3 py-2 text-xs font-semibold text-on-accent hover:bg-[#05B94F] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? '保存中...' : '内部メモを保存'}
      </button>
    </section>
  )
}

const statusConfig: Record<Chat['status'], { label: string; className: string }> = {
  unread: { label: '未対応', className: 'bg-danger-bg text-danger' },
  in_progress: { label: '対応中', className: 'bg-warning-bg text-warning' },
  resolved: { label: '対応済', className: 'bg-success-bg text-success' },
}

const statusFilters: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全て' },
  { key: 'unread', label: '未対応' },
  { key: 'in_progress', label: '対応中' },
  { key: 'resolved', label: '対応済' },
]

function ChannelBadge({ channel }: { channel: 'line' | 'email' }) {
  return channel === 'line' ? (
    <span className="bg-accent text-on-accent inline-flex h-5 min-w-8 items-center justify-center rounded-md px-1.5 text-[9px] font-bold">
      LINE
    </span>
  ) : (
    <span className="bg-canvas-sunken text-ink-secondary border-hairline inline-flex h-5 w-5 items-center justify-center rounded-md border text-[10px] font-bold">
      M
    </span>
  )
}

// 一覧の1ページ件数。worker 側 /api/chats のデフォルト LIMIT と揃える。
const CHAT_PAGE_SIZE = 300

function StickerMessageImage({ content }: { content: string }) {
  const [failed, setFailed] = useState(false)
  const sticker = parseStickerMessageContent(content)
  const fallback = stickerFallback(content)

  if (!sticker || failed) return <span>{fallback}</span>

  return (
    <img
      src={sticker.stickerUrl}
      alt={fallback}
      className="max-h-[140px] max-w-[140px] object-contain"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function formatDatetime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function sameYmd(aIso: string, bIso: string): boolean {
  const a = new Date(aIso)
  const b = new Date(bIso)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatYmdSlash(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function isOlderThanOneHour(iso: string | null): boolean {
  if (!iso) return false
  const time = new Date(iso).getTime()
  return Number.isFinite(time) && Date.now() - time >= 60 * 60 * 1000
}

interface FriendItem {
  id: string
  displayName: string
  pictureUrl: string | null
  isFollowing: boolean
}

interface MessageLog {
  id: string
  direction: 'incoming' | 'outgoing'
  messageType: string
  content: string
  createdAt: string
}

function DirectMessagePanel({ friendId, friend, onBack, onSent }: {
  friendId: string
  friend: FriendItem | null
  onBack: () => void
  onSent: () => void
}) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<MessageLog[]>([])
  const [loadingMessages, setLoadingMessages] = useState(true)
  const isComposingRef = useRef(false)
  const sendLockRef = useRef(false)

  useEffect(() => {
    const loadMessages = async () => {
      setLoadingMessages(true)
      try {
        const res = await fetchApi<{ success: boolean; data: MessageLog[] }>(
          `/api/friends/${friendId}/messages`
        )
        if (res.success) setMessages(res.data)
      } catch { /* silent */ }
      setLoadingMessages(false)
    }
    loadMessages()
  }, [friendId])

  const handleSend = async () => {
    if (!message.trim() || sending || sendLockRef.current) return
    sendLockRef.current = true
    setSending(true)
    try {
      await fetchApi(`/api/friends/${friendId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: message, messageType: 'text' }),
      })
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        direction: 'outgoing',
        messageType: 'text',
        content: message,
        createdAt: new Date().toISOString(),
      }])
      setMessage('')
    } catch { /* silent */ }
    setSending(false)
    sendLockRef.current = false
  }

  function renderContent(msg: MessageLog) {
    if (msg.messageType === 'text') return msg.content
    if (msg.messageType === 'flex') {
      try {
        const parsed = JSON.parse(msg.content)
        // Extract ALL text from flex (up to 200 chars)
        const texts: string[] = []
        const collectText = (obj: Record<string, unknown>) => {
          if (texts.join(' ').length > 200) return
          if (obj.type === 'text' && typeof obj.text === 'string') {
            const t = (obj.text as string).trim()
            if (t && !t.startsWith('{{')) texts.push(t)
          }
          for (const key of ['header', 'body', 'footer']) {
            if (obj[key]) collectText(obj[key] as Record<string, unknown>)
          }
          if (Array.isArray(obj.contents)) {
            for (const c of obj.contents) collectText(c as Record<string, unknown>)
          }
        }
        collectText(parsed)
        return texts.slice(0, 4).join('\n') || '[Flex Message]'
      } catch { return '[Flex Message]' }
    }
    if (msg.messageType === 'sticker') {
      return <StickerMessageImage content={msg.content} />
    }
    return `[${msg.messageType}]`
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-hairline flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="友だち一覧に戻る"
          className="lg:hidden text-ink-faint hover:text-ink-secondary"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {friend?.pictureUrl ? (
          <img src={friend.pictureUrl} alt="" className="w-8 h-8 rounded-full" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-hairline flex items-center justify-center">
            <span className="text-ink-faint text-xs">{(friend?.displayName || '?').charAt(0)}</span>
          </div>
        )}
        <div>
          <p className="text-sm font-bold text-ink">{friend?.displayName || '不明'}</p>
          <p className="text-xs text-ink-faint">メッセージ履歴</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loadingMessages ? (
          <p className="text-center text-ink-faint text-sm">読み込み中...</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-ink-faint text-sm">メッセージ履歴がありません</p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                msg.direction === 'outgoing'
                  ? 'bg-accent-soft0 text-on-accent'
                  : 'bg-canvas-sunken text-ink'
              }`}>
                <div className="text-sm whitespace-pre-wrap break-words">{renderContent(msg)}</div>
                <p className={`text-xs mt-1 ${msg.direction === 'outgoing' ? 'text-success-bg' : 'text-ink-faint'}`}>
                  {new Date(msg.createdAt).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="px-4 py-3 border-t border-hairline">
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onCompositionStart={() => { isComposingRef.current = true }}
            onCompositionEnd={() => { isComposingRef.current = false }}
            onKeyDown={(e) => {
              // IME変換確定のEnterでは送信しない
              if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="メッセージを入力..."
            className="flex-1 border border-hairline rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
 className="bg-accent text-on-accent transition-colors hover:bg-accent-hover px-4 py-2 rounded-control text-sm font-medium disabled:opacity-50"
          >
            {sending ? '...' : '送信'}
          </button>
        </div>
      </div>
    </div>
  )
}

const MERGED_TABS = [
  { key: 'line', label: 'LINE' },
  { key: 'email', label: 'お問い合わせ（メール）' },
]

function ChatsPageInner({ channel }: { channel: 'all' | 'line' | 'email' }) {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [chats, setChats] = useState<Chat[]>([])
  /**
   * メールの問い合わせ。LINEのトークと同じ一覧に混ぜる。
   *
   * 設計 `V2 2-1 受信箱` の一覧は「✉ 定期便の解約について」のように
   * メールも同じ並びに入っている。出どころで場所を分けると、
   * 返信を待っている人を2か所で探すことになる。
   */
  const [emailItems, setEmailItems] = useState<EmailInboxItem[]>([])
  // 中央ペインで開いているメール。LINEのトークと排他。
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [allFriends, setAllFriends] = useState<FriendItem[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null)
  const [chatDetail, setChatDetail] = useState<ChatDetail | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [quickFilter, setQuickFilter] = useState<'all' | 'reply' | 'mine' | 'overdue'>('all')
  const [currentStaffId, setCurrentStaffId] = useState<string | null>(null)
  // 一覧が長くなると状態の絞り込みだけでは足りない（設計 `ListPane` の「名前で検索」）。
  // 送信側で絞ると、打つたびに一覧を取り直して重い。手元で絞る。
  const [nameQuery, setNameQuery] = useState('')
  // 担当の選択肢（設計 `TalkPane` の「担当」）。
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([])
  /*
   * 友だち詳細を出すか。既定は閉じる。
   *
   * トークの上に重ねて出るので、開いたままだと本文が隠れる。開くのは
   * 相手の素性を確かめたいときで、返信を書いている間ではない。
   * 見たいときに「友だち詳細」から開く。
   */
  const [showFriendInfo, setShowFriendInfo] = useState(true)
  // 送信の細かい設定。既定は畳む。出しっぱなしだと入力欄が縦に伸びて
  // トークが読めなくなる。
  const [showComposerOptions, setShowComposerOptions] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageError, setImageError] = useState('')

  /**
   * 画像を1枚選ぶ。
   *
   * **1MB まで。** LINE はプレビュー用の画像が1MBまでで、ここは元画像と
   * プレビューに同じURLを渡している。10MB と書いてあった案内は、
   * 実際には1MBで弾かれるので直した。
   */
  const handlePickImage = async (file: File) => {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setImageError('JPEG か PNG を選んでください')
      return
    }
    if (file.size > 1024 * 1024) {
      setImageError('1MB 以下にしてください')
      return
    }
    setUploadingImage(true)
    setImageError('')
    try {
      const res = await api.uploads.image(file)
      if (!res.success) {
        setImageError(res.error ?? '画像を送れませんでした')
        return
      }
      setPendingImage({
        mode: 'line-image',
        originalContentUrl: res.data.url,
        previewImageUrl: res.data.url,
      })
    } catch {
      setImageError('画像を送れませんでした')
    } finally {
      setUploadingImage(false)
    }
  }
  const statusFilterRef = useRef<StatusFilter>('all')
  // Send mode: 'enter' = Enter sends, Shift+Enter = newline; 'shift-enter' = reverse
  /*
   * 送信キーの初期値は Shift + Enter。**選び直せる。**
   *
   * Enter 単体だと、書きかけで改行しようとして送ってしまう。取り消せない
   * ものが相手へ飛ぶので、既定は事故の起きにくい方にする。
   * 一度選ぶと chat.sendMode に残り、次からはその設定が使われる。
   * メール側（email-thread.tsx）も同じ置き場・同じ既定。
   */
  const [sendMode, setSendMode] = useState<'enter' | 'shift-enter'>('shift-enter')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMoreChats, setHasMoreChats] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [messageContent, setMessageContent] = useState('')
  const [pendingImage, setPendingImage] = useState<ImageUploaderValue | null>(null)
  const [sending, setSending] = useState(false)
  const sendLockRef = useRef(false)
  const [isMessageInputFocused, setIsMessageInputFocused] = useState(false)
  const isComposingRef = useRef(false)
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ページング用カーソル。表示リストは楽観更新で並び替わるため、
  // 「サーバから最後に受け取った行」を ref で保持して次ページの起点にする
  // (offset 方式だと新着で行が押し下げられた分が欠落する)。
  const nextCursorRef = useRef<{ at: string; id: string } | null>(null)

  const buildListParams = useCallback((cursor: { at: string; id: string } | null) => {
    const params: {
      status?: string; accountId?: string;
      limit?: number; beforeAt?: string; beforeId?: string;
    } = {}
    if (statusFilter !== 'all') params.status = statusFilter
    if (selectedAccountId) params.accountId = selectedAccountId
    params.limit = CHAT_PAGE_SIZE
    if (cursor) {
      params.beforeAt = cursor.at
      params.beforeId = cursor.id
    }
    return params
  }, [statusFilter, selectedAccountId])

  /** メールの問い合わせを取る。LINEと同じ一覧に混ぜるため。 */
  const loadEmails = useCallback(async () => {
    try {
      const res = await fetchApi<{ success: boolean; data: { items: EmailInboxItem[] } }>(
        '/api/support/inbox?channel=email&status=all&limit=200',
      )
      if (res.success) setEmailItems(res.data.items)
    } catch {
      // メールが出ないだけ。LINEのトークは使える。
    }
  }, [])

  useEffect(() => {
    void loadEmails()
  }, [loadEmails])

  const loadChats = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const chatRes = await api.chats.list(buildListParams(null))
      if (chatRes.success) {
        const rows = chatRes.data as unknown as Chat[]
        setChats(rows)
        const last = rows[rows.length - 1]
        nextCursorRef.current = last?.lastMessageAt ? { at: last.lastMessageAt, id: last.id } : null
        // ページ丁度いっぱい返ってきた = 続きがある可能性が高い
        setHasMoreChats(rows.length === CHAT_PAGE_SIZE)
      }
    } catch {
      setError('チャットの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [buildListParams])

  // 「さらに読み込む」— サーバ由来カーソルの続きを取得して末尾に追加する。
  // 楽観更新との競合に備えて既存 id は除外し、重複表示を防ぐ。
  const loadMoreChats = useCallback(async () => {
    if (loadingMore) return
    const cursor = nextCursorRef.current
    if (!cursor) {
      setHasMoreChats(false)
      return
    }
    setLoadingMore(true)
    try {
      const chatRes = await api.chats.list(buildListParams(cursor))
      if (chatRes.success) {
        const rows = chatRes.data as unknown as Chat[]
        setChats((prev) => {
          const seen = new Set(prev.map((c) => c.id))
          return [...prev, ...rows.filter((r) => !seen.has(r.id))]
        })
        const last = rows[rows.length - 1]
        nextCursorRef.current = last?.lastMessageAt ? { at: last.lastMessageAt, id: last.id } : null
        setHasMoreChats(rows.length === CHAT_PAGE_SIZE)
      }
    } catch {
      setError('チャットの追加読み込みに失敗しました。')
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, buildListParams])

  // Friends list (for the "new direct message" modal) — loaded lazily in the background
  // Previously fetched 800 friends in parallel with chats, which blocked the initial render.
  const loadAllFriends = useCallback(async () => {
    try {
      const friendRes = await api.friends.list({ accountId: selectedAccountId || undefined, limit: '800' })
      if (friendRes.success) {
        setAllFriends((friendRes.data as unknown as { items: FriendItem[] }).items)
      }
    } catch { /* silent */ }
  }, [selectedAccountId])

  useEffect(() => { void loadAllFriends() }, [loadAllFriends])

  // Keep refs in sync so setChats updater can read the latest filter without stale closure
  useEffect(() => { statusFilterRef.current = statusFilter }, [statusFilter])

  // Load/save sendMode preference (guarded — privacy-restricted browsers throw)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('chat.sendMode')
      if (saved === 'enter' || saved === 'shift-enter') setSendMode(saved)
    } catch { /* localStorage unavailable */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('chat.sendMode', sendMode) } catch { /* ignore */ }
  }, [sendMode])

  const loadChatDetail = useCallback(async (chatId: string) => {
    setDetailLoading(true)
    setError('')
    try {
      const res = await api.chats.get(chatId)
      if (res.success) {
        setChatDetail(res.data as unknown as ChatDetail)
      } else {
        // API は 200 で success:false を返す可能性 (例: 404 lookup)。詳細を画面に出す。
        const errMsg = (res as { error?: string }).error ?? '不明なエラー'
        setError(`チャット詳細の読み込みに失敗しました: ${errMsg}`)
      }
    } catch (err) {
      // ネットワーク / parse / auth fail などの例外。empty catch だと原因不明だったので詳細を出す。
      const msg = err instanceof Error ? err.message : String(err)
      setError(`チャット詳細の読み込みに失敗しました: ${msg}`)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    loadChats()
  }, [loadChats])

  useEffect(() => {
    const refresh = () => {
      void loadChats()
      void loadEmails()
    }
    window.addEventListener(UNANSWERED_REFRESH_EVENT, refresh)
    return () => window.removeEventListener(UNANSWERED_REFRESH_EVENT, refresh)
  }, [loadChats, loadEmails])

  // Deep-link from other pages. LINE is ?friend=<friendId>, email is
  // ?thread=<threadId>. Selecting one side always clears the other so the
  // center panel has exactly one conversation to show.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const friendId = params.get('friend')
    const threadId = params.get('thread')
    if (threadId) {
      setSelectedChatId(null)
      setSelectedFriendId(null)
      setSelectedThreadId(threadId)
    } else if (friendId) {
      setSelectedThreadId(null)
      setSelectedChatId(friendId)
    }
  }, [])

  useEffect(() => {
    if (selectedChatId) {
      loadChatDetail(selectedChatId)
    } else {
      setChatDetail(null)
    }
  }, [selectedChatId, loadChatDetail])

  // Surface deep-linked chats in the sidebar even when the current account
  // filter or status filter would exclude them — otherwise the user replies
  // and the conversation stays invisible until they refresh.
  // Re-runs when `chats` changes (e.g. after loadChats refetches on filter
  // change) so the synthetic entry is re-injected if the next API result
  // does not include it. Returning `prev` unchanged when already present
  // avoids any update loop.
  useEffect(() => {
    if (!chatDetail) return
    setChats((prev) => {
      if (prev.some((c) => c.id === chatDetail.id)) return prev
      // /api/chats/:id may not populate the lastMessage* fields; derive
      // from the messages array as a fallback so the sidebar preview is
      // not stuck on "(まだメッセージなし)".
      const lastMsg = chatDetail.messages?.[chatDetail.messages.length - 1]
      const entry: Chat = {
        id: chatDetail.id,
        friendId: chatDetail.friendId,
        friendName: chatDetail.friendName,
        friendPictureUrl: chatDetail.friendPictureUrl,
        operatorId: chatDetail.operatorId ?? null,
        status: chatDetail.status,
        notes: chatDetail.notes ?? null,
        lastMessageAt: chatDetail.lastMessageAt ?? lastMsg?.createdAt ?? null,
        lastMessageContent: chatDetail.lastMessageContent ?? lastMsg?.content ?? null,
        lastMessageDirection: chatDetail.lastMessageDirection ?? lastMsg?.direction ?? null,
        lastMessageType: chatDetail.lastMessageType ?? lastMsg?.messageType ?? null,
        isUnread: false,
        createdAt: chatDetail.createdAt,
        updatedAt: chatDetail.updatedAt,
      }
      return [entry, ...prev]
    })
  }, [chatDetail, chats])

  // 詳細が新しくロードされたら最下部（＝最新メッセージ）までスクロールする。
  // そこから上にスクロールすれば過去のメッセージを辿れる（LINE受信画面と同じUX）。
  // ユーザーが手動でスクロールしたら delayed auto-scroll は発動させない。
  useEffect(() => {
    if (!chatDetail?.messages || chatDetail.messages.length === 0) return
    const el = messagesScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    let userScrolled = false
    const onScroll = () => {
      if (!messagesScrollRef.current) return
      const current = messagesScrollRef.current
      // 下端から一定以上離れたらユーザー操作とみなす
      if (current.scrollHeight - current.scrollTop - current.clientHeight > 20) {
        userScrolled = true
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // 画像/Flex の表示後に高さが増える場合に追従するフォロワー（ユーザーがスクロール済みなら発動させない）
    const id = window.setTimeout(() => {
      if (userScrolled || !messagesScrollRef.current) return
      messagesScrollRef.current.scrollTop = messagesScrollRef.current.scrollHeight
    }, 150)
    return () => {
      window.clearTimeout(id)
      el.removeEventListener('scroll', onScroll)
    }
  }, [chatDetail?.id, chatDetail?.messages?.length])

  // Auto-resize textarea as messageContent grows
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [messageContent])

  const handleSelectChat = (chatId: string) => {
    setSelectedChatId(chatId)
    // 既読はログイン中の担当者だけに反映する。対応状態は変えない。
    setChats((prev) => prev.map((chat) => (
      chat.id === chatId ? { ...chat, isUnread: false } : chat
    )))
    void api.chats.markRead(chatId).catch(() => {
      // 会話を開く処理は止めない。次の一覧取得で正しい未読へ戻る。
    })
    /*
     * 開いていたメールを外す。
     *
     * 右側は「メールが選ばれていたらメール」を先に見るので、ここで
     * 外さないと、LINEのトークを選んでも前のメールが出たままになる。
     * メールを一度開くと、以後どのトークも開けなくなっていた。
     * メール側は逆にLINEの選択を外していたので、片側だけ抜けていた。
     */
    setSelectedThreadId(null)
    setMessageContent('')
    setPendingImage(null)
  }

  const handleSendMessage = async () => {
    if (!selectedChatId || sending || sendLockRef.current) return
    if (!messageContent.trim() && !pendingImage) return
    const sendingChatId = selectedChatId  // capture the chat id for this send
    sendLockRef.current = true
    setSending(true)
    try {
      const now = new Date().toISOString()
      // --- Image send path (runs first when image is present) ---
      if (pendingImage && pendingImage.mode === 'line-image') {
        const imgPayload = JSON.stringify({
          originalContentUrl: pendingImage.originalContentUrl,
          previewImageUrl: pendingImage.previewImageUrl,
        })
        const sendResult = await api.chats.send(sendingChatId, { messageType: 'image', content: imgPayload })
        setPendingImage(null)
        // Optimistic update for image
        setChatDetail((prev) => (prev && prev.id === sendingChatId) ? {
          ...prev,
          lastMessageAt: now,
          status: 'in_progress',
          messages: [
            ...(prev.messages ?? []),
            {
              id: crypto.randomUUID(),
              direction: 'outgoing',
              messageType: 'image',
              content: imgPayload,
              sentByStaffName: sendResult.success ? sendResult.data.sentByStaffName : '自分',
              createdAt: now,
            },
          ],
        } : prev)
        setChats((prev) => {
          const exists = prev.some((c) => c.id === sendingChatId)
          if (!exists) return prev
          const currentFilter = statusFilterRef.current
          const updated = prev.map((c) => c.id === sendingChatId ? {
            ...c,
            lastMessageAt: now,
            status: 'in_progress' as const,
            lastMessageContent: '[画像]',
            lastMessageDirection: 'outgoing' as const,
            lastMessageType: 'image' as const,
          } : c)
          // 返信すると対応中に変わるので、別の絞り込みを見ているときは一覧から外れる
          const filtered =
            currentFilter === 'all' ? updated : updated.filter((c) => c.status === currentFilter)
          return [...filtered].sort((a, b) => {
            const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
            const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
            return bt - at
          })
        })
      }
      // --- Text send path (runs independently — both paths execute when both image and text are present) ---
      if (messageContent.trim()) {
        const content = messageContent.trim()
        const sendResult = await api.chats.send(sendingChatId, { content })
        setMessageContent('')
        // Optimistic update: append message locally instead of refetching (prevents scroll jump / full reload feel)
        // Only mutate chatDetail if it still corresponds to the chat we just sent to
        setChatDetail((prev) => (prev && prev.id === sendingChatId) ? {
          ...prev,
          lastMessageAt: now,
          status: 'in_progress',
          messages: [
            ...(prev.messages ?? []),
            {
              id: crypto.randomUUID(),
              direction: 'outgoing',
              messageType: 'text',
              content,
              sentByStaffName: sendResult.success ? sendResult.data.sentByStaffName : '自分',
              createdAt: now,
            },
          ],
        } : prev)
        setChats((prev) => {
          // Skip reconciliation if the list no longer contains this chat (e.g. tab changed mid-send)
          const exists = prev.some((c) => c.id === sendingChatId)
          if (!exists) return prev
          const currentFilter = statusFilterRef.current
          const updated = prev.map((c) => c.id === sendingChatId ? {
            ...c,
            lastMessageAt: now,
            status: 'in_progress' as const,
            // 一覧の preview も即時更新する。incoming 優先ロジックで上書きされ得るが、
            // 楽観 UI では「operator が今送った文面」が一瞬見えるのが期待動作。
            // 次回 loadChats() で server 側の真の最新 (incoming 優先) に reconcile される。
            lastMessageContent: content,
            lastMessageDirection: 'outgoing' as const,
            lastMessageType: 'text' as const,
          } : c)
          // 返信すると対応中に変わるので、別の絞り込みを見ているときは一覧から外れる
          const filtered =
            currentFilter === 'all' ? updated : updated.filter((c) => c.status === currentFilter)
          return [...filtered].sort((a, b) => {
            const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
            const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
            return bt - at
          })
        })
      }
      // 手動返信で未対応が 1 件減るので、サイドバーのバッジを即時更新させる
      window.dispatchEvent(new Event(UNANSWERED_REFRESH_EVENT))
    } catch {
      setError('メッセージの送信に失敗しました。')
    } finally {
      setSending(false)
      sendLockRef.current = false
    }
  }

  /** 担当を付け替える（設計 `TalkPane` の「担当」）。 */
  const handleOperatorUpdate = async (operatorId: string | null) => {
    if (!selectedChatId) return
    try {
      await api.chats.update(selectedChatId, { operatorId })
      loadChatDetail(selectedChatId)
      loadChats()
    } catch {
      setError('担当の更新に失敗しました。')
    }
  }

  useEffect(() => {
    let cancelled = false
    void fetchApi<{ success: boolean; data: { id?: string } }>('/api/auth/session')
      .then((res) => {
        if (!cancelled && res.success) setCurrentStaffId(res.data.id ?? null)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>(
          '/api/operators',
        )
        if (!cancelled && res.success) setOperators(res.data)
      } catch {
        // 担当を選べないだけ。返信そのものは続けられる。
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleStatusUpdate = async (newStatus: Chat['status']) => {
    if (!selectedChatId) return
    try {
      await api.chats.update(selectedChatId, { status: newStatus })
      loadChatDetail(selectedChatId)
      loadChats()
      // 対応済/未読の切替は未対応バッジに影響するので即時更新させる
      window.dispatchEvent(new Event(UNANSWERED_REFRESH_EVENT))
    } catch {
      setError('ステータスの更新に失敗しました。')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // IME変換確定のEnterでは送信しない
    if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) return
    if (e.key !== 'Enter') return
    // sendMode 'enter': Enter単体で送信、Shift+Enterは改行
    // sendMode 'shift-enter': Shift+Enterで送信、Enter単体は改行
    const shouldSend = sendMode === 'enter' ? !e.shiftKey : e.shiftKey
    if (shouldSend) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const visibleMailItems = channel === 'line' ? [] : emailItems
  const visibleLineItems = channel === 'email' ? [] : chats
  const quickCounts = {
    all: visibleMailItems.length + visibleLineItems.length,
    reply:
      visibleMailItems.filter((item) => item.status === 'unread').length
      + visibleLineItems.filter((chat) => chat.status === 'unread').length,
    mine:
      visibleMailItems.filter((item) => Boolean(currentStaffId) && item.assignedStaffId === currentStaffId).length
      + visibleLineItems.filter((chat) => Boolean(currentStaffId) && chat.operatorId === currentStaffId).length,
    overdue:
      visibleMailItems.filter((item) => item.status === 'unread' && isOlderThanOneHour(item.lastIncomingAt)).length
      + visibleLineItems.filter((chat) => chat.status === 'unread' && isOlderThanOneHour(chat.lastMessageAt)).length,
  }

  return (
    <div className="space-y-3">
      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      <section
        data-design="Filters"
        data-inbox-v4="quick-filters"
        className="relative flex min-h-10 flex-wrap items-center gap-2"
        aria-label="受信箱のクイック絞り込み"
      >
        {[
          { key: 'all' as const, label: 'すべて' },
          { key: 'reply' as const, label: '要返信' },
          { key: 'mine' as const, label: '自分担当' },
          { key: 'overdue' as const, label: '期限超過' },
        ].map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setQuickFilter(filter.key)}
            aria-pressed={quickFilter === filter.key}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              quickFilter === filter.key
                ? 'border-[#06C755] bg-[#EAFBF0] text-[#057A37]'
                : 'border-[#E5E7EB] bg-canvas text-[#667085] hover:bg-[#F7F8F6]'
            }`}
          >
            {filter.label} <span className="ml-1 tabular-nums opacity-70">{quickCounts[filter.key]}</span>
          </button>
        ))}
        <button
          type="button"
          disabled
          title="お気に入り機能は準備中です"
          aria-label="お気に入り（準備中）"
          className="border-[#E5E7EB] text-[#667085] rounded-full border bg-canvas px-3 py-1.5 text-xs disabled:cursor-not-allowed"
        >
          ☆
        </button>
        <details className="relative ml-auto">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-canvas px-3 py-2 text-xs font-semibold text-[#344054] hover:bg-[#F7F8F6]">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M7 12h10M10 19h4"/></svg>
            絞り込み
          </summary>
          <div className="absolute top-[calc(100%+6px)] right-0 z-30 w-52 rounded-lg border border-[#E5E7EB] bg-canvas p-3 shadow-lg">
            <p className="text-[11px] font-semibold text-[#667085]">対応状態</p>
            <div className="mt-2 grid gap-1">
              {statusFilters.map((filter) => (
                <button key={filter.key} type="button" onClick={() => setStatusFilter(filter.key)} className={`rounded-md px-2 py-1.5 text-left text-xs ${statusFilter === filter.key ? 'bg-[#EAFBF0] font-semibold text-[#057A37]' : 'text-[#667085] hover:bg-[#F7F8F6]'}`}>{filter.label}</button>
              ))}
            </div>
          </div>
        </details>
        <button type="button" disabled title="保存した検索は準備中です" className="rounded-lg border border-[#E5E7EB] bg-canvas px-3 py-2 text-xs font-semibold text-[#2563EB] disabled:cursor-not-allowed">
          保存した検索
        </button>
      </section>

      <div
        data-design="Panes"
        className="border-[#E5E7EB] bg-canvas shadow-[1px_1px_2px_rgba(29,29,31,0.13)] relative flex h-[calc(100vh-282px)] min-h-[560px] overflow-hidden rounded-[10px] border"
      >
        {/* Left Panel: Chat List */}
        {/* 設計 `ListPane` 360px。 */}
        {/* 狭い画面では、開いている間は一覧を隠して中央を広く使う。
            メールを開いたときも同じ。ここが LINE だけを見ていたので、
            メールを開いても一覧が残って中央が半分のままだった。 */}
        <div
          data-inbox-v4="conversation-list"
          className={`w-full border-[#E5E7EB] bg-canvas lg:w-[330px] 2xl:w-[420px] lg:flex-shrink-0 border-r flex-col overflow-hidden ${selectedChatId || selectedThreadId ? 'hidden lg:flex' : 'flex'}`}
        >
          {/* タブ (全て / 未読 / 対応中 / 対応済) は意図的に削除。直近メッセージが見やすい LINE 風一覧を優先。 */}

          {/* 設計 `ListPane` の「名前で検索」。一覧が長くなると状態の絞り込みだけでは足りない。 */}
          <div className="border-[#E5E7EB] border-b p-3">
            <div className="relative">
              <svg className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#98A2B3]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
              <input
              type="search"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              placeholder="名前・メールアドレス・内容で検索"
              aria-label="名前・メールアドレス・内容で検索"
              className="w-full rounded-lg border border-[#E5E7EB] bg-canvas py-2 pr-3 pl-9 text-xs text-[#1F2937] outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/15"
              />
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              {CHANNELS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => router.push(item.key === 'all' ? '/chats' : `/chats?channel=${item.key}`)}
                  aria-pressed={channel === item.key}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${channel === item.key ? 'bg-[#EAFBF0] text-[#057A37]' : 'text-[#344054] hover:bg-[#F7F8F6]'}`}
                >
                  {item.key === 'line' && <ChannelBadge channel="line" />}
                  {item.key === 'email' && <ChannelBadge channel="email" />}
                  {item.label}
                </button>
              ))}
              <span className="ml-auto text-[11px] font-semibold text-[#2563EB]">新しい順⌄</span>
            </div>
          </div>

          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-[#E5E7EB] px-3 py-2">
            {statusFilters.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  statusFilter === f.key
                    ? 'bg-[#06C755] text-on-accent'
                    : 'bg-[#F2F4F7] text-[#667085] hover:bg-[#EAECF0]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div>
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="px-4 py-3 border-b border-hairline animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-2">
                        <div className="h-3 bg-hairline rounded w-32" />
                        <div className="h-2 bg-canvas-sunken rounded w-20" />
                      </div>
                      <div className="h-5 bg-canvas-sunken rounded-full w-12" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/*
                  メールの問い合わせを同じ一覧の先頭に混ぜる。
                  設計 `V2 2-1 受信箱` の一覧は「✉ 定期便の解約について」のように
                  メールも同じ並びに入っている。出どころで場所を分けると、
                  返信を待っている人を2か所で探すことになる。

                  押したときの行き先だけは分ける。LINEはこの画面のトーク、
                  メールはメールの往復で、中央に出すものの作りが違う。
                */}
                {/*
                  LINE とメールを1本に混ぜて、新しいものが上に来るように並べる。
                  以前はメールを全部出してから LINE を出していたので、
                  出どころで固まってしまい、返信を待っている人を2か所で
                  探すことになっていた。

                  行の中身の作りは出どころで違う（メールは件名、LINE は
                  最後のメッセージと未対応の印）ので、描き方はそれぞれ
                  残したまま、並びだけそろえる。
                */}
                {(() => {
                  const mailRows = (channel === 'line' ? [] : emailItems)
                  .filter((item) =>
                    nameQuery.trim() === ''
                      ? true
                      : [item.customerName, item.customerIdentifier, item.subject, item.preview]
                          .filter(Boolean)
                          .some((value) => String(value).toLowerCase().includes(nameQuery.trim().toLowerCase())),
                  )
                  .filter((item) => statusFilter === 'all' || item.status === statusFilter)
                  .filter((item) => {
                    if (quickFilter === 'reply') return item.status === 'unread'
                    if (quickFilter === 'mine') return Boolean(currentStaffId) && item.assignedStaffId === currentStaffId
                    if (quickFilter === 'overdue') return item.status === 'unread' && isOlderThanOneHour(item.lastIncomingAt)
                    return true
                  })
                  .map((item) => ({
                    at: item.lastIncomingAt,
                    node: (
                    <button
                      key={item.id}
                      onClick={() => {
                        // LINEの選択を外す。両方開いていると中央に何を
                        // 出すのか決まらない。
                        setSelectedChatId(null)
                        setSelectedFriendId(null)
                        setSelectedThreadId(item.threadId)
                        setEmailItems((prev) => prev.map((email) => (
                          email.threadId === item.threadId ? { ...email, isUnread: false } : email
                        )))
                        void fetchApi(`/api/support/email/threads/${encodeURIComponent(item.threadId)}/read`, {
                          method: 'POST',
                        }).catch(() => undefined)
                      }}
                      className={`w-full border-b border-[#E5E7EB] px-3 py-3 text-left transition-colors ${
                        selectedThreadId === item.threadId ? 'bg-[#EAFBF0]' : 'hover:bg-[#F7F8F6]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          <div className="bg-canvas-sunken border-hairline flex h-10 w-10 items-center justify-center rounded-full border">
                            <span className="text-ink-secondary text-sm font-bold">M</span>
                          </div>
                          {item.isUnread && (
                            <span className="border-canvas bg-danger absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2" aria-label="未読" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-ink truncate text-sm font-medium">{item.customerName}</p>
                            <span className="text-ink-faint shrink-0 text-[10px]">
                              {formatDatetime(item.lastIncomingAt)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-start justify-between gap-2">
                            <p className="text-ink-faint line-clamp-2 min-w-0 flex-1 text-xs leading-4">
                              {item.subject || item.preview}
                            </p>
                            <span
                              className={`rounded-pill shrink-0 px-1.5 py-0.5 text-[10px] font-medium ${statusConfig[item.status].className}`}
                            >
                              {statusConfig[item.status].label}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <ChannelBadge channel="email" />
                            <span className="text-ink-faint inline-flex min-w-0 items-center gap-1 text-[10px]">
                              <span className="bg-action-soft text-action flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-bold">
                                {(item.assignedStaffName ?? '未').charAt(0)}
                              </span>
                              <span className="truncate">{item.assignedStaffName ?? '未割り当て'}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                    ),
                  }))
                  const lineRows = (channel === 'email' ? [] : chats)
                  .filter((chat) =>
                    nameQuery.trim() === ''
                      ? true
                      : [chat.friendName, chat.lastMessageContent]
                          .filter(Boolean)
                          .some((value) => String(value).toLowerCase().includes(nameQuery.trim().toLowerCase())),
                  )
                  .filter((chat) => {
                    if (quickFilter === 'reply') return chat.status === 'unread'
                    if (quickFilter === 'mine') return Boolean(currentStaffId) && chat.operatorId === currentStaffId
                    if (quickFilter === 'overdue') return chat.status === 'unread' && isOlderThanOneHour(chat.lastMessageAt)
                    return true
                  })
                  .map((chat) => {
                  const isSelected = selectedChatId === chat.id
                  const operatorName = operators.find((operator) => operator.id === chat.operatorId)?.name ?? null
                  // 「真の自発（要対応）」= chat.status='unread'。webhook 側で auto_reply に
                  // マッチしなかった incoming のみ unread に設定される。auto_reply trigger
                  // (キーワード "コスト比較" 等) は matched 扱いで unread 化しない。
                  // 太字と印の表示はこの status を使う。direction だけだと button 押下も
                  // 強調してしまって S/N 比が悪化する。
                  const needsAttention = chat.status === 'unread'
                  // 最新メッセージの本文 preview。flex/image は文字列で見せても意味が薄いので type 表記に置換。
                  const previewRaw = chat.lastMessageContent ?? ''
                  const preview = (() => {
                    // 絵文字は付けない。言葉だけで何かは分かる。
                    if (chat.lastMessageType === 'image') return '画像'
                    if (chat.lastMessageType === 'flex') return 'Flexメッセージ'
                    if (chat.lastMessageType === 'sticker') return 'スタンプ'
                    if (chat.lastMessageType === 'video') return '動画'
                    if (chat.lastMessageType === 'audio') return '音声'
                    if (chat.lastMessageType === 'file') return 'ファイル'
                    if (chat.lastMessageType === 'location') return '位置情報'
                    return previewRaw.replace(/\n+/g, ' ').slice(0, 60)
                  })()
                  const node = (
                    <button
                      key={chat.id}
                      onClick={() => { setSelectedFriendId(null); handleSelectChat(chat.id); }}
                      className={`w-full border-b border-[#E5E7EB] px-3 py-3 text-left transition-colors ${
                        isSelected && !selectedFriendId ? 'bg-[#EAFBF0]' : 'hover:bg-[#F7F8F6]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          {chat.friendPictureUrl ? (
                            <img src={chat.friendPictureUrl} alt="" className="h-10 w-10 rounded-full" />
                          ) : (
                            <div className="bg-canvas-sunken flex h-10 w-10 items-center justify-center rounded-full">
                              <span className="text-ink-faint text-sm">{chat.friendName.charAt(0)}</span>
                            </div>
                          )}
                          {chat.isUnread && (
                            <span className="border-canvas bg-danger absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2" aria-label="未読" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <p className="text-sm font-medium text-ink truncate">{chat.friendName}</p>
                            </div>
                            <span className="text-[10px] text-ink-faint flex-shrink-0">{formatDatetime(chat.lastMessageAt)}</span>
                          </div>
                          {/*
                            設計は行ごとに状態を出す。色だけだと、赤い点が
                            「未読」なのか「未対応」なのか区別が付かない。
                          */}
                          <div className="mt-1 flex items-start justify-between gap-2">
                            <p
                              className={`line-clamp-2 min-w-0 flex-1 text-xs leading-4 ${
                                needsAttention ? 'text-ink font-medium' : 'text-ink-faint'
                              }`}
                              title={preview}
                            >
                              {chat.lastMessageDirection === 'outgoing' && (
                                <span className="text-ink-faint mr-1">返信：</span>
                              )}
                              {preview || <span className="text-ink-faint italic">(まだメッセージなし)</span>}
                            </p>
                            <span
                              className={`rounded-pill shrink-0 px-1.5 py-0.5 text-[10px] font-medium ${statusConfig[chat.status].className}`}
                            >
                              {statusConfig[chat.status].label}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <ChannelBadge channel="line" />
                            <span className="text-ink-faint inline-flex min-w-0 items-center gap-1 text-[10px]">
                              <span className="bg-action-soft text-action flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-bold">
                                {(operatorName ?? '未').charAt(0)}
                              </span>
                              <span className="truncate">{operatorName ?? '未割り当て'}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                  return { at: chat.lastMessageAt ?? '', node }
                })
                  return [...mailRows, ...lineRows]
                    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
                    .map((r) => r.node)
                })()}

                {hasMoreChats && (
                  <button
                    onClick={() => { void loadMoreChats() }}
                    disabled={loadingMore}
                    className="w-full px-4 py-3 text-sm text-success hover:bg-accent-soft disabled:opacity-50 border-b border-hairline"
                  >
                    {loadingMore ? '読み込み中...' : 'さらに読み込む'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Panel: Chat Detail */}
        <div
          data-inbox-v4="talk-pane"
          className={`min-w-0 flex-1 bg-canvas flex-col overflow-hidden ${showFriendInfo ? 'border-r border-[#E5E7EB]' : ''} ${selectedChatId || selectedFriendId || selectedThreadId ? 'flex' : 'hidden lg:flex'}`}
        >
          {selectedThreadId ? (
            /* メールの往復。LINEのトークと同じ場所に出す。 */
            <EmailThread
              threadId={selectedThreadId}
              onChanged={() => {
                void loadEmails()
              }}
            />
          ) : selectedFriendId && !selectedChatId ? (
            /* Direct message to friend without existing chat */
            <DirectMessagePanel
              friendId={selectedFriendId}
              friend={allFriends.find((f) => f.id === selectedFriendId) || null}
              onBack={() => setSelectedFriendId(null)}
              onSent={() => { setSelectedFriendId(null); loadChats(); }}
            />
          ) : !selectedChatId ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-ink-faint text-sm">チャットを選択してください</p>
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-ink-faint text-sm">読み込み中...</p>
            </div>
          ) : chatDetail ? (
            <>
              {/* Chat Header */}
              <div className="flex min-h-[66px] items-center justify-between gap-2 border-b border-[#E5E7EB] bg-canvas px-4 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => setSelectedChatId(null)}
                    className="lg:hidden flex-shrink-0 p-1 -ml-1 text-ink-faint hover:text-ink-secondary"
                    aria-label="戻る"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  {chatDetail.friendPictureUrl && (
                    <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate">
                      {chatDetail.friendName}
                    </p>
                    <p className="text-ink-faint mt-0.5 text-xs">
                      最終受信 {formatDatetime(chatDetail.lastMessageAt)} ・ LINE
                    </p>
                  </div>
                </div>

                {/*
                  設計 `TalkPane` の上部。「対応」と「担当」をここで切り替える。
                  以前は状態がバッジで出ているだけで、変えるには別の場所を
                  探す必要があった。返信しながら状態を動かすので、
                  同じ場所に置く。
                */}
                {/* 右へ寄せる。名前は左、操作は右。目で追う向きがそろう。 */}
                <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
                  <label className="flex items-center gap-1.5 text-xs">
                    <span className="text-ink-faint">対応</span>
                    <select
                      value={chatDetail.status}
                      onChange={(e) => void handleStatusUpdate(e.target.value as Chat['status'])}
                      className="border-hairline rounded-control focus:ring-accent border px-2 py-1 text-xs focus:ring-2 focus:outline-none"
                    >
                      <option value="unread">未対応</option>
                      <option value="in_progress">対応中</option>
                      <option value="resolved">対応済</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <span className="text-ink-faint">担当</span>
                    <select
                      value={chatDetail.operatorId ?? ''}
                      onChange={(e) => void handleOperatorUpdate(e.target.value || null)}
                      className="border-hairline rounded-control focus:ring-accent border px-2 py-1 text-xs focus:ring-2 focus:outline-none"
                    >
                      <option value="">未割り当て</option>
                      {operators.map((op) => (
                        <option key={op.id} value={op.id}>
                          {op.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowFriendInfo((v) => !v)}
                    aria-pressed={showFriendInfo}
                    className="rounded-lg border border-[#E5E7EB] bg-canvas px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-[#2563EB] hover:bg-[#F7F8F6]"
                  >
                    {showFriendInfo ? '顧客情報を閉じる' : '顧客情報を表示'}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/*
                    「未読に戻す」「対応中にする」「対応済にする」は
                    上の「対応 ▾」と同じことをしていたので外した。
                    同じ操作の入口が2つあると、どちらが正なのか分からない。
                  */}
                </div>
              </div>

              {/* Messages — LINE-style chat bubbles */}
              <div ref={messagesScrollRef} className="flex-1 space-y-2 overflow-y-auto p-4" style={{ backgroundColor: '#7292BD' }}>
                {(!chatDetail.messages || chatDetail.messages.length === 0) ? (
                  <div className="text-center py-8">
                    <p className="text-on-accent/60 text-sm">メッセージはまだありません。</p>
                  </div>
                ) : (
                  (chatDetail.messages ?? []).map((msg, idx) => {
                    const prevMsg = idx > 0 ? (chatDetail.messages ?? [])[idx - 1] : null
                    const showDateSep = !prevMsg || !sameYmd(prevMsg.createdAt, msg.createdAt)
                    const isOutgoing = msg.direction === 'outgoing'

                    // メッセージ表示の分岐
                    let bubbleContent: React.ReactNode
                    if (msg.messageType === 'flex') {
                      bubbleContent = (
                        <div className="max-w-[300px]">
                          <FlexPreviewComponent content={msg.content} maxWidth={280} />
                        </div>
                      )
                    } else if (msg.messageType === 'image') {
                      try {
                        const parsed = JSON.parse(msg.content)
                        bubbleContent = (
                          <img src={parsed.originalContentUrl || parsed.previewImageUrl} alt="" className="max-w-[200px] rounded" />
                        )
                      } catch {
                        bubbleContent = <span>[画像]</span>
                      }
                    } else if (msg.messageType === 'sticker') {
                      bubbleContent = <StickerMessageImage content={msg.content} />
                    } else {
                      bubbleContent = <span>{msg.content}</span>
                    }

                    if (msg.source === 'scenario') {
                      const startedAt = new Date(msg.createdAt).toLocaleString('ja-JP', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })
                      return (
                        <div key={msg.id}>
                          {showDateSep && (
                            <div className="my-3 flex justify-center">
                              <span className="bg-ink/20 text-on-accent/85 rounded-full px-2.5 py-0.5 text-[11px]">
                                {formatYmdSlash(msg.createdAt)}
                              </span>
                            </div>
                          )}
                          <div className="my-2 flex justify-center">
                            <span className="bg-canvas/90 text-action rounded-full px-3 py-1 text-[11px] font-medium shadow-sm">
                              シナリオ「{msg.scenarioName ?? '名称未設定'}」を開始 ・ {startedAt}
                            </span>
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div key={msg.id}>
                        {showDateSep && (
                          <div className="flex justify-center my-3">
                            <span className="text-[11px] text-on-accent/85 bg-ink/20 px-2.5 py-0.5 rounded-full">
                              {formatYmdSlash(msg.createdAt)}
                            </span>
                          </div>
                        )}
                        <div
                          className={`flex items-end gap-2 ${isOutgoing ? 'justify-end' : 'justify-start'}`}
                        >
                          {/* 相手のアイコン（incoming のみ） */}
                          {!isOutgoing && (
                            chatDetail.friendPictureUrl ? (
                              <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0 mb-1" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-hairline flex-shrink-0 mb-1" />
                            )
                          )}

                          <div className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}>
                            {/* メッセージバブル */}
                            <div
                              className={`max-w-[320px] px-3 py-2 text-sm break-words whitespace-pre-wrap ${
                                isOutgoing
                                  ? 'rounded-tl-2xl rounded-tr-md rounded-bl-2xl rounded-br-2xl text-on-accent'
                                  : 'rounded-tl-md rounded-tr-2xl rounded-bl-2xl rounded-br-2xl bg-canvas text-ink'
                              }`}
                              style={isOutgoing ? { backgroundColor: 'var(--color-accent)' } : undefined}
                            >
                              {bubbleContent}
                            </div>
                            {/* 時刻 */}
                            <span className="text-xs text-on-accent/50 mt-0.5 px-1">
                              {new Date(msg.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          {/* 返信担当者は管理画面だけに表示。LINEの相手には公式アカウントの表示のまま。 */}
                          {isOutgoing && (
                            <div className="mb-0.5 flex w-12 shrink-0 flex-col items-center">
                              <div
                                className="border-canvas bg-action text-on-action flex h-8 w-8 items-center justify-center rounded-full border-2 text-[11px] font-bold"
                                title={msg.sentByStaffName ?? '担当者情報なし'}
                              >
                                {(msg.sentByStaffName ?? '担').charAt(0)}
                              </div>
                              <span className="text-on-accent/80 mt-1 w-full truncate text-center text-[9px]">
                                {msg.sentByStaffName ?? '担当者'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/*
                入力欄（設計 `Reply`）。3段。

                  上: テンプレートを選択 …… Shift + Enter で改行
                  中: メッセージを入力
                  下: 画像は JPEG / PNG、1枚 10MB まで …… 送信

                以前は送信キーの設定・入力中ローディング・画像の投入枠が
                すべて出しっぱなしで、入力欄が縦に伸びてトークが読めなかった。
                よく使うものだけ出し、設定は畳む。
              */}
              <div data-inbox-v4="composer" className="sticky bottom-0 z-10 border-t border-[#E5E7EB] bg-canvas px-4 py-3">
                {/* 上段 */}
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {/* 設計 2-1-1。選ぶと本文が入力欄に入る。 */}
                    <button
                      type="button"
                      onClick={() => setShowTemplatePicker(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-canvas px-3 py-2 text-xs font-semibold text-[#2563EB] hover:bg-[#F7F8F6]"
                    >
                      ▧ テンプレートを選択
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowComposerOptions((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-canvas px-3 py-2 text-xs font-semibold text-[#2563EB] hover:bg-[#F7F8F6]"
                    >
                      ⚙ {showComposerOptions ? '送信の設定を閉じる' : '送信の設定'}
                    </button>
                  </div>
                  <span className="text-ink-faint text-xs">
                    {sendMode === 'enter' ? 'Shift + Enter で改行' : 'Enter で改行'}
                  </span>
                </div>

                {/* 送信の設定は送信キーだけ。入力中ローディングと画像の投入枠は
                    ここから外した。画像は下の枠のアイコンから選ぶ。 */}
                {showComposerOptions && (
                  <div className="bg-canvas-sunken rounded-card mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-xs">
                    <span className="text-ink-faint">送信キー:</span>
                    <label className="flex cursor-pointer items-center gap-1">
                      <input
                        type="radio"
                        checked={sendMode === 'enter'}
                        onChange={() => setSendMode('enter')}
                        className="accent-accent"
                      />
                      <span>Enter</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-1">
                      <input
                        type="radio"
                        checked={sendMode === 'shift-enter'}
                        onChange={() => setSendMode('shift-enter')}
                        className="accent-accent"
                      />
                      <span>Shift+Enter</span>
                    </label>
                  </div>
                )}

                <div className="rounded-[10px] border border-[#D0D5DD] bg-canvas p-2 focus-within:border-[#06C755] focus-within:ring-2 focus-within:ring-[#06C755]/15">
                  {/* 中段 */}
                  <textarea
                  value={messageContent}
                  onChange={(e) => setMessageContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={() => { isComposingRef.current = true }}
                  onCompositionEnd={() => { isComposingRef.current = false }}
                  rows={3}
                  placeholder="メッセージを入力"
                  aria-label="メッセージを入力"
                  className="w-full resize-none border-0 px-1 py-1 text-sm outline-none"
                  />

                  {/* 下段 */}
                  <div className="mt-1 flex items-center justify-between gap-2">
                  {/*
                    画像はここから。以前は「送信の設定」の中に投入枠を出しっぱなし
                    にしていて、入力欄が縦に伸びてトークが読めなかった。
                    アイコンを押すとファイルを選ぶ窓が開く。
                  */}
                  <span className="flex items-center gap-2">
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        // 同じ画像をもう一度選べるように値を戻す。
                        e.target.value = ''
                        if (file) void handlePickImage(file)
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={uploadingImage}
                      title="画像を選ぶ"
                      aria-label="画像を選ぶ"
                      className="rounded-md px-2 py-1 text-sm text-[#667085] hover:bg-[#F2F4F7] disabled:opacity-50"
                    >
                      {uploadingImage ? (
                        '…'
                      ) : (
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2m0 0 4-4a2 2 0 0 1 3 0l5 5M14 10h.01" />
                        </svg>
                      )}
                    </button>
                    <span className="text-ink-faint text-xs">
                      {imageError
                        ? imageError
                        : pendingImage
                          ? '画像を1枚 添付中'
                          : '画像は JPEG / PNG、1枚 1MB まで'}
                    </span>
                    {pendingImage && (
                      <button
                        type="button"
                        onClick={() => setPendingImage(null)}
                        className="text-ink-faint hover:text-danger text-xs"
                      >
                        外す
                      </button>
                    )}
                  </span>
                  <button
                    onClick={handleSendMessage}
                    disabled={sending || (!messageContent.trim() && !pendingImage)}
                    className="rounded-lg bg-[#06C755] px-5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-[#05B94F] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sending ? '送信中...' : '送信'}
                  </button>

                  <TemplatePicker
                    open={showTemplatePicker}
                    onClose={() => setShowTemplatePicker(false)}
                    onPick={(content) =>
                      // 入力済みの文があれば消さずに続ける。書きかけを失わせない。
                      setMessageContent((prev) => (prev.trim() ? `${prev}\n${content}` : content))
                    }
                  />
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/*
          友だち詳細。トークの上に重ねる。
          列として並べると、その幅ぶんトークが細くなり、上部の
          「対応」「担当」や本文が折り返して崩れる。設計は 1910px 前提の
          3列だが、実際の画面幅はそれより狭いことが多い。

          friendId は **現在の選択** を優先する。chatDetail の読み込み中は
          前の chat のデータが残っているので、それを参照すると
          ここだけ前の友だちを出し続ける。選択IDがそのまま friend_id。
        */}
        {/*
          友だち詳細。メールでも出したいが、メールのスレッドは友だちに
          紐づいていない（support_email_threads は customer_email しか
          持たない）。メールアドレスから友だちを引く口が要る。
          docs/v025-open-questions.md に残している。

          いまはメールを開いているときは案内を出す。空の枠を出すより、
          なぜ出ないかが分かる方がよい。
        */}
        {showFriendInfo && (selectedChatId || selectedFriendId || selectedThreadId) && (
          <aside
            data-inbox-v4="customer-panel"
            className="relative hidden h-full w-[300px] shrink-0 overflow-hidden bg-canvas xl:block 2xl:w-[340px]"
          >
            {/*
              重なりの中にも閉じるボタンを置く。上部のボタンだけだと、
              重なりが上部を覆っている画面幅で閉じられなくなる。
              実際そうなっていた。
            */}
            <button
              type="button"
              onClick={() => setShowFriendInfo(false)}
              aria-label="友だち詳細を閉じる"
              className="absolute top-3 right-3 z-10 rounded-lg border border-[#E5E7EB] bg-canvas px-2.5 py-1.5 text-xs font-semibold text-[#667085] hover:bg-[#F7F8F6]"
            >
              閉じる
            </button>
            {selectedThreadId ? (
              /*
                メールの相手は友だちに結びついていない。
                以前は「紐づいていません」の1行だけで、なぜなのか・
                どうすればよいのかが分からなかった。誰との話かと、
                いま何ができるかを出す。
              */
              (() => {
                const mail = emailItems.find((e) => e.threadId === selectedThreadId)
                return (
                  <div className="bg-canvas rounded-card border-hairline h-full w-full overflow-y-auto border p-5">
                    <p className="text-ink text-sm font-semibold">メールの相手</p>
                    <p className="text-ink mt-3 text-sm">{mail?.customerName ?? '—'}</p>
                    {mail?.customerIdentifier && (
                      <p className="text-ink-secondary mt-0.5 font-mono text-xs break-all">
                        {mail.customerIdentifier}
                      </p>
                    )}

                    <div className="bg-canvas-sunken rounded-card mt-4 p-3">
                      <p className="text-ink-secondary text-xs font-medium">
                        この人はまだ友だちと結びついていません
                      </p>
                      <p className="text-ink-faint mt-1 text-xs leading-relaxed">
                        メールは差出人のアドレスしか分かりません。LINEの友だちはアドレスを持っていないので、
                        同じ人かどうかを自動で判断できません。タグ・マイル・購入履歴はこの画面には出ません。
                      </p>
                    </div>

                    <p className="text-ink-secondary mt-4 text-xs font-medium">いまできること</p>
                    <ul className="text-ink-faint mt-1 space-y-1.5 text-xs leading-relaxed">
                      <li>
                        ・
                        <Link href="/friends" className="text-accent hover:underline">
                          友だち一覧
                        </Link>
                        で名前を検索して、同じ人かどうかを確かめる
                      </li>
                      <li>・そのままメールで返信する（この画面の下から送れます）</li>
                    </ul>

                    <EmailCustomerMemo threadId={selectedThreadId} />

                    <p className="text-ink-faint border-hairline mt-4 border-t pt-3 text-xs leading-relaxed">
                      アドレスから友だちを自動で探す仕組みは、まだ入っていません。友だち情報欄に
                      メールアドレスの項目を作って値を貯めておくと、入ったときにそのまま結びつけられます。
                    </p>
                  </div>
                )
              })()
            ) : (
            <FriendInfoSidebar
              friendId={selectedFriendId || selectedChatId}
              operatorName={
                chatDetail?.operatorId
                  ? operators.find((operator) => operator.id === chatDetail.operatorId)?.name ?? null
                  : null
              }
              chatStatus={
                chatDetail && chatDetail.id === (selectedFriendId || selectedChatId)
                  ? { status: chatDetail.status, notes: chatDetail.notes }
                  : undefined
              }
            />
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

/**
 * 受信箱（設計 `V2 2-1 受信箱`）。
 *
 * 設計に上部タブは無い。チャネル（すべて / LINE / メール）は
 * 画面内の絞り込みチップとして扱う。タブにすると「LINEの受信箱」と
 * 「メールの受信箱」が別物に見えるが、実際は1つの受信箱で、
 * 出どころが違うだけ。設計が1画面にまとめているのはそのため。
 *
 * ただし中身の作りが LINE とメールで大きく違うので、いまは
 * チップで表示を切り替える形にしている。将来1つの一覧に混ぜるときも、
 * 画面の入口は変わらない。
 */
// 受信箱のチャネル。
//
// /api/support/inbox は channel を 'all' | 'line' | 'email' で受け取り、
// どちらの出どころも同じ形（id / channel / customerName / preview /
// lastIncomingAt）で返す。つまり1つの一覧に混ぜられる。
const CHANNELS = [
  { key: 'all', label: 'すべて' },
  { key: 'line', label: 'LINE' },
  { key: 'email', label: 'メール' },
] as const

function ChatsPageHost() {
  const params = useSearchParams()
  const [showReadAllConfirm, setShowReadAllConfirm] = useState(false)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  // すべて / LINE / メール。既定はすべて。
  // 出どころを気にせず「返信を待っている人」を見たいのが普通なので、
  // 最初から絞った状態で出さない。
  const raw = params.get('channel')
  const channel: 'all' | 'line' | 'email' =
    raw === 'line' || raw === 'email' ? raw : 'all'

  return (
    <div className="space-y-3">
      <div data-design="Head">
        <Header
          title="受信箱"
          description="返信が必要な会話を見つけ、担当・期限・顧客情報を見ながら対応できます。"
          action={
            <div className="flex items-center gap-2">
              {/*
                設計にあるボタン。行き先の文書がまだ無いので押せなくしている。
                リンク先を仮置きすると行き止まりになる（route-integrity が落ちる）。
              */}
              <button
                disabled
                title="マニュアルは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
              >
                マニュアル
              </button>
              {/*
                すべて確認済みにする。押し間違えると未対応が全部消えるので、
                確認を挟む。設計にも同じボタンがある。
              */}
              <button
                onClick={() => setShowReadAllConfirm(true)}
                disabled={markingAllRead}
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
              >
                {markingAllRead ? '更新中...' : 'すべて確認済みにする'}
              </button>
            </div>
          }
        />
      </div>

      <div data-design="KPIs" data-inbox-v4="summary">
        <InboxKpis />
      </div>

      {/*
        1つの受信箱。LINEもメールも同じ一覧に並び、同じ場所で開く。

        以前はメールを下に別ブロックで積んでいたが、返信を待っている人を
        2か所で探すことになっていた。設計 `V2 2-1 受信箱` の一覧も
        「✉ 定期便の解約について」のように1本に混ざっている。
      */}
      <ChatsPageInner channel={channel} />

      <ConfirmDialog
        open={showReadAllConfirm}
        title="すべて確認済みにしますか？"
        description="ログイン中のあなたの未読だけを確認済みにします。他の担当者の未読や、共有している対応状態は変わりません。"
        confirmLabel="確認済みにする"
        onCancel={() => setShowReadAllConfirm(false)}
        onConfirm={() => {
          setShowReadAllConfirm(false)
          setMarkingAllRead(true)
          void Promise.all([
            api.chats.markAllRead(),
            fetchApi('/api/support/email/read-all', { method: 'POST' }),
          ]).then(() => {
            window.dispatchEvent(new Event(UNANSWERED_REFRESH_EVENT))
          }).finally(() => setMarkingAllRead(false))
        }}
      />
    </div>
  )
}

export default function ChatsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <ChatsPageHost />
    </Suspense>
  )
}
