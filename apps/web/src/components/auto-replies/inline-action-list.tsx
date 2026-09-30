'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { ScenarioActionType } from '@/lib/api'
import { ActionConfigEditor, ACTION_KINDS } from '@/components/scenarios/action-editor'
import Select from '@/components/shared/select'
import { actionIncompleteReason } from './action-completeness'
import { newActionKey, type InlineAction } from './draft-fields'
import { useAccount } from '@/contexts/account-context'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'

/**
 * 応答したときに行うことの並び。
 *
 * シナリオのアクション（`scenario_actions` の行）と違い、自動応答は1つの列に
 * JSON で持つ。**中身の編集はシナリオと同じ部品（ActionConfigEditor）を使う。**
 * 種別を足したときに片方だけ増えるのを避けるため。
 */

type Option = { id: string; name: string }

export interface ActionOptions {
  tags: Option[]
  fields: Option[]
  marks: Option[]
  scenarios: Option[]
  vars: { varKey: string; name: string }[]
}

/**
 * アクションで選ぶものを読む。
 *
 * 片方が落ちても残りは出す。1つ取れないせいで設定そのものができなくなるより、
 * 選べるものだけでも出すほうがよい。
 */
export function useActionOptions(): ActionOptions {
  const { selectedAccountId } = useAccount()
  const [options, setOptions] = useState<ActionOptions>({
    tags: [],
    fields: [],
    marks: [],
    scenarios: [],
    vars: [],
  })

  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) {
      setOptions({ tags: [], fields: [], marks: [], scenarios: [], vars: [] })
      return () => { cancelled = true }
    }
    void (async () => {
      const [tags, fields, marks, scenarios, vars] = await Promise.allSettled([
        // R23横展開: タグ・シナリオの候補は今のアカウントだけ（別アカウント混入防止）。
        api.tags.list({ accountId: selectedAccountId }),
        api.friendFields.list(selectedAccountId, undefined, { suppressFeatureDisabledEvent: true }),
        api.supportMarks.list(selectedAccountId, { suppressFeatureDisabledEvent: true }),
        api.scenarios.list({ accountId: selectedAccountId }),
        api.commonVars.list(selectedAccountId, undefined, { suppressFeatureDisabledEvent: true }),
      ])
      if (cancelled) return
      setOptions({
        tags:
          tags.status === 'fulfilled' && tags.value.success
            ? tags.value.data.map((t) => ({ id: t.id, name: t.name }))
            : [],
        fields:
          fields.status === 'fulfilled' && fields.value.success
            ? fields.value.data.map((f) => ({ id: f.id, name: f.name }))
            : [],
        marks:
          marks.status === 'fulfilled' && marks.value.success
            ? marks.value.data.map((m) => ({ id: m.id, name: m.name }))
            : [],
        scenarios:
          scenarios.status === 'fulfilled' && scenarios.value.success
            ? scenarios.value.data.map((s) => ({ id: s.id, name: s.name }))
            : [],
        vars:
          vars.status === 'fulfilled' && vars.value.success
            ? vars.value.data.map((v) => ({ varKey: v.varKey, name: v.name }))
            : [],
      })
    })()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  return options
}

type Props = {
  actions: InlineAction[]
  onChange: (next: InlineAction[]) => void
} & ActionOptions

export default function InlineActionList({
  actions,
  onChange,
  tags,
  fields,
  marks,
  scenarios,
  vars,
}: Props) {
  const { selectedAccountId } = useAccount()
  // 任意機能の動作種は、そのaccountで機能がオフなら追加口ごと出さない。
  const actionFeatureVisibility = useFeatureVisibility(selectedAccountId)
  function add(actionType: ScenarioActionType) {
    const kind = ACTION_KINDS.find((k) => k.type === actionType)
    // 失敗したときは続けるが既定（いまの動き）。止めたい人だけ変える。
    onChange([...actions, { key: newActionKey(), actionType, config: kind?.make() ?? {}, onFailure: 'continue' as const }])
  }

  function update(key: string, config: unknown) {
    onChange(actions.map((a) => (a.key === key ? { ...a, config } : a)))
  }

  function updateOnFailure(key: string, onFailure: 'stop' | 'continue') {
    onChange(actions.map((a) => (a.key === key ? { ...a, onFailure } : a)))
  }

  function remove(key: string) {
    onChange(actions.filter((a) => a.key !== key))
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= actions.length) return
    const next = [...actions]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {actions.length === 0 && (
        <p className="text-ink-faint text-xs">
          まだ何も設定されていません。下から選んで足してください。
        </p>
      )}

      {actions.map((action, index) => {
        /*
         * R255: 必須の中身が空の処理は「未完成」の札を付け、保存の前に知らせる。
         * 下書き保存自体は止めない（後から埋められる）が、不備が見えないまま
         * 完成と思い込むのを防ぐ。札の形はシナリオの終了後の処理（#961）と同じ。
         */
        const incompleteReason = actionIncompleteReason(action.actionType, action.config)
        return (
        <div key={action.key} className="border-hairline rounded-control border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-ink text-xs font-semibold">
              {index + 1}. {ACTION_KINDS.find((k) => k.type === action.actionType)?.label ?? action.actionType}
            </span>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className="text-ink-faint hover:text-ink disabled:opacity-30"
                aria-label="上へ"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === actions.length - 1}
                className="text-ink-faint hover:text-ink disabled:opacity-30"
                aria-label="下へ"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(action.key)}
                className="text-danger hover:underline"
              >
                削除する
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs">
              <span className="text-ink-faint shrink-0">失敗したら</span>
              <Select
                value={action.onFailure}
                onChange={(value) => updateOnFailure(action.key, value === 'stop' ? 'stop' : 'continue')}
                aria-label={`${index + 1}つ目の失敗したときの動き`}
                className="w-36"
                options={[
                  { value: 'continue', label: '次へ進む' },
                  { value: 'stop', label: 'ここで止める' },
                ]}
              />
            </label>
            <ActionConfigEditor
              action={{
                // ActionConfigEditor は中身と種別しか見ない。行として保存しないので、
                // それ以外は形を合わせるためだけの値。
                id: action.key,
                scenarioId: '',
                hook: 'step_sent',
                stepId: null,
                choiceIndex: null,
                sortOrder: index,
                actionType: action.actionType,
                config: action.config,
                condition: null,
                repeatOnRefire: true,
              }}
              tags={tags}
              fields={fields}
              marks={marks}
              scenarios={scenarios}
              vars={vars}
              onChange={(config) => update(action.key, config)}
            />
            {incompleteReason ? (
              <p className="mt-2">
                <span className="bg-warning-bg text-warning rounded-pill px-2 py-0.5 font-medium" style={{ fontSize: 10 }}>
                  未完成 — {incompleteReason}
                </span>
              </p>
            ) : null}
          </div>
        </div>
        )
      })}

      <div className="flex flex-wrap gap-1.5">
        {ACTION_KINDS.filter((kind) => !kind.feature || actionFeatureVisibility.enabled(kind.feature)).map((kind) => (
          <button
            key={kind.type}
            type="button"
            onClick={() => add(kind.type)}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-2.5 py-1 text-xs transition-colors"
          >
            ＋ {kind.label}
          </button>
        ))}
      </div>
    </div>
  )
}
