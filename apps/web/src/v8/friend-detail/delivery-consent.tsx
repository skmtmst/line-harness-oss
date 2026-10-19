'use client'

import { RadioGroup } from '@/components/shared/radio'

import Card from '@/components/shared/card'

import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Drawer from '@/components/shared/drawer'
import { Field } from '@/components/shared/form-controls'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import Radio from '@/components/shared/radio'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { notifySaved } from '@/components/shared/toast'
import { friendDeliveryConsentHistoryApi, friendDeliveryConsentsApi, type FriendDeliveryConsent, type FriendDeliveryConsentEvent } from '@/lib/api/helpers/friend-delivery-consents'
import { SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import styles from './delivery-consent.module.css'

/*
 * ★V8 友だち詳細「配信の受け取り」（E9-1 `mAbif`）。目的ごと（予約の連絡・お知らせ・キャンペーン・宣伝・アンケート）に、
 * 届けてよいかを「受け取る／止めている／不明」で記録する。理由は必須。
 * 本人が止めた宣伝を店が「受け取る」へ戻すときは、注意の窓を挟む（本人の意思を店が上書きするため）。
 * 変えられるのはオーナー・管理者だけ（閲覧のみの人には［変える］を置かない）。
 */
const PURPOSES: Array<{ key: string; label: string; note: string }> = [
  { key: 'transaction', label: '予約の連絡', note: '前日・当日の案内、変更・取り消しの知らせ' },
  { key: 'notice', label: 'お知らせ', note: 'お店からの大事なお知らせ' },
  { key: 'marketing', label: 'キャンペーン・宣伝', note: 'クーポン・新しいメニューの案内' },
  { key: 'survey', label: 'アンケート', note: '来店後のアンケート' },
]
const STATE_LABEL: Record<FriendDeliveryConsent['state'], string> = { granted: '受け取る', revoked: '止めている', unknown: '不明' }
const STATE_TONE: Record<FriendDeliveryConsent['state'], 'success' | 'danger' | 'neutral'> = { granted: 'success', revoked: 'danger', unknown: 'neutral' }
const STATES: FriendDeliveryConsent['state'][] = ['granted', 'revoked', 'unknown']

const md = (value: string) => `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))} ${value.slice(11, 16)}`
const ACTOR: Record<FriendDeliveryConsentEvent['actor']['kind'], string> = { self: '本人', store: '店', system: 'システム', unknown: '不明' }
const stateOf = (side: FriendDeliveryConsentEvent['before']) => (side ? STATE_LABEL[side.state] : '—')
const bySelf = (row: FriendDeliveryConsent | undefined) => Boolean(row && row.source !== 'manual')

export function useDeliveryConsents(friendId: string) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [rows, setRows] = useState<FriendDeliveryConsent[]>([])
  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const response = await friendDeliveryConsentsApi.list(friendId)
      if (!response.success) throw new Error('consents_failed')
      setRows(Array.isArray(response.data) ? response.data : [])
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [friendId])
  useEffect(() => { void load() }, [load])
  return { status, rows, reload: load }
}

/** 左の要点の1段：宣伝の受け取りを1行で。 */
export function DeliveryConsentSummary({ status, rows }: { status: 'loading' | 'ready' | 'error'; rows: FriendDeliveryConsent[] }) {
  if (status === 'loading') return <p className={styles.faint}>読み込んでいます</p>
  if (status === 'error') return <p className={styles.faint}>読み込めませんでした</p>
  const marketing = rows.find((row) => row.purpose === 'marketing')
  return <p className={styles.summary}>{`キャンペーン・宣伝：${STATE_LABEL[marketing?.state ?? 'unknown']}`}</p>
}

export default function DeliveryConsentDrawer({ open, friendId, friendName, rows, canEdit, onClose, onSaved }: {
  open: boolean
  friendId: string
  friendName: string
  rows: FriendDeliveryConsent[]
  canEdit: boolean
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [next, setNext] = useState<FriendDeliveryConsent['state']>('granted')
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [warn, setWarn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const errors = useSaveFormErrors()
  const [events, setEvents] = useState<FriendDeliveryConsentEvent[] | null>(null)
  const [historyFailed, setHistoryFailed] = useState(false)
  const loadHistory = useCallback(async () => {
    try {
      const response = await friendDeliveryConsentHistoryApi.list(friendId, { limit: 20 })
      if (!response.success) throw new Error('history_failed')
      setEvents(Array.isArray(response.data?.items) ? response.data.items : [])
      setHistoryFailed(false)
    } catch {
      setHistoryFailed(true)
    }
  }, [friendId])
  useEffect(() => { if (open) void loadHistory() }, [open, loadHistory])

  const rowOf = (key: string) => rows.find((row) => row.purpose === key)
  const begin = (key: string) => {
    setEditing(key); setNext(rowOf(key)?.state ?? 'unknown'); setReason(''); setReasonError(''); setError('')
  }

  const commit = async () => {
    if (!editing) return
    setBusy(true); setError('')
    try {
      const current = rowOf(editing)
      const response = await friendDeliveryConsentsApi.save(friendId, editing, { state: next, reason: reason.trim(), expectedVersion: current?.version ?? 0 })
      if (!response.success) throw new Error('save_failed')
      notifySaved('配信の受け取りを保存しました。')
      setWarn(false); setEditing(null)
      await onSaved()
      await loadHistory()
    } catch (reason) {
      setWarn(false)
      if (!errors.capture(reason)) setError('保存できませんでした。ほかの人が先に変えたかもしれません。読み直したので、もう一度お試しください。')
      await onSaved()
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    if (!reason.trim()) { setReasonError('理由を入れてください。'); return }
    const current = editing ? rowOf(editing) : undefined
    /* 本人が止めた宣伝を、店が受け取るへ戻すときだけ注意の窓。 */
    if (editing === 'marketing' && current?.state === 'revoked' && next === 'granted' && bySelf(current)) { setWarn(true); return }
    void commit()
  }

  const label = (key: string) => PURPOSES.find((item) => item.key === key)?.label ?? key

  return (
    <SaveErrorScope errors={errors}><Drawer
      open={open}
      title="配信の受け取り"
      description={`${friendName} さん ・ 目的ごとに、届けてよいかを記録します`}
      closeAppearance="box"
      heightMode="viewport"
      onClose={onClose}
      footer={editing && canEdit ? (
        <div className={styles.footer}>
          <Button onClick={() => setEditing(null)} disabled={busy}>キャンセル</Button>
          <Button variant="primary" onClick={submit} busy={busy} disabled={busy}>保存する</Button>
        </div>
      ) : undefined}
    >
      <div className={styles.body}>
        {error ? <Notice tone="danger" message={error} /> : null}
        <Card padding="compact" layout="vertical" gap="var(--polish-space-field)" aria-label="目的ごとの受け取り">
          {PURPOSES.map((purpose) => {
            const row = rowOf(purpose.key)
            const state = row?.state ?? 'unknown'
            return (
              <div key={purpose.key} className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowTitle}>{purpose.label}</span>
                  <span className={styles.rowNote}>{purpose.note}</span>
                </div>
                <StatusBadge tone={STATE_TONE[state]}><span>{STATE_LABEL[state]}</span></StatusBadge>
                {canEdit ? <Button variant="secondary" onClick={() => begin(purpose.key)}>変える</Button> : null}
              </div>
            )
          })}
        </Card>
        {editing && canEdit ? (
          <section className={styles.edit} aria-label={`${label(editing)}を変える`}>
            <h3 className={styles.sectionTitle}>{`変える（${label(editing)}）`}</h3>
            <Card padding="compact" layout="vertical" gap="var(--polish-space-field)">
              <RadioGroup className={styles.radios} label="受け取り">
                {STATES.map((state) => (
                  <Radio key={state} name="consent-state" value={state} checked={next === state} onChange={() => setNext(state)}>{state === 'unknown' ? '不明（まだ聞いていない）' : STATE_LABEL[state]}</Radio>
                ))}
              </RadioGroup>
              <Field label="理由" required error={reasonError}>
                <TextField aria-label="理由" value={reason} placeholder="例：お電話で「宣伝はいらない」とご連絡" onChange={(event) => { setReason(event.target.value); setReasonError('') }} />
              </Field>
            </Card>
          </section>
        ) : null}
        <section aria-label="履歴">
          <h3 className={styles.sectionTitle}>履歴</h3>
          {historyFailed ? <p className={styles.faint}>履歴を読み込めませんでした。</p> : events === null ? <p className={styles.faint}>読み込んでいます</p> : events.length === 0 ? <p className={styles.faint}>まだ記録はありません。</p> : (
            <DataTable>
              <thead><TableHeadRow><Th>いつ</Th><Th>目的</Th><Th>前 → 後</Th><Th>だれ</Th></TableHeadRow></thead>
              <tbody>
                {events.map((event) => (
                  <Tr key={event.id}>
                    <Td>{md(event.createdAt)}</Td>
                    <Td>{label(event.purpose)}</Td>
                    <Td>{`${stateOf(event.before)} → ${stateOf(event.after)}`}</Td>
                    <Td><span title={event.reason ?? undefined}>{ACTOR[event.actor.kind]}</span></Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={warn}
        title="本人が止めた宣伝を、受け取るに戻しますか？"
        description="この方は、ご自分で宣伝を止めています。店の判断で戻すと、お客さまの意思に反して宣伝が届くことがあります。電話や来店で、本人から了承を得たときだけ戻してください。理由は記録に残ります。"
        confirmLabel="受け取るに戻す"
        destructive
        busy={busy}
        onConfirm={() => void commit()}
        onCancel={() => setWarn(false)}
      />
    </Drawer></SaveErrorScope>
  )
}
