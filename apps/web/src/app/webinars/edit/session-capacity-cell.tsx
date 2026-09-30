'use client'

import { useCallback, useEffect, useState } from 'react'
import { webinarApi, type WebinarSessionCapacity } from '@/lib/api'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'

/**
 * N: 開催回の定員を見る・決める。定員は申込の時に確保し、満員なら申込を受けない。
 * 行が無い開催回（定めていない）は「—」で、従来どおり無制限。
 */
export default function SessionCapacityCell({
  webinarId,
  sessionStartAt,
}: {
  webinarId: string
  sessionStartAt: number
}) {
  const [session, setSession] = useState<WebinarSessionCapacity | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await webinarApi.webinarSession(webinarId, sessionStartAt)
      setSession(res.data.session)
    } catch {
      setSession(undefined)
    }
  }, [webinarId, sessionStartAt])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    const trimmed = input.trim()
    const capacity = trimmed === '' ? null : Math.floor(Number(trimmed))
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
      setError('定員は1人以上で入力してください。空にすると無制限に戻ります。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await webinarApi.setSessionCapacity(webinarId, sessionStartAt, capacity)
      setSession(res.data.session)
      setEditing(false)
    } catch {
      setError('定員を保存できませんでした。権限を確認してください。')
    } finally {
      setBusy(false)
    }
  }

  if (session === undefined) return <span className="text-ink-faint">—</span>

  if (!editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span className="text-ink-secondary">
          {session === null || session.capacity === null
            ? '—'
            : session.state === 'full'
              ? `満員（定員${session.capacity}人）`
              : `残り${session.remaining ?? 0}人／定員${session.capacity}人`}
        </span>
        <button
          type="button"
          onClick={() => {
            setInput(session?.capacity === null || session === null ? '' : String(session.capacity))
            setError('')
            setEditing(true)
          }}
          className="font-medium underline"
          aria-label="定員を決める"
        >
          定員
        </button>
        <HelpTip label="定員の説明">
          申込の時に席を確保し、満員になると申込を受け付けません。空にすると無制限に戻ります。
        </HelpTip>
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <label className="inline-flex items-center gap-1">
        <span className="sr-only">定員（人）。空で無制限</span>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          inputMode="numeric"
          placeholder="無制限"
          className="border-hairline text-ink w-20 rounded-control border px-2 py-1 text-xs"
        />
      </label>
      <Button onClick={() => void save()} disabled={busy}>
        {busy ? '保存中…' : '保存する'}
      </Button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs underline">
        キャンセル
      </button>
      {error ? (
        <span className="text-danger w-full text-xs" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}
