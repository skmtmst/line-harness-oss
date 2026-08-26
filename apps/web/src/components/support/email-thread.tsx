'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiError, fetchApi } from '@/lib/api'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
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

type ThreadStatus = 'unread' | 'in_progress' | 'on_hold' | 'resolved'

type EmailDetail = {
  thread: {
    id: string
    subject: string
    customer_name: string | null
    customer_email: string
    status: ThreadStatus
    assigned_staff_id: string | null
    notes: string | null
    revision: number
  }
  messages: Array<{
    id: string
    direction: 'incoming' | 'outgoing'
    body_text: string
    sent_by_staff_name: string | null
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
  customerInfoOpen = false,
  onOpenCustomerInfo,
}: {
  threadId: string
  /** 状態や返信で一覧の中身が変わったときに知らせる。 */
  onChanged?: () => void
  customerInfoOpen?: boolean
  onOpenCustomerInfo?: () => void
}) {
  const [detail, setDetail] = useState<EmailDetail | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const sendKeysRef = useRef(new IdempotencyKeyStore())

  // 以下は LINE のトークに揃えるためのもの（設計 `TalkPane` / `Reply`）。
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([])
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [showComposerOptions, setShowComposerOptions] = useState(false)
  const [showMemoEditor, setShowMemoEditor] = useState(false)
  const [memoDraft, setMemoDraft] = useState('')
  const [memoSaving, setMemoSaving] = useState(false)
  const [memoError, setMemoError] = useState('')
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
        { method: 'PATCH', body: JSON.stringify({ status, revision: detail?.thread.revision }) },
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
        { method: 'PATCH', body: JSON.stringify({ staffId, revision: detail?.thread.revision }) },
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

  const sendReply = async () => {
    if (!reply.trim() || sending) return
    const content = reply.trim()
    const signature = JSON.stringify({ threadId, body: content })
    const idempotencyKey = sendKeysRef.current.get(signature)
    setSending(true)
    setError('')
    try {
      await fetchApi(`/api/support/email/threads/${encodeURIComponent(threadId)}/reply`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ body: content, revision: detail?.thread.revision }),
      })
      sendKeysRef.current.clear(signature)
      setReply('')
      await load()
      onChanged?.()
    } catch (sendError) {
      setError(
        sendError instanceof ApiError && sendError.status === 409
          ? '二重送信を避けるため送信を止めました。会話を読み直し、他担当者の返信と送信履歴を確認してください'
          : '返信を送れませんでした',
      )
    } finally {
      setSending(false)
    }
  }

  const openMemoEditor = () => {
    setMemoDraft(detail?.thread.notes ?? '')
    setMemoError('')
    setShowMemoEditor(true)
  }

  const closeMemoEditor = () => {
    setMemoDraft(detail?.thread.notes ?? '')
    setMemoError('')
    setShowMemoEditor(false)
  }

  const saveMemo = async () => {
    if (!detail || memoSaving) return
    setMemoSaving(true)
    setMemoError('')
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(
        `/api/support/email/threads/${encodeURIComponent(threadId)}/notes`,
        { method: 'PATCH', body: JSON.stringify({ notes: memoDraft, revision: detail.thread.revision }) },
      )
      if (!res.success) {
        setMemoError(res.error || '内部メモを保存できませんでした')
        return
      }
      setDetail((current) => current ? {
        ...current,
        thread: { ...current.thread, notes: memoDraft || null },
      } : current)
      setShowMemoEditor(false)
      onChanged?.()
    } catch {
      setMemoError('内部メモを保存できませんでした')
    } finally {
      setMemoSaving(false)
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
      <div className="flex min-h-[66px] items-center justify-between gap-2 border-b border-[#E5E7EB] bg-canvas px-4 py-3">
        <div className="min-w-0">
          <p className="text-ink truncate text-sm font-medium">{detail.thread.subject}</p>
          <p className="text-ink-faint mt-0.5 truncate text-xs">
            {detail.thread.customer_name || detail.thread.customer_email} ・ メール
          </p>
        </div>
        {/* LINE のトークと同じ並び：対応 ・ 担当 ・ 顧客情報。 */}
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
              <option value="on_hold">保留</option>
              <option value="resolved">対応済</option>
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
          {!customerInfoOpen && onOpenCustomerInfo && (
            <button
              type="button"
              onClick={onOpenCustomerInfo}
              className="whitespace-nowrap rounded-lg border border-[#E5E7EB] bg-canvas px-2.5 py-1.5 text-xs font-semibold text-[#2563EB] hover:bg-[#F7F8F6]"
            >
              顧客情報を開く
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto bg-[#F7F8F6] p-4">
        {detail.messages.map((message) => (
          <div key={message.id} className={`flex items-end gap-2 ${message.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[86%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[72%] ${
                message.direction === 'outgoing'
                  ? 'rounded-br-md bg-[#c9f4d8] text-ink'
                  : 'rounded-bl-md bg-canvas text-ink'
              }`}
            >
              <p className="text-sm leading-6 break-words whitespace-pre-wrap">{message.body_text}</p>
              <p className="mt-2 text-right text-[10px] text-ink-faint">
                {dateTime(message.created_at)}
                {message.direction === 'outgoing' ? ' ・ 送信済み' : ''}
              </p>
            </div>
            {message.direction === 'outgoing' && (
              <div className="flex w-12 shrink-0 flex-col items-center">
                <div
                  className="bg-action text-on-action flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold"
                  title={message.sent_by_staff_name ?? '担当者情報なし'}
                >
                  {(message.sent_by_staff_name ?? '担').charAt(0)}
                </div>
                <span className="text-ink-faint mt-1 w-full truncate text-center text-[9px]">
                  {message.sent_by_staff_name ?? '担当者'}
                </span>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div data-inbox-v4="composer" className="sticky bottom-0 border-t border-[#E5E7EB] bg-canvas px-4 py-3">
        {/* 上段。LINE のトークと同じ：テンプレートを選択 ・ 送信の設定 …… 改行のしかた */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTemplatePicker(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-canvas px-3 py-2 text-xs font-semibold text-[#2563EB] hover:bg-[#F7F8F6]"
            >
              ▧ テンプレートを選択
            </button>
            <button
              type="button"
              onClick={() => setShowComposerOptions(v => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-canvas px-3 py-2 text-xs font-semibold text-[#2563EB] hover:bg-[#F7F8F6]"
            >
              ⚙ {showComposerOptions ? '送信の設定を閉じる' : '送信の設定'}
            </button>
            <button
              type="button"
              onClick={openMemoEditor}
              aria-expanded={showMemoEditor}
              className="inline-flex items-center rounded-lg border border-[#E5E7EB] bg-canvas px-3 py-2 text-xs font-semibold text-[#344054] hover:bg-[#F7F8F6]"
            >
              内部メモ
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

        {showMemoEditor && typeof document !== 'undefined' && createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#101828]/45 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="email-internal-memo-title"
            onClick={closeMemoEditor}
          >
            <div
              className="w-full max-w-lg rounded-[14px] border border-[#E5E7EB] bg-canvas shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-[#E5E7EB] px-5 py-4">
                <div>
                  <h2 id="email-internal-memo-title" className="text-ink text-base font-bold">内部メモ</h2>
                  <p className="text-ink-faint mt-1 text-xs">担当者だけに表示され、相手には送信されません。</p>
                </div>
              </div>
              <div className="px-5 py-4">
                <label htmlFor="email-internal-memo" className="text-xs font-semibold text-[#667085]">メモ内容</label>
                <textarea
                  id="email-internal-memo"
                  value={memoDraft}
                  onChange={(event) => setMemoDraft(event.target.value)}
                  rows={7}
                  autoFocus
                  placeholder="メモを追加"
                  className="mt-2 w-full resize-y rounded-lg border border-[#D0D5DD] bg-canvas px-3 py-2 text-sm leading-6 outline-none focus:border-[#06C755] focus:ring-2 focus:ring-[#06C755]/15"
                />
                {memoError && <p className="text-danger mt-1 text-xs">{memoError}</p>}
              </div>
              <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4">
                <button type="button" onClick={closeMemoEditor} className="rounded-lg border border-[#E5E7EB] bg-canvas px-4 py-2 text-sm font-semibold text-[#667085] hover:bg-[#F7F8F6]">キャンセル</button>
                <button
                  type="button"
                  onClick={() => void saveMemo()}
                  disabled={memoSaving || memoDraft === (detail.thread.notes ?? '')}
                  className="rounded-lg bg-[#06C755] px-4 py-2 text-sm font-semibold text-on-accent hover:bg-[#05B94F] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {memoSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

        {error && <p className="text-danger mb-2 text-xs">{error}</p>}
        <div className="rounded-[10px] border border-[#D0D5DD] bg-canvas p-2 focus-within:border-[#06C755] focus-within:ring-2 focus-within:ring-[#06C755]/15">
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
            className="w-full resize-none border-0 px-1 py-1 text-sm outline-none"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-ink-faint text-xs">
              差出人 contact-shed@nen-petfood.com
            </span>
            <button
              onClick={() => void sendReply()}
              disabled={!reply.trim() || sending}
              className="rounded-lg bg-[#06C755] px-5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-[#05B94F] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? '送信中...' : 'メールで返信'}
            </button>
          </div>
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
