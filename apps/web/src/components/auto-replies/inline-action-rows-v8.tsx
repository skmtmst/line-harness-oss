'use client'

import { Bell } from 'lucide-react'
import { ActionConfigEditor, ACTION_KINDS } from '@/components/scenarios/action-editor'
import ActionList, { type ActionChoice } from '@/components/shared/action-list'
import { EntityPickerField } from '@/components/shared/entity-picker'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import Button from '@/components/shared/button'
import { useAccount } from '@/contexts/account-context'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { actionIncompleteReason } from './action-completeness'
import { newActionKey, type InlineAction } from './draft-fields'
import type { ActionOptions } from './inline-action-list'
import styles from './inline-action-rows-v8.module.css'

/*
 * ★V8 自動応答の作る③「返したあとに行うこと」（絵 rfhIf「処理」の行）。
 * 1つの処理を1行で見せる：並べ替えの印・番号・何をするか「だれに・どれを」・失敗したら・…。
 * 中身の編集は「…」→「設定を変える」で行の下に開く（いつも開いておかない）。
 * 動き（足す・消す・並べ替え・失敗したときの動き・中身の編集）は InlineActionList と同じ。
 */

type Props = { actions: InlineAction[]; onChange: (next: InlineAction[]) => void } & ActionOptions

const cfg = (a: InlineAction) => (a.config ?? {}) as Record<string, unknown>

export function actionRowTitle(a: InlineAction, o: ActionOptions): string {
  const c = cfg(a)
  const nameOf = (list: { id: string; name: string }[] | undefined, id: unknown) => (typeof id === 'string' ? list?.find((x) => x.id === id)?.name : undefined)
  const q = (s?: string) => (s ? `「${s}」` : '')
  switch (a.actionType) {
    case 'notify_staff':
      return `担当者へ知らせる${q(nameOf(o.notificationRules, c.notificationRuleId))}`
    case 'support_mark':
      return c.markId ? `対応マークを付ける${q(nameOf(o.marks, c.markId))}` : '対応マークを外す'
    case 'tag': {
      const ids = Array.isArray(c.tagIds) ? (c.tagIds as string[]) : []
      const names = ids.map((id) => nameOf(o.tags, id)).filter(Boolean).join('・')
      return `${c.op === 'remove' ? 'タグを外す' : 'タグを付ける'}${q(names)}`
    }
    case 'scenario':
      return `${c.op === 'stop' ? 'シナリオを止める' : 'シナリオを始める'}${q(nameOf(o.scenarios, c.scenarioId))}`
    case 'friend_field':
      return `友だち情報を変える${q(nameOf(o.fields, c.fieldId))}`
    case 'common_var':
      return `共通情報を変える${q(o.vars.find((v) => v.varKey === c.varKey)?.name)}`
    case 'send_template': return `テンプレートを送る${q(nameOf(o.templates, c.templateId))}`
    case 'reminder': return `リマインダを始める${q(nameOf(o.reminders, c.reminderId))}`
    case 'event_booking': return `イベントに予約する${q(nameOf(o.events, c.eventId))}`
    case 'send_message': return String(c.content || 'テキストを送る')
    default:
      return ACTION_KINDS.find((k) => k.type === a.actionType)?.label ?? a.actionType
  }
}

export default function InlineActionRowsV8({ actions, onChange, ...options }: Props) {
  const { selectedAccountId } = useAccount()
  const visibility = useFeatureVisibility(selectedAccountId)
  const choices: ActionChoice<InlineAction>[] = [
    { id: 'notify_staff', label: '担当者へ知らせる', disabled: options.targetsLoading, disabledReason: '候補を読み込んでいます', make: () => ({ key: newActionKey(), actionType: 'notify_staff', config: {}, onFailure: 'continue' }),
      picker: { title: '担当者通知を選ぶ', items: options.notificationRules ?? [], apply: (action, ids) => ({ ...action, config: { notificationRuleId: ids[0], notificationRuleVersion: options.notificationRules?.find(r => r.id === ids[0])?.version ?? 0 } }) } },
    ...ACTION_KINDS.filter(kind => !kind.feature || visibility.enabled(kind.feature)).map(kind => {
      const target = kind.type === 'tag' ? { items: options.tags, key: 'tagIds', label: 'タグ', multiple: true }
        : kind.type === 'support_mark' ? { items: options.marks, key: 'markId', label: '対応マーク' }
        : kind.type === 'common_var' ? { items: options.vars.map(row => ({ ...row, id: row.varKey })), key: 'varKey', label: '共通情報' }
        : kind.type === 'friend_field' ? { items: options.fields, key: 'fieldId', label: '友だち情報欄' }
        : kind.type === 'scenario' ? { items: options.scenarios, key: 'scenarioId', label: 'シナリオ' }
        : kind.type === 'send_template' ? { items: options.templates ?? [], key: 'templateId', label: 'テンプレート' }
        : kind.type === 'reminder' ? { items: options.reminders ?? [], key: 'reminderId', label: 'リマインダ' }
        : kind.type === 'event_booking' ? { items: options.events ?? [], key: 'eventId', label: 'イベント' } : null
      return { id: kind.type, label: kind.label, icon: kind.icon, disabled: Boolean(target && options.targetsLoading), disabledReason: '候補を読み込んでいます',
        make: (): InlineAction => ({ key: newActionKey(), actionType: kind.type, config: kind.make(), onFailure: 'continue' }),
        picker: target ? { title: `${target.label}を選ぶ`, items: target.items, multiple: target.multiple,
          apply: (action: InlineAction, ids: string[]) => ({ ...action, config: { ...cfg(action), [target.key]: target.multiple ? ids : ids[0] } }) } : undefined,
      }
    }),
  ]
  return <>
    {options.targetsError ? <Notice tone="danger" message={options.targetsError} action={options.retryTargets ? <Button onClick={options.retryTargets}>もう一度読み込む</Button> : undefined} /> : null}
    <ActionList value={actions} onChange={onChange} choices={choices} idOf={action => action.key}
      titleOf={action => actionRowTitle(action, options)} kindOf={action => action.actionType === 'notify_staff' ? '担当者へ知らせる' : ACTION_KINDS.find(kind => kind.type === action.actionType)?.label ?? '行うこと'} iconOf={action => action.actionType === 'notify_staff' ? Bell : ACTION_KINDS.find(kind => kind.type === action.actionType)?.icon}
      renderHint={action => { const reason = actionIncompleteReason(action.actionType, action.config); return reason ? <p className={styles.reason}>未完成 — {reason}</p> : null }}
      renderExtra={action => actionIncompleteReason(action.actionType, action.config) ? <span className={styles.incomplete}>未完成</span> : null}
      renderEditor={(action, update, index) => <>
        <div className={styles.notify}>
          <span className={styles.failLabel}>失敗したら</span>
          <Select className={styles.failSelect} value={action.onFailure} aria-label={`${index + 1}つ目の失敗したときの動き`}
            onChange={value => update({ ...action, onFailure: value === 'stop' ? 'stop' : 'continue' })}
            options={[{ value: 'continue', label: '次へ進む' }, { value: 'stop', label: 'ここで止める' }]} />
        </div>
        {action.actionType === 'notify_staff' ? <div className={styles.notify}>
        <EntityPickerField label="通知先" noun="担当者通知" value={String(cfg(action).notificationRuleId ?? '')} items={options.notificationRules ?? []}
          onChange={id => update({ ...action, config: { ...cfg(action), notificationRuleId: id, notificationRuleVersion: options.notificationRules?.find(r => r.id === id)?.version ?? 0 } })} />
        <textarea aria-label="通知の本文" maxLength={2000} className={styles.notifyText} value={String(cfg(action).message ?? '')}
          onChange={event => update({ ...action, config: { ...cfg(action), message: event.target.value } })} />
      </div> : <ActionConfigEditor
        action={{ id: action.key, scenarioId: '', hook: 'step_sent', stepId: null, choiceIndex: null, sortOrder: index, actionType: action.actionType, config: action.config, condition: null, repeatOnRefire: true }}
        tags={options.tags} fields={options.fields} marks={options.marks} scenarios={options.scenarios} vars={options.vars}
        templates={options.templates} reminders={options.reminders} events={options.events} targetsLoading={options.targetsLoading}
        onChange={config => update({ ...action, config })} />}</>} />
  </>
}
