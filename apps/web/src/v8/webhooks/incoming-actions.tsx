"use client"

import { useEffect, useRef, useState } from 'react'
import { api, describeSaveFailure, type CommonActionResources, type IncomingWebhookDetail } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionList from '@/components/shared/action-list'
import { EntityPickerField } from '@/components/shared/entity-picker'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'

type Ref = IncomingWebhookDetail['actions'][number]
const KINDS = [
  { id: 'tag', label: 'タグを付ける', resource: 'tags' },
  { id: 'support_mark', label: '対応マークを付ける', resource: 'supportMarks' },
  { id: 'template', label: 'テンプレートを送る', resource: 'templates' },
  { id: 'scenario', label: 'シナリオを始める', resource: 'scenarios' },
  { id: 'outgoing_webhook', label: '別のサービスへ知らせる', resource: 'webhooks' },
  { id: 'common_action', label: '共通アクションを動かす', resource: 'commonActions' },
] as const

/** 既存の版付き config の口につなぐ。照合設定・未対応の既存参照は保持する。 */
export default function IncomingActions({ detail, accountId, readOnly, onSaved, onGuardReady }: { detail: IncomingWebhookDetail; accountId: string; readOnly: boolean; onSaved: () => void; onGuardReady: (guard: ((action: () => void) => void) | null) => void }) {
  const [draft, setDraft] = useState(detail.actions)
  const [resources, setResources] = useState<CommonActionResources | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    setResources(null); setLoadError(false)
    if (readOnly) return
    let current = true
    Promise.resolve().then(() => api.commonActions.resources(accountId)).then(res => { if (!res.success) throw new Error('resources'); if (current) setResources(res.data) })
      .catch(() => { if (current) setLoadError(true) })
    return () => { current = false }
  }, [accountId, readOnly, attempt])
  const items = (kind: string) => {
    const key = KINDS.find(item => item.id === kind)?.resource
    return key ? resources?.[key] ?? [] : []
  }
  const target = (action: Ref, id: string): Ref => ({ ...action, refId: id, displayName: items(action.refKind).find(item => item.id === id)?.name ?? '未設定',
    refVersionId: action.refKind === 'common_action' ? resources?.commonActions.find(item => item.id === id)?.currentPublishedVersionId ?? null : null })
  const dirty = JSON.stringify(draft) !== JSON.stringify(detail.actions)
  const guard = useUnsavedGuard({ dirty, busy, onDiscard: () => setDraft(detail.actions) })
  useEffect(() => { onGuardReady(guard.guarded); return () => onGuardReady(null) }, [onGuardReady, guard.guarded])
  const save = async () => {
    if (lock.current || readOnly) return
    lock.current = true; setBusy(true); setError('')
    try {
      const res = await api.webhooks.incoming.saveConfig(detail.id, accountId, { expectedVersion: detail.version, identityMatching: detail.identityMatching,
        actions: draft.map(({ refKind, refId, refVersionId }) => ({ refKind, refId, refVersionId })) })
      if (!res.success) throw new Error(res.error)
      if (active.current) { guard.disarm(); notifyToast('保存しました'); onSaved() }
    } catch (cause) { if (active.current) setError(describeSaveFailure(cause)) }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  return <>
    <ConfirmDialog open={guard.leaveTarget !== null} title="入力を破棄しますか？" description="保存していない行うことの変更があります。" confirmLabel="破棄して移動する" busy={busy} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
    {loadError ? <Notice tone="danger" message="動きの対象を読み込めませんでした。" action={<Button onClick={() => setAttempt(n => n + 1)}>もう一度読み込む</Button>} /> : null}
    <ActionList<Ref> value={draft} onChange={setDraft} readOnly={readOnly || busy} idOf={(_, index) => String(index)} titleOf={action => action.displayName} kindOf={action => KINDS.find(kind => kind.id === action.refKind)?.label ?? action.refKind}
      choices={draft.length >= 20 ? [] : KINDS.map(kind => ({ id: kind.id, label: kind.label, disabled: !resources, disabledReason: loadError ? '候補を読み直してください' : '候補を読み込んでいます', make: () => ({ refKind: kind.id, refId: '', refVersionId: null, displayName: kind.label }),
        picker: { title: `${kind.label}対象を選ぶ`, items: items(kind.id), apply: targetFromIds } }))}
      renderEditor={(action, update) => <EntityPickerField label="操作の対象" noun="対象" items={items(action.refKind)} value={action.refId} onChange={id => update(target(action, id))} />} />
    {error ? <Notice tone="danger" action={<Button onClick={() => guard.guarded(onSaved)}>最新の内容を読み込む</Button>}>{error}</Notice> : null}
    {readOnly ? null : <Button disabled={!dirty || busy} busy={busy} onClick={() => void save()}>行うことを保存する</Button>}
  </>
  function targetFromIds(action: Ref, ids: string[]) { return target(action, ids[0]) }
}
