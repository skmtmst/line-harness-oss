'use client'

import { useEffect, useRef, useState } from 'react'
import type { Chat, Reminder, Scenario, Tag, Template } from '@line-crm/shared'
import { api } from '@/lib/api'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'

/**
 * 1人だけ選んだときの操作（設計 `BulkBar` の6つ）。
 *
 * **6つとも「まとめて実行する口」が無いだけで、1人ぶんの口は全部ある。**
 * これまで人数によらず押せない形にしていたので、1人のときもできなかった。
 *
 *   対応状況を変える        PUT  /api/chats/<friendId>       （友だちIDで引ける）
 *   テンプレートを送る      POST /api/chats/<friendId>/send
 *   シナリオを開始          POST /api/scenarios/:id/enroll/:friendId
 *   タグを付ける・外す      POST/DELETE /api/friends/:id/tags
 *   友だち情報を書き換える  PUT  /api/friends/:id/metadata
 *   リマインダを開始        POST /api/reminders/:id/enroll/:friendId
 *
 * 2人以上のときは押せないままにする。1人ぶんの口を人数ぶん叩くと、
 * 途中で失敗したときにどこまで終わったのか分からなくなる。
 */

type Action =
  | 'status'
  | 'template'
  | 'scenario'
  | 'tag'
  | 'field'
  | 'reminder'

const LABELS: Record<Action, string> = {
  status: '対応状況を変える',
  template: 'テンプレートを送る',
  scenario: 'シナリオを開始',
  tag: 'タグを付ける・外す',
  field: '友だち情報を書き換える',
  reminder: 'リマインダを開始',
}

export default function SingleFriendActions({
  friendId,
  friendName,
  tags,
  onDone,
}: {
  friendId: string
  friendName: string
  tags: Tag[]
  onDone: () => void
}) {
  const [open, setOpen] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const run = async (fn: () => Promise<{ success: boolean; error?: string }>, done: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    const res = await fn()
    setBusy(false)
    if (!res.success) {
      setError(res.error ?? 'できませんでした')
      return
    }
    setMessage(done)
    setOpen(null)
    onDone()
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(LABELS) as Action[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => {
              setOpen(open === a ? null : a)
              setError('')
              setMessage('')
            }}
            aria-pressed={open === a}
            className={`rounded-control border px-2.5 py-1 text-xs ${
              open === a
                ? 'border-accent bg-accent-deep text-on-accent'
                : 'border-hairline bg-canvas text-ink-secondary hover:bg-canvas-sunken'
            }`}
          >
            {LABELS[a]}
          </button>
        ))}
      </div>

      {message && <p className="text-success mt-2 text-xs">{message}</p>}
      {error && <p className="text-danger mt-2 text-xs">{error}</p>}

      {open && (
        <div className="bg-canvas rounded-card border-hairline mt-2 border p-3">
          <p className="text-ink-faint mb-2 text-xs">
            {friendName} に「{LABELS[open]}」
          </p>
          {open === 'status' && <StatusPanel friendId={friendId} busy={busy} run={run} />}
          {open === 'template' && <TemplatePanel friendId={friendId} busy={busy} run={run} />}
          {open === 'scenario' && <ScenarioPanel friendId={friendId} busy={busy} run={run} />}
          {open === 'tag' && <TagPanel friendId={friendId} tags={tags} busy={busy} run={run} />}
          {open === 'field' && <FieldPanel friendId={friendId} busy={busy} run={run} />}
          {open === 'reminder' && <ReminderPanel friendId={friendId} busy={busy} run={run} />}
        </div>
      )}
    </div>
  )
}

type Run = (
  fn: () => Promise<{ success: boolean; error?: string }>,
  done: string,
) => Promise<void>

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

function Go({ busy, onClick, label = '実行' }: { busy: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="bg-accent-deep hover:brightness-92 text-on-accent rounded-control px-3 py-1.5 text-xs font-bold disabled:opacity-50"
    >
      {busy ? '実行中…' : label}
    </button>
  )
}

const SELECT =
  'border-hairline rounded-control bg-canvas text-ink border px-2 py-1.5 text-xs'

function StatusPanel({ friendId, busy, run }: { friendId: string; busy: boolean; run: Run }) {
  const [status, setStatus] = useState<Chat['status']>('resolved')
  return (
    <Row>
      <select value={status} onChange={(e) => setStatus(e.target.value as Chat['status'])} className={SELECT}>
        <option value="unread">未対応</option>
        <option value="in_progress">対応中</option>
        <option value="resolved">対応済み</option>
      </select>
      {/* 友だちIDでも引ける（resolveOrCreateChat）。トークが無い人にも当てられる。 */}
      <Go busy={busy} onClick={() => void run(() => api.chats.update(friendId, { status }), '対応状況を変えました')} />
    </Row>
  )
}

function TemplatePanel({ friendId, busy, run }: { friendId: string; busy: boolean; run: Run }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [id, setId] = useState('')
  const sendKeysRef = useRef(new IdempotencyKeyStore())
  useEffect(() => {
    void api.templates.list().then((res) => {
      if (res.success) {
        // 文字のものだけ。画像やカードは中身がJSONで、そのまま送ると文字になる。
        setTemplates((res.data as unknown as Template[]).filter((t) => t.messageType === 'text'))
      }
    })
  }, [])
  const picked = templates.find((t) => t.id === id)
  const sendPicked = async () => {
    if (!picked) return { success: false, error: 'テンプレートを選んでください' }
    const signature = JSON.stringify({ friendId, messageType: 'text', content: picked.messageContent })
    const result = await api.chats.send(
      friendId,
      { content: picked.messageContent },
      sendKeysRef.current.get(signature),
    )
    if (result.success) sendKeysRef.current.clear(signature)
    return result
  }
  return (
    <div className="space-y-2">
      <Row>
        <select value={id} onChange={(e) => setId(e.target.value)} className={SELECT}>
          <option value="">テンプレートを選ぶ</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <Go
          busy={busy || !picked}
          onClick={() =>
            picked &&
            void run(sendPicked, '送りました')
          }
          label="送る"
        />
      </Row>
      {picked && (
        <p className="bg-canvas-sunken text-ink-secondary rounded-control px-2 py-1.5 text-xs whitespace-pre-wrap">
          {picked.messageContent}
        </p>
      )}
    </div>
  )
}

function ScenarioPanel({ friendId, busy, run }: { friendId: string; busy: boolean; run: Run }) {
  const [items, setItems] = useState<Scenario[]>([])
  const [id, setId] = useState('')
  useEffect(() => {
    void api.scenarios.list().then((res) => {
      if (res.success) setItems(res.data)
    })
  }, [])
  return (
    <Row>
      <select value={id} onChange={(e) => setId(e.target.value)} className={SELECT}>
        <option value="">シナリオを選ぶ</option>
        {items.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <Go
        busy={busy || !id}
        onClick={() => void run(() => api.scenarios.enroll(id, friendId), 'シナリオを開始しました')}
        label="開始する"
      />
    </Row>
  )
}

function TagPanel({
  friendId,
  tags,
  busy,
  run,
}: {
  friendId: string
  tags: Tag[]
  busy: boolean
  run: Run
}) {
  const [id, setId] = useState('')
  return (
    <Row>
      <select value={id} onChange={(e) => setId(e.target.value)} className={SELECT}>
        <option value="">タグを選ぶ</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <Go
        busy={busy || !id}
        onClick={() => void run(() => api.friends.addTag(friendId, id), 'タグを付けました')}
        label="付ける"
      />
      <button
        type="button"
        disabled={busy || !id}
        onClick={() => void run(() => api.friends.removeTag(friendId, id), 'タグを外しました')}
        className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-1.5 text-xs disabled:opacity-50"
      >
        外す
      </button>
    </Row>
  )
}

function FieldPanel({ friendId, busy, run }: { friendId: string; busy: boolean; run: Run }) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  return (
    <Row>
      <input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="項目名"
        className={SELECT}
      />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="値"
        className={SELECT}
      />
      <Go
        busy={busy || !key.trim()}
        onClick={() =>
          void run(
            () => api.friends.updateMetadata(friendId, { [key.trim()]: value }),
            '友だち情報を書き換えました',
          )
        }
        label="書き換える"
      />
    </Row>
  )
}

function ReminderPanel({ friendId, busy, run }: { friendId: string; busy: boolean; run: Run }) {
  const [items, setItems] = useState<Reminder[]>([])
  const [id, setId] = useState('')
  // ゴール日時（予約日・開催日）。リマインダはここを起点に逆算するので、
  // これが決まらないと登録できない。以前はこの欄が無く、登録が必ず失敗していた。
  const [targetDate, setTargetDate] = useState('')
  useEffect(() => {
    void api.reminders.list().then((res) => {
      if (res.success) setItems(res.data)
    })
  }, [])
  return (
    <Row>
      <select value={id} onChange={(e) => setId(e.target.value)} className={SELECT}>
        <option value="">リマインダを選ぶ</option>
        {items.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
      <input
        type="datetime-local"
        value={targetDate}
        onChange={(e) => setTargetDate(e.target.value)}
        aria-label="ゴール日時"
        title="予約日や開催日。ここから逆算して届きます"
        className={SELECT}
      />
      <Go
        busy={busy || !id || !targetDate}
        onClick={() =>
          void run(
            // datetime-local は "2026-09-01T15:00" の形。日本時間として送る。
            () => api.reminders.enroll(id, friendId, `${targetDate}:00+09:00`),
            'リマインダを開始しました',
          )
        }
        label="開始する"
      />
    </Row>
  )
}
