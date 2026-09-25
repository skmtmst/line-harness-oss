'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Avatar from '@/components/shared/avatar'
import StatusBadge from '@/components/shared/status-badge'
import { ApiError, fetchApi } from '@/lib/api'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import { createPollGeneration, startVisiblePoll } from '@/lib/visible-polling'

type Channel = 'all' | 'line' | 'email'
type ThreadStatus = 'unread' | 'in_progress' | 'on_hold' | 'resolved'

type InboxItem = {
  id: string
  threadId: string
  channel: 'line' | 'email'
  customerName: string
  customerIdentifier: string
  subject: string
  preview: string
  status: ThreadStatus
  lastMessageAt: string
  lastIncomingAt: string
  pictureUrl?: string | null
  accountName?: string
}

type EmailMessage = {
  id: string
  direction: 'incoming' | 'outgoing'
  sender_email: string
  sender_name: string | null
  recipient_email: string
  subject: string
  body_text: string
  sent_by_staff_id: string | null
  created_at: string
}

type EmailDetail = {
  thread: {
    id: string
    customer_email: string
    customer_name: string | null
    subject: string
    status: ThreadStatus
    last_message_at: string
  }
  messages: EmailMessage[]
}

/**
 * 選択中メールの詳細を取り直すか(#630)。
 *
 * 一覧が未解決フィルターで回っていても、選んでいるスレッド自体が
 * 対応済みなら詳細は変わらないので取り直さない。`selected`(一覧の
 * 取り直しで更新)と `detail`(詳細の取り直しで更新)のどちらかが
 * 対応済みと言っていれば対応済みとみなす(更新の順番が前後するため)。
 */
export function shouldRefetchSelectedDetail(
  selected: Pick<InboxItem, 'channel' | 'status'> | null,
  detailStatus: ThreadStatus | null | undefined,
): boolean {
  if (selected?.channel !== 'email') return false
  return selected.status !== 'resolved' && detailStatus !== 'resolved'
}

const statusLabel: Record<ThreadStatus, string> = {
  unread: '未対応',
  in_progress: '対応中',
  on_hold: '保留',
  resolved: '対応済み',
}

function elapsed(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}時間前` : `${Math.floor(hours / 24)}日前`
}

/**
 * 最後の受信から30分以上たち、まだ対応が終わっていないものだけを
 * 注意として出す。対応済みの経過日数は赤くしない。
 */
const STALE_INCOMING_MS = 30 * 60_000

function isStaleUnresolved(item: Pick<InboxItem, 'status' | 'lastIncomingAt'>): boolean {
  return (
    item.status !== 'resolved' &&
    Date.now() - new Date(item.lastIncomingAt).getTime() >= STALE_INCOMING_MS
  )
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * メールでの問い合わせ。
 *
 * 受信箱（/chats）の中に置く。見出し・KPI・チャネル切替は呼び出し側が持つ。
 * ここが独自に持つと、同じものが画面に2つ並ぶ。
 *
 * `/support` は旧URLからの 308 で `/chats?channel=email` に飛ぶので、
 * この page.tsx が画面として開かれることはない。ただし Next は
 * page.tsx の既定エクスポートに PageProps を求めるため、引数を取れない。
 * 中身は SupportInbox に置き、page.tsx はそれを呼ぶだけにする。
 */
export default function SupportInbox({ channel = 'email' }: { channel?: Channel }) {
  const sendKeysRef = useRef(new IdempotencyKeyStore())
  const [status, setStatus] = useState<'open' | ThreadStatus | 'all'>('open')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<InboxItem[]>([])
  const [selected, setSelected] = useState<InboxItem | null>(null)
  // 選択の最新値はrefで読む。選択オブジェクトの更新で polling effect を
  // 作り直すと、旧取得の実行中に新制御器が次取得を始めて二重になる(#630)。
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [detail, setDetail] = useState<EmailDetail | null>(null)
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // 世代で古い応答を捨てる。一覧の絞り込み・選択の切替より後に戻った
  // 遅い応答が、新しい一覧・会話を上書きしない(順序逆転防止、#630)。
  const genRef = useRef(createPollGeneration())

  // 静かな取り直しは成否を返す。失敗の数え直し・待ちの延長は startVisiblePoll が持つ。
  // 古い取得の応答は捨て、失敗にも数えない(新しい取得が届ける)。
  const loadInbox = useCallback(async (quiet = false): Promise<boolean> => {
    const mySeq = genRef.current.next()
    const isStale = () => genRef.current.isStale(mySeq)
    if (!quiet) setLoading(true)
    try {
      const params = new URLSearchParams({ channel, status, limit: '200' })
      if (query.trim()) params.set('q', query.trim())
      const response = await fetchApi<{ success: boolean; data: { items: InboxItem[] } }>(`/api/support/inbox?${params}`)
      if (isStale()) return true
      if (response.success) {
        setItems(response.data.items)
        const current = selectedRef.current
        if (current) {
          const refreshed = response.data.items.find((item) => item.id === current.id)
          if (refreshed) setSelected(refreshed)
        }
        return true
      }
      return false
    } catch {
      if (isStale()) return true
      if (!quiet) setError('お問い合わせ一覧を読み込めませんでした')
      return false
    } finally {
      if (!quiet && !isStale()) setLoading(false)
    }
  }, [channel, query, status])

  const loadDetail = useCallback(async (threadId: string, quiet = false): Promise<boolean> => {
    const mySeq = genRef.current.next()
    // 選択切替後の遅い応答は捨てる。世代と選択IDの両方で見る。
    const isStale = () =>
      genRef.current.isStale(mySeq) || selectedRef.current?.threadId !== threadId
    try {
      const response = await fetchApi<{ success: boolean; data: EmailDetail }>(`/api/support/email/threads/${encodeURIComponent(threadId)}`)
      if (isStale()) return true
      if (response.success) {
        setDetail(response.data)
        if (!quiet) window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
        return true
      }
      return false
    } catch {
      if (isStale()) return true
      if (!quiet) setError('メールの会話を読み込めませんでした')
      return false
    }
  }, [])

  // 未解決だけを5秒起点の1本で取り直す。初回も同じ1本に載せ、
  // 別の effect で初回取得だけ外に走らせない(重複防止)。
  // 非表示では止め、連続失敗は待ちを延ばして上限後は再試行を出す。
  // 対応済み・すべて表示では、初回の1回だけ取ってから止める(#630)。
  const [inboxStalled, setInboxStalled] = useState(false)
  const [inboxRetryKey, setInboxRetryKey] = useState(0)
  /**
   * いま出ている会話の状態を「どのスレッドのものか」と一緒に持つ(#630)。
   *
   * 状態だけを持つと、対応済みAから未対応Bへ選び直した直後に、まだ
   * Aの状態を見て「対応済みだから取らない」と判断してしまい、Bの会話が
   * 読み込み中のまま止まる。deps には入れない(取り直すたびに待ちが
   * 振り出しに戻り、失敗の数え直しが壊れる)。
   */
  const detailStatusRef = useRef<{ threadId: string; status: ThreadStatus } | null>(null)
  detailStatusRef.current = detail ? { threadId: detail.thread.id, status: detail.thread.status } : null
  useEffect(() => {
    setInboxStalled(false)
    // 初回だけ表示あり(スピナー・エラー)、2回目から静かに。
    let first = true
    const poll = startVisiblePoll({
      // 「対応済み」「すべて」は5秒更新の対象外だが、初回の1回は取る。
      // 絞り込みを変えた直後に取らないと、前の絞り込みの一覧が残る(#630)。
      immediate: true,
      shouldPoll: () => status === 'open' || status === 'unread' || status === 'in_progress' || status === 'on_hold',
      work: async () => {
        const loud = first
        first = false
        const inboxOk = await loadInbox(!loud)
        // 未解決フィルターでも、選んでいるスレッド自体が対応済みなら
        // 詳細は取り直さない(#630)。選択はrefで読む(effectを作り直さない)。
        const current = selectedRef.current
        const seen = detailStatusRef.current
        const detailStatus = seen && current && seen.threadId === current.threadId ? seen.status : undefined
        const detailOk = current && shouldRefetchSelectedDetail(current, detailStatus)
          ? await loadDetail(current.threadId, true)
          : true
        if (!inboxOk || !detailOk) throw new Error('お問い合わせ一覧を読み込めませんでした')
      },
      onGiveUp: () => setInboxStalled(true),
      onRecovered: () => setInboxStalled(false),
    })
    return () => poll.stop()
  }, [loadDetail, loadInbox, status, inboxRetryKey])


  const choose = (item: InboxItem) => {
    setSelected(item)
    setError('')
    // 選択切替時は旧詳細を捨てる。残すと、前スレッドの対応済み状態が
    // detailStatusRef に残り、未解決の新スレッドの再取得を止めてしまう(#630)。
    setDetail(null)
    if (item.channel === 'email') void loadDetail(item.threadId)
  }

  const updateStatus = async (next: ThreadStatus) => {
    if (!selected || selected.channel !== 'email') return
    try {
      await fetchApi(`/api/support/email/threads/${encodeURIComponent(selected.threadId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      })
      setSelected({ ...selected, status: next })
      if (detail) setDetail({ ...detail, thread: { ...detail.thread, status: next } })
      await loadInbox(true)
    } catch {
      setError('対応状況を更新できませんでした')
    }
  }

  const sendReply = async () => {
    if (!selected || selected.channel !== 'email' || !reply.trim() || sending) return
    const content = reply.trim()
    const signature = JSON.stringify({ threadId: selected.threadId, body: content })
    const idempotencyKey = sendKeysRef.current.get(signature)
    setSending(true)
    setError('')
    try {
      await fetchApi(`/api/support/email/threads/${encodeURIComponent(selected.threadId)}/reply`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ body: content }),
      })
      sendKeysRef.current.clear(signature)
      setReply('')
      await Promise.all([loadDetail(selected.threadId), loadInbox(true)])
    } catch (sendError) {
      setError(
        sendError instanceof ApiError && sendError.status === 409
          ? '送信結果を確認中です。二重送信を避けるため再送せず、受信履歴を確認してください'
          : 'メールを送信できませんでした。送信設定を確認してください',
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      {/*
        受信箱（/chats）の中に置く。見出しとKPIとチャネル切替は
        呼び出し側が持っているので、ここでは出さない。
        両方が出すと、同じものが画面に2つ並ぶ（実際そうなっていた）。
      */}
      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger rounded-card mb-4 border px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {inboxStalled && (
        <div className="bg-danger-bg border-danger-bg text-danger rounded-card mb-4 border px-4 py-3 text-sm">
          お問い合わせ一覧の更新を一時停止しています（接続できません）。
          <button
            type="button"
            onClick={() => setInboxRetryKey((key) => key + 1)}
            className="font-bold underline"
          >
            再試行する
          </button>
        </div>
      )}

      <div className="rounded-card border-hairline overflow-hidden border bg-canvas lg:grid lg:h-[calc(100vh-260px)] lg:min-h-[620px] lg:grid-cols-[360px_1fr]">
        <aside className="border-b border-hairline lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b border-hairline bg-canvas-sunken p-4">
            <div className="flex gap-2">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・メール・件名で検索" aria-label="名前・メール・件名で検索" className="min-w-0 flex-1 rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm outline-none focus:border-success focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
              <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="対応状態で絞り込む" className="rounded-lg border border-hairline bg-canvas px-2 text-xs font-medium">
                <option value="open">未解決</option>
                <option value="unread">未対応</option>
                <option value="in_progress">対応中</option>
                <option value="resolved">対応済み</option>
                <option value="all">すべて</option>
              </select>
            </div>
          </div>
          <div className="max-h-[520px] divide-y divide-divider-soft overflow-y-auto lg:max-h-none lg:h-[calc(100%-116px)]">
            {loading ? <div className="p-10 text-center text-sm text-ink-faint">読み込み中...</div> : items.length === 0 ? <div className="p-10 text-center text-sm text-ink-faint">対応待ちはありません</div> : items.map((item) => (
              <button key={item.id} onClick={() => choose(item)} className={`w-full p-4 text-left transition-colors hover:bg-canvas-sunken ${selected?.id === item.id ? 'bg-success-bg ring-1 ring-inset ring-success' : ''}`}>
                <div className="flex items-start gap-3">
                  <Avatar name={item.customerName} src={item.pictureUrl ?? null} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-bold text-ink">{item.customerName}</p>
                      <span className={`rounded-full px-2 py-0.5 text-micro font-bold ${item.channel === 'line' ? 'bg-accent-soft text-accent-deep' : 'bg-canvas-sunken text-ink-secondary'}`}>{item.channel === 'line' ? 'LINE' : 'メール'}</span>
                    </div>
                    <p className="mt-1 truncate text-xs font-medium text-ink-secondary">{item.subject}</p>
                    <p className="mt-1 truncate text-xs text-ink-faint">{item.preview}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-[11px] font-semibold ${isStaleUnresolved(item) ? 'text-status-warn-deep' : 'text-ink-faint'}`}>{elapsed(item.lastIncomingAt)}</p>
                    <StatusBadge
                      tone={item.status === 'resolved' ? 'success' : 'neutral'}
                      size="compact"
                      className="mt-1"
                    >
                      {statusLabel[item.status]}
                    </StatusBadge>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-h-[560px] flex-col bg-canvas-sunken">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-ink-faint">
              <div>
                <svg className="text-ink-faint mx-auto mb-3 h-10 w-10" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5M21 12a8 8 0 0 1-11.4 7.2L3 21l1.8-6.1A8 8 0 1 1 21 12Z" />
                </svg>
                対応するお問い合わせを選択してください
              </div>
            </div>
          ) : selected.channel === 'line' ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent-deep text-2xl font-bold text-white">LINE</div>
              <h2 className="text-lg font-bold text-ink">{selected.customerName}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-ink-secondary">LINEの会話履歴と送信機能は、既存の個別チャット画面でそのまま使えます。</p>
              <p className="mt-4 rounded-xl bg-canvas px-4 py-3 text-sm text-ink shadow-sm">{selected.preview}</p>
              <Link href={`/chats?friend=${encodeURIComponent(selected.threadId)}&unanswered=1`} className="mt-6 rounded-xl bg-accent-deep px-6 py-3 text-sm font-bold text-white shadow-sm hover:brightness-90">LINEで返信する →</Link>
            </div>
          ) : detail ? (
            <>
              {/*
               * 状態切替の札はトークンの組にする。以前の bg-amber-500＋白字は 2.15:1、
               * bg-emerald-600＋白字は 3.77:1 で読めない。選んだ札は濃い塗り＋白字
               * （warning 5.33:1・success 5.61:1）、選んでいない札は薄い塗り＋濃い字。
               */}
              <div className="flex flex-col gap-3 border-b border-hairline bg-canvas px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-bold text-ink">{detail.thread.subject}</h2>
                  <p className="mt-1 truncate text-xs text-ink-faint">{detail.thread.customer_name || selected.customerName} · {detail.thread.customer_email}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => void updateStatus('in_progress')} className={`rounded-lg px-3 py-2 text-xs font-bold ${detail.thread.status === 'in_progress' ? 'bg-warning text-on-accent' : 'bg-warning-bg text-warning'}`}>対応中</button>
                  <button onClick={() => void updateStatus('on_hold')} className={`rounded-lg px-3 py-2 text-xs font-bold ${detail.thread.status === 'on_hold' ? 'bg-action text-on-action' : 'bg-action-soft text-action'}`}>保留</button>
                  <button onClick={() => void updateStatus('resolved')} className={`rounded-lg px-3 py-2 text-xs font-bold ${detail.thread.status === 'resolved' ? 'bg-success text-on-accent' : 'bg-success-bg text-success'}`}>✓ 対応済み</button>
                  {detail.thread.status === 'resolved' && <button onClick={() => void updateStatus('unread')} className="rounded-lg bg-canvas-sunken px-3 py-2 text-xs font-bold text-ink-secondary">再オープン</button>}
                </div>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
                {detail.messages.map((message) => (
                  <div key={message.id} className={`flex ${message.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[86%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[72%] ${message.direction === 'outgoing' ? 'rounded-br-md bg-success-bg text-ink' : 'rounded-bl-md bg-canvas text-ink'}`}>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body_text}</p>
                      <p className="mt-2 text-right text-[10px] text-ink-faint">{dateTime(message.created_at)}{message.direction === 'outgoing' ? ' · 送信済み' : ''}</p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="border-t border-hairline bg-canvas p-4">
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void sendReply() }} placeholder="メールの返信を入力…（Ctrl/Command + Enterで送信）" aria-label="メールの返信を入力" rows={4} className="w-full resize-none rounded-xl border border-hairline bg-canvas-sunken px-4 py-3 text-sm leading-6 outline-none focus:border-success focus:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-status-info" />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-[11px] text-ink-faint">From: contact-shed@nen-petfood.com</p>
                  <button onClick={() => void sendReply()} disabled={!reply.trim() || sending} className="rounded-xl bg-accent-deep px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40">{sending ? '送信中…' : 'メールで返信'}</button>
                </div>
              </div>
            </>
          ) : <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">会話を読み込み中...</div>}
        </div>
      </div>
    </div>
  )
}


/* 一覧の顔は共通 Avatar（名前から頭文字）。青丸＋✉の自前描画は使わない。 */
