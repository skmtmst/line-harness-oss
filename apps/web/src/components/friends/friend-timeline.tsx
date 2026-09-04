'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchApi } from '@/lib/api'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import TemplatePicker from '@/components/chats/template-picker'

/**
 * 友だち詳細のタイムライン（設計 V2 2-2-1 の右カラム）。
 *
 * これまで会話は受信箱だけにあり、詳細画面からは「個別トークを開く」で
 * 飛ばしていた。同じ人を見るのに画面を行き来することになるので、
 * 設計どおりここで読めて返せるようにする。
 *
 * 取得も送信も友だちIDのまま扱える口があるので、受信箱のチャットIDは
 * 経由しない。
 */

interface MessageLog {
  id: string
  direction: 'incoming' | 'outgoing'
  messageType: string
  content: string
  createdAt: string
}

/** 絞り込み。★は印の仕組みがまだ無いので押せない形で置く。 */
const FILTERS = [
  { key: 'all', label: '全件' },
  { key: 'starred', label: '★のみ', disabled: true },
  { key: 'incoming', label: '受信' },
  { key: 'outgoing', label: '送信' },
  { key: 'system', label: 'システム通知' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

/** システムが自動で残した行か。人のやり取りと分けて読む。 */
function isSystem(msg: MessageLog): boolean {
  return msg.messageType === 'system' || msg.messageType === 'notification'
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const same =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  if (same) return '今日'
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

/** 本文。テキスト以外は種類だけ出す。中身の描き分けは受信箱側が持っている。 */
function bodyText(msg: MessageLog): string {
  if (msg.messageType === 'text') return msg.content
  if (msg.messageType === 'sticker') return '[スタンプ]'
  if (msg.messageType === 'image') return '[画像]'
  if (msg.messageType === 'flex') return '[Flex メッセージ]'
  return `[${msg.messageType}]`
}

export default function FriendTimeline({ friendId }: { friendId: string }) {
  const [messages, setMessages] = useState<MessageLog[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  // 二重送信よけ。押しっぱなしと Enter の連打の両方を止める。
  const sendLock = useRef(false)
  const sendKeysRef = useRef(new IdempotencyKeyStore())
  const isComposing = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: MessageLog[] }>(
        `/api/friends/${friendId}/messages`,
      )
      if (res.success) setMessages(res.data)
    } catch {
      setError('やり取りを読み込めませんでした')
    } finally {
      setLoading(false)
    }
  }, [friendId])

  useEffect(() => {
    void load()
  }, [load])

  const send = async () => {
    if (!text.trim() || sending || sendLock.current) return
    const content = text.trim()
    const signature = JSON.stringify({ friendId, messageType: 'text', content })
    const idempotencyKey = sendKeysRef.current.get(signature)
    sendLock.current = true
    setSending(true)
    setError('')
    try {
      await fetchApi(`/api/friends/${friendId}/messages`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ content, messageType: 'text' }),
      })
      sendKeysRef.current.clear(signature)
      // 送った直後は自分の画面にだけ足す。読み直すと往復が1回増える。
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          direction: 'outgoing',
          messageType: 'text',
          content,
          createdAt: new Date().toISOString(),
        },
      ])
      setText('')
    } catch {
      setError('送信できませんでした')
    } finally {
      setSending(false)
      sendLock.current = false
    }
  }

  const shown = messages.filter((m) => {
    if (filter === 'all') return true
    if (filter === 'system') return isSystem(m)
    if (filter === 'incoming') return m.direction === 'incoming' && !isSystem(m)
    if (filter === 'outgoing') return m.direction === 'outgoing' && !isSystem(m)
    return true
  })

  let lastDay = ''

  return (
    <div className="bg-canvas rounded-card border-hairline flex min-h-[32rem] flex-col border">
      {/* 絞り込み */}
      <div className="border-hairline flex flex-wrap items-center gap-1 border-b px-4 py-2.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            disabled={'disabled' in f && f.disabled}
            title={'disabled' in f && f.disabled ? '印を付ける仕組みは準備中です' : undefined}
            onClick={() => setFilter(f.key)}
            className={`rounded-pill px-3 py-1 text-xs font-medium transition-colors ${
              'disabled' in f && f.disabled
                ? 'text-ink-faint opacity-50'
                : filter === f.key
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-secondary hover:bg-canvas-sunken'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 本体 */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <p className="text-ink-faint text-center text-sm">読み込み中...</p>
        ) : shown.length === 0 ? (
          <p className="text-ink-faint text-center text-sm">
            {messages.length === 0 ? 'やり取りはまだありません' : 'この絞り込みに当てはまるものはありません'}
          </p>
        ) : (
          shown.map((msg) => {
            const day = dayLabel(msg.createdAt)
            const newDay = day !== lastDay
            lastDay = day
            return (
              <div key={msg.id}>
                {newDay && (
                  <div className="my-3 flex items-center gap-3">
                    <div className="border-hairline flex-1 border-t" />
                    <span className="text-ink-faint text-xs">{day}</span>
                    <div className="border-hairline flex-1 border-t" />
                  </div>
                )}
                {isSystem(msg) ? (
                  // システムの行は吹き出しにしない。誰かの発言に見える。
                  <p className="text-ink-faint text-center text-xs">
                    {bodyText(msg)} <span className="ml-1">{timeLabel(msg.createdAt)}</span>
                  </p>
                ) : (
                  <div
                    className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className="max-w-[75%]">
                      <div
                        className={`rounded-card px-4 py-2 text-sm whitespace-pre-wrap break-words ${
                          msg.direction === 'outgoing'
                            ? 'bg-accent-soft text-ink'
                            : 'bg-canvas-sunken text-ink'
                        }`}
                      >
                        {bodyText(msg)}
                      </div>
                      <p
                        className={`text-ink-faint mt-1 text-[11px] ${
                          msg.direction === 'outgoing' ? 'text-right' : ''
                        }`}
                      >
                        {timeLabel(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 入力（設計は3段。上に選択、中に本文、下に注記と送信） */}
      <div className="border-hairline border-t px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowTemplates(true)}
            className="text-accent text-xs hover:underline"
          >
            テンプレートを選択
          </button>
          <span className="text-ink-faint text-xs">Shift + Enter で改行</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => {
            isComposing.current = true
          }}
          onCompositionEnd={() => {
            isComposing.current = false
          }}
          onKeyDown={(e) => {
            // 変換の確定で送らない。日本語では Enter が確定にも使われる。
            if (e.key === 'Enter' && !e.shiftKey && !isComposing.current) {
              e.preventDefault()
              void send()
            }
          }}
          rows={2}
          placeholder="メッセージを入力"
          aria-label="メッセージを入力"
          className="border-hairline rounded-control w-full resize-none border px-3 py-2 text-sm focus:outline-none"
        />
        {error && <p className="text-danger mt-1 text-xs">{error}</p>}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-ink-faint text-xs">画像は JPEG / PNG、1枚 10MB まで</span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !text.trim()}
            className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-5 py-2 text-sm font-medium disabled:opacity-40"
          >
            {sending ? '送信中...' : '送信'}
          </button>
        </div>
      </div>

      <TemplatePicker
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onPick={(content) => {
          setText((prev) => (prev ? `${prev}\n${content}` : content))
          setShowTemplates(false)
        }}
      />
    </div>
  )
}
