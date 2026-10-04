'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import StatusBadge from '@/components/shared/status-badge'
import { RowActions } from '@/components/shared/row-actions'
import { Tr, Td } from '@/components/shared/table'
import { webinarApi, type WebinarSessionCapacity } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'

export default function ScheduledSessionRow({ webinarId, startAt, canEdit, busy, onDuplicate, onRemove, onEditingChange }: {
  webinarId: string
  startAt: number
  canEdit: boolean
  busy: boolean
  onDuplicate: () => void
  onRemove: () => void
  onEditingChange: (editing: boolean) => void
}) {
  const [session, setSession] = useState<WebinarSessionCapacity | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const date = formatDateTime(startAt * 1000)
  useEffect(() => {
    let active = true
    setSession(undefined); setError('')
    void webinarApi.webinarSession(webinarId, startAt).then((response) => {
      if (active) setSession(response.data.session)
    }).catch(() => { if (active) setError('開催回を読み込めませんでした。') })
    return () => { active = false }
  }, [webinarId, startAt, attempt])
  useEffect(() => {
    onEditingChange(editing)
    return () => onEditingChange(false)
  }, [editing, onEditingChange])

  const save = useCallback(async () => {
    if (!canEdit || busy || savingRef.current) return
    const capacity = input.trim() === '' ? null : Number(input)
    if (capacity !== null && (!Number.isSafeInteger(capacity) || capacity < 1)) {
      setError('定員は1人以上の整数で入力してください。空にすると無制限です。'); return
    }
    savingRef.current = true
    setSaving(true); setError('')
    try {
      const response = await webinarApi.setSessionCapacity(webinarId, startAt, capacity)
      setSession(response.data.session); setEditing(false)
    } catch { setError('定員を保存できませんでした。入力は残しています。もう一度お試しください。') }
    finally { savingRef.current = false; setSaving(false) }
  }, [canEdit, busy, input, webinarId, startAt])

  return (
    <Tr>
      <Td><span className="block truncate text-xs" title={date}>{date}</span></Td>
      <Td>
        {editing ? <div className="space-y-2">
          <input aria-label={`${date}の定員（人）`} inputMode="numeric" value={input} onChange={(event) => setInput(event.target.value)} disabled={saving} placeholder="無制限" className="border-hairline text-ink w-full rounded-control border px-2 py-1 text-xs" />
          <div className="flex flex-wrap gap-1"><Button size="compact" onClick={() => void save()} disabled={saving} busy={saving}>定員を保存</Button><Button size="compact" onClick={() => { setEditing(false); setError('') }} disabled={saving}>やめる</Button></div>
        </div> : <span className="whitespace-nowrap text-xs">{session === undefined ? '—' : session?.capacity == null ? '無制限' : `${formatNumber(session.capacity)}人`}</span>}
        {error ? <div role="alert" className="text-ink-secondary mt-2 text-xs">{error}{session === undefined ? <Button size="compact" onClick={() => setAttempt((n) => n + 1)}>もう一度読み込む</Button> : null}</div> : null}
      </Td>
      <Td align="right"><span className="whitespace-nowrap text-xs">{session ? `${formatNumber(session.reservedCount)}人` : '—'}</span></Td>
      <Td><StatusBadge tone={session?.state === 'full' ? 'warning' : session?.state === 'open' ? 'info' : 'neutral'}>{session === undefined ? error ? '取得できません' : '確認中' : session === null ? '定員未設定' : session.state === 'closed' ? '受付終了' : session.state === 'full' ? '満員' : session.remaining === null ? '受付中' : `残り ${formatNumber(session.remaining)}人`}</StatusBadge></Td>
      <Td><RowActions subjectName={`${date}の開催回`} menuItems={[
        { id: 'capacity', label: '定員を変える', disabled: !canEdit || busy || saving || session === undefined, disabledReason: !canEdit ? '変更はオーナーか管理者に依頼してください' : undefined, onSelect: () => { setInput(session?.capacity == null ? '' : String(session.capacity)); setError(''); setEditing(true) } },
        { id: 'duplicate', label: '複製する', disabled: !canEdit || busy || saving || editing, onSelect: onDuplicate },
        { id: 'remove', label: '消す', disabled: !canEdit || busy || saving || editing, onSelect: onRemove },
      ]} /></Td>
    </Tr>
  )
}
