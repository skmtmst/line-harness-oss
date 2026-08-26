'use client'

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { CommonActionResources, CommonActionStep } from '@/lib/api'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import SelectField from '@/components/shared/select-field'
import { TextArea, TextField } from '@/components/shared/text-field'

const ACTION_OPTIONS: Array<{ value: CommonActionStep['type']; label: string }> = [
  { value: 'add_tag', label: 'タグを付ける' },
  { value: 'remove_tag', label: 'タグを外す' },
  { value: 'set_metadata', label: '友だち情報を設定する' },
  { value: 'start_scenario', label: 'シナリオを開始する' },
  { value: 'stop_scenario', label: 'シナリオを停止する' },
  { value: 'resume_scenario', label: 'シナリオを再開する' },
  { value: 'send_message', label: 'LINEメッセージを送る' },
  { value: 'send_webhook', label: '外部サービスへ送る' },
  { value: 'switch_rich_menu', label: 'リッチメニューを切り替える' },
  { value: 'remove_rich_menu', label: 'リッチメニューを外す' },
  { value: 'wait', label: '待つ' },
  { value: 'common_action', label: '別の共通アクションを呼ぶ' },
]

function defaultParams(type: CommonActionStep['type']): Record<string, unknown> {
  if (type === 'wait') return { durationMinutes: 5 }
  if (type === 'set_metadata') return { values: { item: '' } }
  return {}
}

export function newCommonActionStep(type: CommonActionStep['type'] = 'add_tag'): CommonActionStep {
  return {
    id: crypto.randomUUID(),
    type,
    params: defaultParams(type),
    onFailure: 'stop',
  }
}

export default function CommonActionEditor({
  value,
  resources,
  onChange,
}: {
  value: CommonActionStep[]
  resources: CommonActionResources
  onChange: (next: CommonActionStep[]) => void
}) {
  const update = (index: number, patch: Partial<CommonActionStep>) => {
    onChange(value.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step))
  }
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= value.length) return
    const next = [...value]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div className="space-y-3">
      {value.map((step, index) => (
        <section key={step.id} className="border-hairline rounded-card border bg-canvas p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-ink font-semibold">{index + 1}. {ACTION_OPTIONS.find((item) => item.value === step.type)?.label}</h3>
            <div className="flex items-center gap-1">
              <IconButton onClick={() => move(index, -1)} disabled={index === 0} aria-label={`${index + 1}番目の処理を上へ`}>
                <ArrowUp size={16} aria-hidden />
              </IconButton>
              <IconButton onClick={() => move(index, 1)} disabled={index === value.length - 1} aria-label={`${index + 1}番目の処理を下へ`}>
                <ArrowDown size={16} aria-hidden />
              </IconButton>
              <IconButton onClick={() => onChange(value.filter((_, stepIndex) => stepIndex !== index))} aria-label={`${index + 1}番目の処理を削除`}>
                <Trash2 size={16} aria-hidden />
              </IconButton>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <label className="text-ink-secondary text-sm">
              処理
              <SelectField
                value={step.type}
                onChange={(event) => update(index, {
                  type: event.target.value as CommonActionStep['type'],
                  params: defaultParams(event.target.value as CommonActionStep['type']),
                })}
                className="mt-1 w-full"
                options={ACTION_OPTIONS}
              />
            </label>
            <label className="text-ink-secondary text-sm">
              失敗したとき
              <SelectField
                value={step.onFailure}
                onChange={(event) => update(index, { onFailure: event.target.value as 'stop' | 'continue' })}
                className="mt-1 w-full"
                options={[
                  { value: 'stop', label: 'ここで止める' },
                  { value: 'continue', label: '次の処理へ進む' },
                ]}
              />
            </label>
          </div>

          <div className="mt-3">
            <ActionParams
              step={step}
              resources={resources}
              onChange={(params) => update(index, { params })}
            />
          </div>
        </section>
      ))}
      <Button
        onClick={() => onChange([...value, newCommonActionStep()])}
      >
        <Plus size={16} aria-hidden />
        処理を追加
      </Button>
    </div>
  )
}

function ResourceSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ id: string; name: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="text-ink-secondary block text-sm">
      {label}
      <SelectField
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full"
        options={[{ value: '', label: `${label}を選ぶ` }, ...options.map((option) => ({ value: option.id, label: option.name }))]}
      />
      {options.length === 0 ? <span className="text-warning mt-1 block text-xs">選べる{label}がありません</span> : null}
    </label>
  )
}

function ActionParams({
  step,
  resources,
  onChange,
}: {
  step: CommonActionStep
  resources: CommonActionResources
  onChange: (params: Record<string, unknown>) => void
}) {
  if (step.type === 'add_tag' || step.type === 'remove_tag') {
    return <ResourceSelect label="タグ" value={String(step.params.tagId ?? '')} options={resources.tags} onChange={(tagId) => onChange({ tagId })} />
  }
  if (step.type === 'start_scenario' || step.type === 'stop_scenario' || step.type === 'resume_scenario') {
    return <ResourceSelect label="シナリオ" value={String(step.params.scenarioId ?? '')} options={resources.scenarios} onChange={(scenarioId) => onChange({ scenarioId })} />
  }
  if (step.type === 'send_webhook') {
    return <ResourceSelect label="送信先" value={String(step.params.webhookId ?? '')} options={resources.webhooks} onChange={(webhookId) => onChange({ webhookId })} />
  }
  if (step.type === 'switch_rich_menu') {
    return <ResourceSelect label="リッチメニュー" value={String(step.params.richMenuPageId ?? '')} options={resources.richMenus} onChange={(richMenuPageId) => onChange({ richMenuPageId })} />
  }
  if (step.type === 'common_action') {
    return <ResourceSelect label="共通アクション" value={String(step.params.commonActionId ?? '')} options={resources.commonActions} onChange={(commonActionId) => onChange({ commonActionId })} />
  }
  if (step.type === 'wait') {
    return (
      <label className="text-ink-secondary block max-w-xs text-sm">
        待つ時間（5分単位）
        <TextField type="number" min={5} step={5} max={525600} value={Number(step.params.durationMinutes ?? 5)} onChange={(event) => onChange({ durationMinutes: Number(event.target.value) })} className="mt-1" />
      </label>
    )
  }
  if (step.type === 'send_message') {
    const templateId = String(step.params.templateId ?? '')
    return (
      <div className="space-y-3">
        <ResourceSelect label="テンプレート" value={templateId} options={resources.templates} onChange={(next) => onChange(next ? { templateId: next } : { content: '' })} />
        {!templateId ? (
          <label className="text-ink-secondary block text-sm">
            送る本文
            <TextArea value={String(step.params.content ?? '')} onChange={(event) => onChange({ content: event.target.value })} rows={4} className="mt-1" placeholder="友だちに送る文章を入力" />
          </label>
        ) : null}
      </div>
    )
  }
  if (step.type === 'set_metadata') {
    const entries = Object.entries((step.params.values as Record<string, unknown> | undefined) ?? {})
    const [key = '', value = ''] = entries[0] ?? []
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="text-ink-secondary text-sm">項目名<TextField value={key} onChange={(event) => onChange({ values: { [event.target.value]: value } })} className="mt-1" placeholder="例：来店店舗" /></label>
        <label className="text-ink-secondary text-sm">入れる内容<TextField value={String(value)} onChange={(event) => onChange({ values: { [key]: event.target.value } })} className="mt-1" placeholder="例：新宿店" /></label>
      </div>
    )
  }
  return <p className="text-ink-faint text-sm">この処理には追加設定はありません。</p>
}
