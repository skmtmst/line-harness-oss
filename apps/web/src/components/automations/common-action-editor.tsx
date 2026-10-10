'use client'
import { SaveErrorField } from '@/components/shared/save-form-errors'

import ActionList, { type ActionChoice } from '@/components/shared/action-list'
import type { CommonActionResources, CommonActionStep } from '@/lib/api'

import Select from '@/components/shared/select'
import { EntityKindField, type EntityKind } from '@/components/shared/entity-picker-sources'
import { TextArea, TextField } from '@/components/shared/text-field'

export const ACTION_OPTIONS: Array<{ value: CommonActionStep['type']; label: string }> = [
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

/**
 * 手順IDの採番1本化（#519 軽）。`crypto.randomUUID` は非HTTPS環境で
 * 例外になるため、使えないときは乱数+時刻へ落とす。
 */
export function newStepId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // 下の代替へ落とす。
  }
  return `step-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff_ffff).toString(36)}`
}

export function newCommonActionStep(type: CommonActionStep['type'] = 'add_tag'): CommonActionStep {
  return {
    id: newStepId(),
    type,
    params: defaultParams(type),
    onFailure: 'stop',
  }
}

export default function CommonActionEditor({
  value,
  resources,
  onChange,
  stepNumbers,
  resourcesFailed = false,
}: {
  value: CommonActionStep[]
  resources: CommonActionResources
  onChange: (next: CommonActionStep[]) => void
  /*
   * 監査 R474: 分岐を挟むときの実行順の番号表（処理ID→全体の番号）。
   * 無ければ従来どおりこの欄だけの連番。見た目と動きは変えない。
   */
  stepNumbers?: Record<string, number>
  /*
   * 監査 R585: 選択肢の取得に失敗したとき。真の0件（空のまま正常取得）と
   * 分け、欄ごとの「選べる◯◯がありません」を出さない。失敗の案内と
   * 再取得の口は呼び出し側の欄の近くが出す。既定 false で従来どおり。
   */
  resourcesFailed?: boolean
}) {
  const numberOf = (index: number, step: CommonActionStep) => stepNumbers?.[step.id] ?? index + 1

  return <ActionList value={value} onChange={onChange} choices={commonActionChoices(resources)} idOf={step => step.id} numberOf={(step, index) => numberOf(index, step)}
    titleOf={step => commonActionSummary(step, resources)} kindOf={step => ACTION_OPTIONS.find(item => item.value === step.type)?.label ?? step.type}
    renderEditor={(step, patch, index) => <CommonActionConfig index={index} step={step} resources={resources} resourcesFailed={resourcesFailed} onChange={patch} />} />
}

export function commonActionChoices(resources: CommonActionResources): ActionChoice<CommonActionStep>[] {
  const choices: ActionChoice<CommonActionStep>[] = ACTION_OPTIONS.map(option => {
    const target = option.value === 'add_tag' || option.value === 'remove_tag' ? { items: resources.tags, key: 'tagId', label: 'タグ' }
      : ['start_scenario', 'stop_scenario', 'resume_scenario'].includes(option.value) ? { items: resources.scenarios, key: 'scenarioId', label: 'シナリオ' }
      : option.value === 'send_webhook' ? { items: resources.webhooks, key: 'webhookId', label: '送信先' }
      : option.value === 'switch_rich_menu' ? { items: resources.richMenus, key: 'richMenuPageId', label: 'リッチメニュー' }
      : option.value === 'common_action' ? { items: resources.commonActions, key: 'commonActionId', label: '共通アクション' } : null
    return { id: option.value, label: option.label, make: () => newCommonActionStep(option.value), picker: target ? {
      title: `${target.label}を選ぶ`, items: target.items, apply: (step, ids) => ({ ...step, params: { ...step.params, [target.key]: ids[0] } }),
    } : undefined }
  })
  choices.splice(choices.findIndex(choice => choice.id === 'send_message') + 1, 0, {
    id: 'send_template', label: 'テンプレートを送る', make: () => newCommonActionStep('send_message'),
    picker: { title: 'テンプレートを選ぶ', items: resources.templates, apply: (step, ids) => ({ ...step, params: { templateId: ids[0] } }) },
  })
  return choices
}
export function commonActionSummary(step: CommonActionStep, resources: CommonActionResources): string {
  const params = step.params
  const id = String(params.tagId ?? params.scenarioId ?? params.templateId ?? params.webhookId ?? params.richMenuPageId ?? params.commonActionId ?? '')
  if (id) return [...resources.tags, ...resources.scenarios, ...resources.templates, ...resources.webhooks, ...resources.richMenus, ...resources.commonActions].find(item => item.id === id)?.name ?? '未設定'
  if (step.type === 'send_message') return String(params.content || '未設定')
  if (step.type === 'wait') return `${params.durationMinutes ?? 0} 分`
  return ACTION_OPTIONS.find(item => item.value === step.type)?.label ?? step.type
}
export function CommonActionConfig({ step, resources, resourcesFailed = false, onChange, index = 0 }: {
  index?: number; step: CommonActionStep; resources: CommonActionResources; resourcesFailed?: boolean; onChange: (next: CommonActionStep) => void
}) {
  return <>
    <SaveErrorField names={[`value.${index}.onFailure`,`value.${index}.on_failure`,"onFailure","step.onFailure","on_failure","step.on_failure"]}><Select aria-label="失敗したとき" value={step.onFailure} onChange={value => onChange({ ...step, onFailure: value as 'stop' | 'continue' })}
      options={[{ value: 'stop', label: 'ここで止める' }, { value: 'continue', label: '次の処理へ進む' }]} /></SaveErrorField>
    <ActionParams step={step} resources={resources} resourcesFailed={resourcesFailed} onChange={params => onChange({ ...step, params })} />
  </>
}

/** 作ってあるものを選ぶ欄（共通の選ぶ窓・dJZ7Q）。保存する値は今と同じ ID。 */
function ResourceSelect({
  label,
  kind,
  value,
  options,
  onChange,
  resourcesFailed = false,
  clearable = false,
}: {
  label: string
  kind: EntityKind
  value: string
  options: Array<{ id: string; name: string }>
  onChange: (value: string) => void
  /** 監査 R585: 取得失敗時は真の0件と分け、空の案内を出さない。 */
  resourcesFailed?: boolean
  clearable?: boolean
}) {
  return (
    <div className="text-ink-secondary block text-sm">
      <span className="mb-1 block">{label}</span>
      <SaveErrorField names={["value"]}><EntityKindField kind={kind} label={label} options={options} value={value} onChange={onChange} clearable={clearable} /></SaveErrorField>
      {options.length === 0 && !resourcesFailed ? <span className="text-warning mt-1 block text-xs">選べる{label}がありません</span> : null}
    </div>
  )
}

function ActionParams({
  step,
  resources,
  resourcesFailed = false,
  onChange,
}: {
  step: CommonActionStep
  resources: CommonActionResources
  resourcesFailed?: boolean
  onChange: (params: Record<string, unknown>) => void
}) {
  if (step.type === 'add_tag' || step.type === 'remove_tag') {
    return <SaveErrorField names={["tagId","step.params.tagId","params.tagId"]}><ResourceSelect label="タグ" kind="tag" value={String(step.params.tagId ?? '')} options={resources.tags} resourcesFailed={resourcesFailed} onChange={(tagId) => onChange({ tagId })} /></SaveErrorField>
  }
  if (step.type === 'start_scenario' || step.type === 'stop_scenario' || step.type === 'resume_scenario') {
    return <SaveErrorField names={["scenarioId","step.params.scenarioId","params.scenarioId"]}><ResourceSelect label="シナリオ" kind="scenario" value={String(step.params.scenarioId ?? '')} options={resources.scenarios} resourcesFailed={resourcesFailed} onChange={(scenarioId) => onChange({ scenarioId })} /></SaveErrorField>
  }
  if (step.type === 'send_webhook') {
    return <SaveErrorField names={["webhookId","step.params.webhookId","params.webhookId"]}><ResourceSelect label="送信先" kind="webhook" value={String(step.params.webhookId ?? '')} options={resources.webhooks} resourcesFailed={resourcesFailed} onChange={(webhookId) => onChange({ webhookId })} /></SaveErrorField>
  }
  if (step.type === 'switch_rich_menu') {
    return <SaveErrorField names={["richMenuPageId","step.params.richMenuPageId","params.richMenuPageId"]}><ResourceSelect label="リッチメニュー" kind="rich_menu" value={String(step.params.richMenuPageId ?? '')} options={resources.richMenus} resourcesFailed={resourcesFailed} onChange={(richMenuPageId) => onChange({ richMenuPageId })} /></SaveErrorField>
  }
  if (step.type === 'common_action') {
    const commonActionId = String(step.params.commonActionId ?? '')
    const selected = resources.commonActions.find((item) => item.id === commonActionId)
    return (
      <div>
        <SaveErrorField names={["commonActionId"]}><ResourceSelect label="共通アクション" kind="common_action" value={commonActionId} options={resources.commonActions} resourcesFailed={resourcesFailed} onChange={(nextId) => onChange({ commonActionId: nextId })} /></SaveErrorField>
        {selected ? <p className="text-ink-secondary mt-2 text-xs">共通アクション「{selected.name}」 v{selected.version}</p> : null}
      </div>
    )
  }
  if (step.type === 'wait') {
    return (
      <label className="text-ink-secondary block max-w-xs text-sm">
        待つ時間（5分単位）
        <SaveErrorField names={["durationMinutes","step.params.durationMinutes","params.durationMinutes","duration_minutes","step.params.duration_minutes","params.duration_minutes"]}><TextField type="number" min={5} step={5} max={525600} value={Number(step.params.durationMinutes ?? 5)} onChange={(event) => onChange({ durationMinutes: Number(event.target.value) })} className="mt-1" /></SaveErrorField>
      </label>
    )
  }
  if (step.type === 'send_message') {
    const templateId = String(step.params.templateId ?? '')
    const selected = resources.templates.find((item) => item.id === templateId)
    return (
      <div className="space-y-3">
        <SaveErrorField names={["templateId"]}><ResourceSelect label="テンプレート" kind="template" clearable value={templateId} options={resources.templates} resourcesFailed={resourcesFailed} onChange={(next) => onChange(next ? { templateId: next } : { content: '' })} /></SaveErrorField>
        {selected ? (
          <p className="text-ink-secondary text-xs">
            テンプレート「{selected.name}」　版: —（未取得。テンプレートの版を返す口が接続されると表示します）
          </p>
        ) : null}
        {!templateId ? (
          <label className="text-ink-secondary block text-sm">
            送る本文
            <SaveErrorField names={["content","step.params.content","params.content"]}><TextArea value={String(step.params.content ?? '')} onChange={(event) => onChange({ content: event.target.value })} rows={4} className="mt-1" placeholder="友だちに送る文章を入力" /></SaveErrorField>
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
        <label className="text-ink-secondary text-sm">項目名<SaveErrorField names={["key"]}><TextField value={key} onChange={(event) => onChange({ values: { [event.target.value]: value } })} className="mt-1" placeholder="例：来店店舗" /></SaveErrorField></label>
        <label className="text-ink-secondary text-sm">入れる内容<SaveErrorField names={["value"]}><TextField value={String(value)} onChange={(event) => onChange({ values: { [key]: event.target.value } })} className="mt-1" placeholder="例：新宿店" /></SaveErrorField></label>
      </div>
    )
  }
  return <p className="text-ink-faint text-sm">この処理には追加設定はありません。</p>
}
