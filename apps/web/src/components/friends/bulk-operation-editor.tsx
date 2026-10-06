'use client'

import { useEffect, useState } from 'react'
import type { FriendBulkOperation } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Combobox from '@/components/shared/combobox'
import DateTimeField from '@/components/shared/date-time-field'
import { Field, TextArea } from '@/components/shared/form-controls'
import ListState from '@/components/shared/list-state'
import type { BulkOperationInput } from './bulk-operation-input'

type Choice = { id: string; name: string; versionId?: string }
const LABELS: Partial<Record<FriendBulkOperation['kind'], string>> = {
  add_tag: 'どのタグ', remove_tag: 'どのタグ', assign_operator: '担当者',
  start_scenario: 'シナリオ', stop_scenario: 'シナリオ', set_support: '対応マーク',
  set_reminder: 'リマインダー', run_common_action: 'アクション',
}

/** 候補取得は読み取りだけ。アカウント・操作が変わったら遅い応答を捨てる。 */
export default function BulkOperationEditor({ kind, accountId, tags, input, onChange, disabled }: {
  kind: FriendBulkOperation['kind']
  accountId: string | null
  tags: Choice[]
  input: BulkOperationInput
  onChange: (input: BulkOperationInput) => void
  disabled: boolean
}) {
  const [choices, setChoices] = useState<Choice[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading')
  const [reload, setReload] = useState(0)
  const local = kind === 'add_tag' || kind === 'remove_tag' || kind === 'send_message'
  const needsAccount = !local && kind !== 'assign_operator'
  useEffect(() => {
    let current = true
    setChoices([])
    setState('loading')
    if (local || (needsAccount && !accountId)) return
    const load = async () => {
      try {
        let items: Choice[]
        if (kind === 'assign_operator') {
          const res = await api.operators.list()
          if (!res.success) throw new Error('failed')
          items = [{ id: '__none', name: '未割り当てにする' }, ...res.data]
        } else if (kind === 'start_scenario' || kind === 'stop_scenario') {
          // 非稼働のシナリオも停止できるように一覧の全ページから選ぶ。
          items = []
          for (let page = 1; current; page += 1) {
            const res = await api.scenarios.listPage({ accountId: accountId!, page, limit: 200 })
            if (!current) return
            if (!res.success) throw new Error('failed')
            items.push(...res.data.items.map(({ id, name }) => ({ id, name })))
            if (items.length >= res.data.total || res.data.items.length === 0) break
          }
        } else if (kind === 'set_support') {
          const res = await api.supportMarks.list(accountId!, { suppressFeatureDisabledEvent: true })
          if (!res.success) throw new Error('failed')
          items = [{ id: '__none', name: '対応マークを外す' }, ...res.data]
        } else if (kind === 'set_reminder') {
          const res = await api.reminders.list({ accountId: accountId! })
          if (!res.success) throw new Error('failed')
          items = res.data
        } else {
          const res = await api.commonActions.resources(accountId!)
          if (!res.success) throw new Error('failed')
          items = res.data.commonActions.map((item) => ({ id: item.id, name: item.name, versionId: item.currentPublishedVersionId }))
        }
        if (!current) return
        setChoices(items)
        setState('ready')
      } catch (error) {
        if (current) setState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error')
      }
    }
    void load()
    return () => { current = false }
  }, [kind, accountId, reload, local, needsAccount])

  if (kind === 'send_message') return (
    <Field label="送るメッセージ" required htmlFor="bulk-message">
      <TextArea id="bulk-message" aria-label="送るメッセージ" rows={4} maxLength={5000} value={input.content}
        disabled={disabled} onChange={(event) => onChange({ ...input, content: event.target.value })} />
    </Field>
  )
  if (needsAccount && !accountId) return <p role="status" className="text-xs text-ink-secondary">操作するLINEアカウントを選んでください。</p>
  if (!local && state !== 'ready') return <ListState kind={state} title={state === 'loading' ? '候補を読み込んでいます' : state === 'forbidden' ? '候補を見る権限がありません' : '候補を読み込めませんでした'} onRetry={state === 'error' ? () => setReload((value) => value + 1) : undefined} />
  const items = local ? tags : choices
  const label = LABELS[kind] ?? '実行内容'
  return (
    <>
      <Field label={label} required>
        <Combobox aria-label={label} placeholder="選んでください" value={input.resourceId} disabled={disabled}
          options={items.map((item) => ({ value: item.id, label: item.name }))}
          onChange={(value) => {
            const choice = items.find((item) => item.id === value)
            onChange({ ...input, resourceId: choice?.id ?? '', resourceName: choice?.name ?? '', versionId: choice?.versionId ?? '' })
          }} />
      </Field>
      {items.length === 0 ? <p className="text-xs text-ink-secondary">選べる{label}がありません。登録してから、もう一度開いてください。</p> : null}
      {kind === 'set_reminder' ? <Field label="予定日時" required help="日本時間で指定します。リマインダーはこの日時を基準に通知します。">
        <DateTimeField aria-label="予定日時" required value={input.targetDate} disabled={disabled} onChange={(targetDate) => onChange({ ...input, targetDate })} />
      </Field> : null}
    </>
  )
}
