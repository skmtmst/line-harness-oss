'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchApi } from '@/lib/api'

/**
 * メールの往復。受信箱（/chats）の中央ペインで使う。
 *
 * 以前はメール専用の画面の中にしか無かったので、一覧からメールを選ぶと
 * いったんメール画面へ移動する必要があった。LINEのトークは同じ画面で
 * 開けるのに、メールだけ移動が要るのは扱いが揃っていない。
 *
 * 部品にして、LINEのトークと同じ場所に出せるようにした。
 */

type ThreadStatus = 'unread' | 'in_progress' | 'resolved'

type EmailDetail = {
  thread: {
    id: string
    subject: string
    customer_name: string | null
    customer_email: string
    status: ThreadStatus
  }
  messages: Array<{
    id: string
    direction: 'incoming' | 'outgoing'
    body_text: string
    created_at: string
  }>
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function EmailThread({
  threadId,
  onChanged,
}: {
  threadId: string
  /** 状態や返信で一覧の中身が変わったときに知らせる。 */
  onChanged?: () => void
}) {
  const [detail, setDetail] = useState<EmailDetail | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(
    async (quiet = false) => {
      try {
        const res = await fetchApi<{ success: boolean; data: EmailDetail }>(
          `/api/support/email/threads/${encodeURIComponent(threadId)}`,
        )
        if (res.success) {
          setDetail(res.data)
          if (!quiet) {
            window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
          }
        }
      } catch {
        setError('メールの会話を読み込めませんでした')
      }
    },
    [threadId],
  )

  useEffect(() => {
    setDetail(null)
    setReply('')
    void load()
    // 相手からの返信が届いたら出したい。5秒ごとに静かに取り直す。
    const timer = window.setInterval(() => void load(true), 5_000)
    return () => window.clearInterval(timer)
  }, [load])

  const updateStatus = async (status: ThreadStatus) => {
    try {
      await fetchApi(`/api/support/email/threads/${encodeURIComponent(threadId)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      })
      await load(true)
      onChanged?.()
    } catch {
      setError('状態を変えられませんでした')
    }
  }

  const sendReply = async () => {
    if (!reply.trim() || sending) return
    setSending(true)
    setError('')
    try {
      await fetchApi(`/api/support/email/threads/${encodeURIComponent(threadId)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ body: reply }),
      })
      setReply('')
      await load()
      onChanged?.()
    } catch {
      setError('返信を送れませんでした')
    } finally {
      setSending(false)
    }
  }

  if (!detail) {
    return (
      <div className="text-ink-faint flex flex-1 items-center justify-center text-sm">
        {error || '会話を読み込み中...'}
      </div>
    )
  }

  return (
    <>
      <div className="border-hairline flex items-center justify-between gap-2 border-b px-4 py-4">
        <div className="min-w-0">
          <p className="text-ink truncate text-sm font-medium">{detail.thread.subject}</p>
          <p className="text-ink-faint mt-0.5 truncate text-xs">
            {detail.thread.customer_name || detail.thread.customer_email} ・ メール
          </p>
        </div>
        {/* LINE側と同じく「対応」を選ぶ形にする。ボタンを3つ並べると
            いまどの状態かが読み取りにくい。 */}
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-ink-faint">対応</span>
          <select
            value={detail.thread.status}
            onChange={(e) => void updateStatus(e.target.value as ThreadStatus)}
            className="border-hairline rounded-control focus:ring-accent border px-2 py-1 text-xs focus:ring-2 focus:outline-none"
          >
            <option value="unread">未対応</option>
            <option value="in_progress">対応中</option>
            <option value="resolved">解決済</option>
          </select>
        </label>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {detail.messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[86%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[72%] ${
                message.direction === 'outgoing'
                  ? 'rounded-br-md bg-[#c9f4d8] text-gray-900'
                  : 'rounded-bl-md bg-white text-gray-900'
              }`}
            >
              <p className="text-sm leading-6 break-words whitespace-pre-wrap">{message.body_text}</p>
              <p className="mt-2 text-right text-[10px] text-gray-400">
                {dateTime(message.created_at)}
                {message.direction === 'outgoing' ? ' ・ 送信済み' : ''}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-hairline border-t px-4 py-3">
        {error && <p className="text-danger mb-2 text-xs">{error}</p>}
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendReply()
          }}
          placeholder="メールの返信を入力"
          aria-label="メールの返信を入力"
          rows={3}
          className="border-hairline rounded-control focus:ring-accent w-full resize-none border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-ink-faint text-xs">
            Ctrl / Command + Enter で送信 ・ 差出人 contact-shed@nen-petfood.com
          </span>
          <button
            onClick={() => void sendReply()}
            disabled={!reply.trim() || sending}
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-5 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? '送信中...' : 'メールで返信'}
          </button>
        </div>
      </div>
    </>
  )
}
