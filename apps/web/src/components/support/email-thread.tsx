'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchApi } from '@/lib/api'
import TemplatePicker from '@/components/chats/template-picker'

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
    assigned_staff_id: string | null
    notes: string | null
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

  // 以下は LINE のトークに揃えるためのもの（設計 `TalkPane` / `Reply`）。
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([])
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [showComposerOptions, setShowComposerOptions] = useState(false)
  /** 送信キー。LINE 側と同じ設定を読む。別々にすると片方だけ効かない。 */
  const [sendMode, setSendMode] = useState<'enter' | 'shift-enter'>('shift-enter')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('chat.sendMode')
      if (saved === 'enter' || saved === 'shift-enter') setSendMode(saved)
    } catch {
      /* 保存できない設定のブラウザは既定のまま */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>(
      '/api/operators',
    )
      .then(res => {
        // 担当を選べないだけ。返信そのものは続けられる。
        if (!cancelled && res.success) setOperators(res.data)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(
    async (quiet = false) => {
      try {
        const res = await fetchApi<{ success: boolean; data: EmailDetail }>(
          `/api/support/email/threads/${encodeURIComponent(threadId)}`,
        )
        if (res.success) {
          setDetail(res.data)
          // 入力中に5秒ごとの取り直しで消えないよう、空のときだけ入れる。
          setNotes(prev => (prev === '' ? (res.data.thread.notes ?? '') : prev))
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

  /**
   * 対応の状態を変える。
   *
   * **ここは動いていなかった。** worker は PATCH でしか受けていないのに
   * POST を投げていて、変えても何も起きないうえ、戻り値を見ていないので
   * 失敗も画面に出なかった。経路を合わせ、失敗を出すようにした。
   */
  const updateStatus = async (status: ThreadStatus) => {
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/support/email/threads/${encodeURIComponent(threadId)}/status`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      )
      if (!res.success) {
        setError(res.error || '状態を変えられませんでした')
        return
      }
      setError('')
      await load(true)
      onChanged?.()
    } catch {
      setError('状態を変えられませんでした')
    }
  }

  /** 担当を付け替える（LINE のトークと同じ）。 */
  const updateAssignee = async (staffId: string | null) => {
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/support/email/threads/${encodeURIComponent(threadId)}/assignee`,
        { method: 'PATCH', body: JSON.stringify({ staffId }) },
      )
      if (!res.success) {
        setError(res.error || '担当を変えられませんでした')
        return
      }
      setError('')
      await load(true)
      onChanged?.()
    } catch {
      setError('担当を変えられませんでした')
    }
  }

  const saveNotes = async () => {
    setSavingNotes(true)
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/support/email/threads/${encodeURIComponent(threadId)}/notes`,
        { method: 'PATCH', body: JSON.stringify({ notes }) },
      )
      if (!res.success) setError(res.error || 'メモを保存できませんでした')
      else setError('')
    } catch {
      setError('メモを保存できませんでした')
    } finally {
      setSavingNotes(false)
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
        {/* LINE のトークと同じ並び：対応 ・ 担当。
            「友だち詳細」はここには置けない。メールは差出人のアドレスしか
            分からず、LINEの友だちと結びついていない（どの項目で突き合わせるかが
            未決。docs/v025-design-pass-day1.md の5番）。 */}
        <div className="flex flex-wrap items-center justify-end gap-3">
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
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-ink-faint">担当</span>
            <select
              value={detail.thread.assigned_staff_id ?? ''}
              onChange={(e) => void updateAssignee(e.target.value || null)}
              className="border-hairline rounded-control focus:ring-accent border px-2 py-1 text-xs focus:ring-2 focus:outline-none"
            >
              <option value="">未割り当て</option>
              {operators.map(op => (
                <option key={op.id} value={op.id}>
                  {op.name}
                </option>
              ))}
            </select>
          </label>
        </div>
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

      {/* メモ。LINE のトークと同じ位置・同じ形（114 で列を足した）。 */}
      <div className="border-hairline bg-canvas-sunken border-t px-4 py-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="メモを入力..."
            className="border-hairline bg-canvas focus:ring-accent flex-1 rounded-md border px-2 py-1 text-xs focus:ring-1 focus:outline-none"
          />
          <button
            onClick={() => void saveNotes()}
            disabled={savingNotes}
            className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {savingNotes ? '保存中...' : 'メモ保存'}
          </button>
        </div>
      </div>

      <div className="border-hairline border-t px-4 py-3">
        {/* 上段。LINE のトークと同じ：テンプレートを選択 ・ 送信の設定 …… 改行のしかた */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowTemplatePicker(true)}
              className="text-accent text-xs hover:underline"
            >
              テンプレートを選択
            </button>
            <button
              type="button"
              onClick={() => setShowComposerOptions(v => !v)}
              className="text-accent text-xs hover:underline"
            >
              {showComposerOptions ? '送信の設定を閉じる' : '送信の設定'}
            </button>
          </div>
          <span className="text-ink-faint text-xs">
            {sendMode === 'enter' ? 'Shift + Enter で改行' : 'Enter で改行'}
          </span>
        </div>

        {showComposerOptions && (
          <div className="bg-canvas-sunken rounded-card mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-xs">
            <span className="text-ink-secondary">送信キー</span>
            {(
              [
                { value: 'enter', label: 'Enter で送信' },
                { value: 'shift-enter', label: 'Shift + Enter で送信' },
              ] as const
            ).map(opt => (
              <label key={opt.value} className="inline-flex cursor-pointer items-center gap-1.5 select-none">
                <input
                  type="radio"
                  name="mail-send-mode"
                  checked={sendMode === opt.value}
                  onChange={() => {
                    setSendMode(opt.value)
                    // LINE 側と同じ設定を書く。別々にすると片方だけ効かない。
                    try {
                      localStorage.setItem('chat.sendMode', opt.value)
                    } catch {
                      /* 保存できないブラウザはこの画面のあいだだけ効く */
                    }
                  }}
                />
                <span className="text-ink-secondary">{opt.label}</span>
              </label>
            ))}
            <span className="text-ink-faint">Ctrl / Command + Enter でも送れます</span>
          </div>
        )}

        {error && <p className="text-danger mb-2 text-xs">{error}</p>}
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault()
              void sendReply()
              return
            }
            // LINE 側と同じ判定。enter は Enter 単体で送信、
            // shift-enter は Shift + Enter で送信。
            const shouldSend = sendMode === 'enter' ? !e.shiftKey : e.shiftKey
            if (shouldSend) {
              e.preventDefault()
              void sendReply()
            }
          }}
          placeholder="メールの返信を入力"
          aria-label="メールの返信を入力"
          rows={3}
          className="border-hairline rounded-control focus:ring-accent w-full resize-none border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-ink-faint text-xs">
            差出人 contact-shed@nen-petfood.com
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

      {/* 選ぶと本文が入力欄に入る。送る前に直せる（LINE 側と同じ部品）。 */}
      <TemplatePicker
        open={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
        onPick={(content) => {
          setReply((prev) => (prev ? `${prev}\n${content}` : content))
          setShowTemplatePicker(false)
        }}
      />
    </>
  )
}
