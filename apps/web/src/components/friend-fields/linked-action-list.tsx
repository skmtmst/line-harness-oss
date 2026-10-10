"use client"

import { useEffect, useState } from 'react'
import { api, type CommonActionResources } from '@/lib/api'
import ActionList, { type ActionChoice } from '@/components/shared/action-list'
import { EntityPickerField } from '@/components/shared/entity-picker'
import Notice from '@/components/shared/notice'
import Button from '@/components/shared/button'
import { TextArea, TextField } from '@/components/shared/text-field'
import Select from '@/components/shared/select'
import { ACTION_TYPES, ACTION_DEFINITIONS, type LinkedAction, type TagEditorActionLabel } from './tag-editor-v4'
import { newStepId } from '@/components/automations/common-action-editor'

/** 店と統括のタグ連動。旧いラベル・定義と遅延設定を保ち、その場で再編集する。 */
export default function LinkedActionList({ value, onChange, accountId, allowedTypes, readOnly = false }: {
  value: LinkedAction[]; onChange: (next: LinkedAction[]) => void; accountId?: string | null; allowedTypes?: readonly TagEditorActionLabel[]; readOnly?: boolean
}) {
  const [resources, setResources] = useState<CommonActionResources | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    setResources(null); setError(false)
    if (!accountId || readOnly) return
    let active = true
    Promise.resolve().then(() => api.commonActions.resources(accountId, undefined, 'tag.added'))
      .then(res => { if (!res.success) throw new Error('resources'); if (active) setResources(res.data) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [accountId, readOnly, attempt])
  const describe = (action: LinkedAction, params: Record<string, unknown>, typeLabel?: TagEditorActionLabel): LinkedAction => {
    if (!action.definition) return action
    const type = typeLabel ?? ACTION_TYPES.find(([label]) => ACTION_DEFINITIONS[label].actionType === action.definition!.type && (label !== 'テンプレート送信' || Boolean(params.templateId)) && (label !== 'テキスト送信' || !params.templateId))?.[0]
    const def = type ? ACTION_DEFINITIONS[type] : undefined
    const options = def?.resource ? resources?.[def.resource] as Array<{ id: string; name: string }> | undefined : undefined
    const label = typeof params.content === 'string' ? params.content : params.amount !== undefined ? `${params.amount} mile`
      : def?.paramKey ? options?.find(item => item.id === params[def.paramKey!])?.name ?? action.label : action.label
    const minutes = Number(params.delayMinutes ?? 0)
    return { ...action, label, timing: minutes > 0 ? `${minutes}分後` : 'すぐに', definition: { ...action.definition, params } }
  }
  const choices: ActionChoice<LinkedAction>[] = ACTION_TYPES.filter(([label]) => label !== '友だち情報更新' && (!allowedTypes || allowedTypes.includes(label)) && (!resources?.actionTypes || resources.actionTypes.some(type => type.actionType === ACTION_DEFINITIONS[label].actionType && type.state === 'available'))).map(([label, category]) => {
    const def = ACTION_DEFINITIONS[label]
    const items = def.resource ? (resources?.[def.resource] as Array<{ id: string; name: string }> | undefined) ?? [] : []
    return { id: label, label, make: () => { const id = newStepId(); return { id, type: category, label, timing: 'すぐに', definition: { id, type: def.actionType, params: { delayMinutes: 0, cancelIfTagRemoved: true }, onFailure: 'stop' } } },
      picker: def.resource ? { title: `${label}の対象を選ぶ`, items,
        apply: (action, ids) => describe(action, { ...action.definition!.params, [def.paramKey!]: ids[0] }, label) } : undefined }
  })
  return <>
    {error ? <Notice tone="danger" message="連動の対象を読み込めませんでした。" action={<Button onClick={() => setAttempt(n => n + 1)}>もう一度読み込む</Button>} /> : null}
    <ActionList value={value} onChange={onChange} readOnly={readOnly} choices={choices} idOf={action => action.id} duplicateOf={action => { const id = newStepId(); return { ...action, id, definition: action.definition ? { ...action.definition, id, params: { ...action.definition.params } } : undefined } }} titleOf={action => action.label} kindOf={action => action.type}
      renderEditor={(action, update) => {
        if (!action.definition) return <Notice tone="warn">以前の動きの設定を読み取れません。内容を保ったまま表示しています。</Notice>
        const params = action.definition.params
        const label = ACTION_TYPES.find(([name]) => ACTION_DEFINITIONS[name].actionType === action.definition!.type && (name !== 'テキスト送信' || !params.templateId))?.[0]
        const def = label ? ACTION_DEFINITIONS[label] : undefined
        const patch = (next: Record<string, unknown>) => update(describe(action, { ...params, ...next }, label))
        return <>
          {def?.resource && def.paramKey ? <EntityPickerField label="連動の対象" noun="対象" items={(resources?.[def.resource] as Array<{ id: string; name: string }> | undefined) ?? []} value={String(params[def.paramKey] ?? '')} onChange={id => patch({ [def.paramKey!]: id })} /> : null}
          {action.definition.type === 'send_message' && !params.templateId || action.definition.type === 'notify_staff' ? <TextArea aria-label="送る本文" value={String(params.content ?? params.message ?? '')} onChange={event => patch({ [action.definition!.type === 'notify_staff' ? 'message' : 'content']: event.target.value })} /> : null}
          {action.definition.type === 'grant_mileage' ? <TextField type="number" min={1} aria-label="付けるマイル" value={String(params.amount ?? '')} onChange={event => patch({ amount: Number(event.target.value) })} /> : null}
          <TextField type="number" min={0} aria-label="実行までの分数" value={String(params.delayMinutes ?? 0)} onChange={event => patch({ delayMinutes: Number(event.target.value) })} />
          <Select aria-label="失敗したとき" value={action.definition.onFailure ?? 'stop'} options={[{ value: 'stop', label: 'ここで止める' }, { value: 'continue', label: '次へ進む' }]} onChange={onFailure => update({ ...action, definition: { ...action.definition!, onFailure: onFailure as 'stop' | 'continue' } })} />
        </>
      }} />
  </>
}
