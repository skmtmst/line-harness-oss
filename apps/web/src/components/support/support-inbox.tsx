'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, fetchApi } from '@/lib/api'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'

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
  const [detail, setDetail] = useState<EmailDetail | null>(null)
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadInbox = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const params = new URLSearchParams({ channel, status, limit: '200' })
      if (query.trim()) params.set('q', query.trim())
      const response = await fetchApi<{ success: boolean; data: { items: InboxItem[] } }>(`/api/support/inbox?${params}`)
      if (response.success) {
        setItems(response.data.items)
        if (selected) {
          const refreshed = response.data.items.find((item) => item.id === selected.id)
          if (refreshed) setSelected(refreshed)
        }
      }
    } catch {
      setError('お問い合わせ一覧を読み込めませんでした')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [channel, query, selected, status])

  const loadDetail = useCallback(async (threadId: string, quiet = false) => {
    try {
      const response = await fetchApi<{ success: boolean; data: EmailDetail }>(`/api/support/email/threads/${encodeURIComponent(threadId)}`)
      if (response.success) {
        setDetail(response.data)
        if (!quiet) window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      }
    } catch {
      setError('メールの会話を読み込めませんでした')
    }
  }, [])

  useEffect(() => { void loadInbox() }, [channel, status, query]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadInbox(true)
      if (selected?.channel === 'email') void loadDetail(selected.threadId, true)
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [loadDetail, loadInbox, selected])


  const choose = (item: InboxItem) => {
    setSelected(item)
    setError('')
    if (item.channel === 'email') void loadDetail(item.threadId)
    else setDetail(null)
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

      <div className="rounded-card border-hairline overflow-hidden border bg-white lg:grid lg:h-[calc(100vh-260px)] lg:min-h-[620px] lg:grid-cols-[360px_1fr]">
        <aside className="border-b border-gray-200 lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b border-gray-200 bg-gray-50/70 p-4">
            <div className="flex gap-2">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・メール・件名で検索" className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="rounded-lg border border-gray-200 bg-white px-2 text-xs font-medium">
                <option value="open">未解決</option>
                <option value="unread">未対応</option>
                <option value="in_progress">対応中</option>
                <option value="resolved">対応済み</option>
                <option value="all">すべて</option>
              </select>
            </div>
          </div>
          <div className="max-h-[520px] divide-y divide-gray-100 overflow-y-auto lg:max-h-none lg:h-[calc(100%-116px)]">
            {loading ? <div className="p-10 text-center text-sm text-gray-400">読み込み中...</div> : items.length === 0 ? <div className="p-10 text-center text-sm text-gray-400">対応待ちはありません</div> : items.map((item) => (
              <button key={item.id} onClick={() => choose(item)} className={`w-full p-4 text-left transition-colors hover:bg-gray-50 ${selected?.id === item.id ? 'bg-emerald-50 ring-1 ring-inset ring-emerald-200' : ''}`}>
                <div className="flex items-start gap-3">
                  <ChannelAvatar item={item} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-bold text-gray-900">{item.customerName}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${item.channel === 'line' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{item.channel === 'line' ? 'LINE' : 'EMAIL'}</span>
                    </div>
                    <p className="mt-1 truncate text-xs font-medium text-gray-600">{item.subject}</p>
                    <p className="mt-1 truncate text-xs text-gray-400">{item.preview}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-[11px] font-semibold ${Date.now() - new Date(item.lastIncomingAt).getTime() >= 30 * 60_000 ? 'text-rose-600' : 'text-gray-400'}`}>{elapsed(item.lastIncomingAt)}</p>
                    <p className="mt-1 text-[10px] text-gray-400">{statusLabel[item.status]}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-h-[560px] flex-col bg-[#f4f6f5]">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-gray-400">
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
              <h2 className="text-lg font-bold text-gray-900">{selected.customerName}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-gray-500">LINEの会話履歴と送信機能は、既存の個別チャット画面でそのまま使えます。</p>
              <p className="mt-4 rounded-xl bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">{selected.preview}</p>
              <Link href={`/chats?friend=${encodeURIComponent(selected.threadId)}&unanswered=1`} className="mt-6 rounded-xl bg-accent-deep px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-600">LINEで返信する →</Link>
            </div>
          ) : detail ? (
            <>
              <div className="flex flex-col gap-3 border-b border-gray-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-bold text-gray-900">{detail.thread.subject}</h2>
                  <p className="mt-1 truncate text-xs text-gray-500">{detail.thread.customer_name || selected.customerName} · {detail.thread.customer_email}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => void updateStatus('in_progress')} className={`rounded-lg px-3 py-2 text-xs font-bold ${detail.thread.status === 'in_progress' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700'}`}>対応中</button>
                  <button onClick={() => void updateStatus('on_hold')} className={`rounded-lg px-3 py-2 text-xs font-bold ${detail.thread.status === 'on_hold' ? 'bg-action text-on-action' : 'bg-action-soft text-action'}`}>保留</button>
                  <button onClick={() => void updateStatus('resolved')} className={`rounded-lg px-3 py-2 text-xs font-bold ${detail.thread.status === 'resolved' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}>✓ 対応済み</button>
                  {detail.thread.status === 'resolved' && <button onClick={() => void updateStatus('unread')} className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600">再オープン</button>}
                </div>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
                {detail.messages.map((message) => (
                  <div key={message.id} className={`flex ${message.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[86%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[72%] ${message.direction === 'outgoing' ? 'rounded-br-md bg-[#c9f4d8] text-gray-900' : 'rounded-bl-md bg-white text-gray-900'}`}>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body_text}</p>
                      <p className="mt-2 text-right text-[10px] text-gray-400">{dateTime(message.created_at)}{message.direction === 'outgoing' ? ' · 送信済み' : ''}</p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="border-t border-gray-200 bg-white p-4">
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void sendReply() }} placeholder="メールの返信を入力…（Ctrl/Command + Enterで送信）" rows={4} className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 outline-none focus:border-emerald-500 focus:bg-white" />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-[11px] text-gray-400">From: contact-shed@nen-petfood.com</p>
                  <button onClick={() => void sendReply()} disabled={!reply.trim() || sending} className="rounded-xl bg-accent-deep px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40">{sending ? '送信中…' : 'メールで返信'}</button>
                </div>
              </div>
            </>
          ) : <div className="flex flex-1 items-center justify-center text-sm text-gray-400">会話を読み込み中...</div>}
        </main>
      </div>
    </div>
  )
}


function ChannelAvatar({ item }: { item: InboxItem }) {
  if (item.pictureUrl) return <img src={item.pictureUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" /> // eslint-disable-line @next/next/no-img-element
  return <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs font-black text-white ${item.channel === 'line' ? 'bg-accent' : 'bg-sky-500'}`}>{item.channel === 'line' ? 'L' : '✉'}</div>
}
