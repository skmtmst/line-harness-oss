'use client'

import { useRef, useState } from 'react'
import { GripVertical, Plus } from 'lucide-react'
import { ActionConfigEditor, ACTION_KINDS } from '@/components/scenarios/action-editor'
import Select from '@/components/shared/select'
import Button from '@/components/shared/button'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { MoreAction } from '@/components/shared/row-actions'
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
    default:
      return ACTION_KINDS.find((k) => k.type === a.actionType)?.label ?? a.actionType
  }
}

export default function InlineActionRowsV8({ actions, onChange, ...options }: Props) {
  const { selectedAccountId } = useAccount()
  const visibility = useFeatureVisibility(selectedAccountId)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)

  const update = (key: string, patch: Partial<InlineAction>) => onChange(actions.map((a) => (a.key === key ? { ...a, ...patch } : a)))
  const move = (index: number, delta: number) => {
    const t = index + delta
    if (t < 0 || t >= actions.length) return
    const next = [...actions]
    const [m] = next.splice(index, 1)
    next.splice(t, 0, m)
    onChange(next)
  }
  const add = (actionType: InlineAction['actionType']) => {
    const kind = ACTION_KINDS.find((k) => k.type === actionType)
    const key = newActionKey()
    onChange([...actions, { key, actionType, config: kind?.make() ?? {}, onFailure: 'continue' as const }])
    setEditing(key)
  }
  const addItems: ActionMenuItem[] = [
    { id: 'notify_staff', label: '担当者へ知らせる', onSelect: () => add('notify_staff') },
    ...ACTION_KINDS.filter((k) => !k.feature || visibility.enabled(k.feature)).map((k) => ({ id: k.type, label: k.label, onSelect: () => add(k.type) })),
  ]

  return (
    <div className={styles.list}>
      {actions.length === 0 && <p className={styles.empty}>まだ何もありません。「処理を足す」から選んでください。</p>}
      {actions.map((action, index) => {
        const incomplete = actionIncompleteReason(action.actionType, action.config)
        const items: ActionMenuItem[] = [
          { id: 'edit', label: editing === action.key ? '設定を閉じる' : '設定を変える', onSelect: () => setEditing(editing === action.key ? null : action.key) },
          { id: 'up', label: '上へ', disabled: index === 0, onSelect: () => move(index, -1) },
          { id: 'down', label: '下へ', disabled: index === actions.length - 1, onSelect: () => move(index, 1) },
          { id: 'delete', label: '削除する', tone: 'danger', dividerBefore: true, onSelect: () => onChange(actions.filter((a) => a.key !== action.key)) },
        ]
        return (
          <div key={action.key} className={styles.item}>
            <div className={styles.row}>
              <GripVertical size={14} aria-hidden="true" className={styles.grip} />
              <span className={styles.num}>{index + 1}</span>
              <span className={styles.title}>{actionRowTitle(action, options)}</span>
              {incomplete ? <span className={styles.incomplete}>未完成</span> : null}
              <span className={styles.spacer} />
              <span className={styles.failLabel}>失敗したら</span>
              <Select
                className={styles.failSelect}
                value={action.onFailure}
                onChange={(v) => update(action.key, { onFailure: v === 'stop' ? 'stop' : 'continue' })}
                aria-label={`${index + 1}つ目の失敗したときの動き`}
                options={[{ value: 'continue', label: '次へ進む' }, { value: 'stop', label: 'ここで止める' }]}
              />
              <MoreAction label={`${index + 1}つ目の処理の操作`} onClick={() => setOpenMenu(openMenu === action.key ? null : action.key)} />
              <ActionMenu open={openMenu === action.key} items={items} onClose={() => setOpenMenu(null)} ariaLabel={`${index + 1}つ目の処理の操作`} />
            </div>
            {incomplete && editing !== action.key ? <p className={styles.reason}>未完成 — {incomplete}</p> : null}
            {editing === action.key ? (
              <div className={styles.editor}>
                {action.actionType === 'notify_staff' ? (
                  <div className={styles.notify}>
                    <Select
                      aria-label="通知先"
                      value={String(cfg(action).notificationRuleId ?? '')}
                      options={[{ value: '', label: '通知先を選ぶ' }, ...(options.notificationRules ?? []).map((r) => ({ value: r.id, label: r.name }))]}
                      onChange={(value) => {
                        const rule = options.notificationRules?.find((r) => r.id === value)
                        update(action.key, { config: { ...cfg(action), notificationRuleId: value, notificationRuleVersion: rule?.version ?? 0 } })
                      }}
                    />
                    <textarea
                      aria-label="通知の本文"
                      maxLength={2000}
                      className={styles.notifyText}
                      value={String(cfg(action).message ?? '')}
                      onChange={(e) => update(action.key, { config: { ...cfg(action), message: e.target.value } })}
                    />
                  </div>
                ) : (
                  <ActionConfigEditor
                    action={{ id: action.key, scenarioId: '', hook: 'step_sent', stepId: null, choiceIndex: null, sortOrder: index, actionType: action.actionType, config: action.config, condition: null, repeatOnRefire: true }}
                    tags={options.tags}
                    fields={options.fields}
                    marks={options.marks}
                    scenarios={options.scenarios}
                    vars={options.vars}
                    onChange={(config) => update(action.key, { config })}
                  />
                )}
              </div>
            ) : null}
          </div>
        )
      })}
      <div className={styles.add}>
        <Button ref={addRef} variant="text" type="button" onClick={() => setAdding(!adding)}>
          <Plus size={14} aria-hidden="true" />
          処理を足す
        </Button>
        <ActionMenu open={adding} items={addItems} onClose={() => setAdding(false)} ariaLabel="足す処理を選ぶ" anchorRef={addRef} />
      </div>
    </div>
  )
}
