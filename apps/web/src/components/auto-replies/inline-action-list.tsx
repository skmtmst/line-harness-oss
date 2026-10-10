'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import type { InlineAction } from './draft-fields'
import InlineActionRowsV8 from './inline-action-rows-v8'
import { scenarioReferenceData } from '@/components/scenarios/scenario-reference-data'
import type { ActionTargetOption } from '@/components/scenarios/action-editor'

/**
 * 応答したときに行うことの並び。
 *
 * シナリオのアクション（`scenario_actions` の行）と違い、自動応答は1つの列に
 * JSON で持つ。**中身の編集はシナリオと同じ部品（ActionConfigEditor）を使う。**
 * 種別を足したときに片方だけ増えるのを避けるため。
 */

type Option = { id: string; name: string }

export interface ActionOptions {
  templates?: ActionTargetOption[]
  reminders?: ActionTargetOption[]
  events?: ActionTargetOption[]
  targetsLoading?: boolean
  targetsError?: string
  retryTargets?: () => void
  notificationRules?: Array<Option & {version:number}>
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

  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) {
      setOptions({ tags: [], fields: [], marks: [], scenarios: [], vars: [] })
      return () => { cancelled = true }
    }
    void (async () => {
      setOptions({ tags: [], fields: [], marks: [], scenarios: [], vars: [], templates: [], reminders: [], events: [], notificationRules: [], targetsLoading: true })
      const [tags, fields, marks, scenarios, vars, notifications, templates, reminders, events] = await Promise.allSettled([
        // R23横展開: タグ・シナリオの候補は今のアカウントだけ（別アカウント混入防止）。
        api.tags.list({ accountId: selectedAccountId }),
        api.friendFields.list(selectedAccountId, undefined, { suppressFeatureDisabledEvent: true }),
        api.supportMarks.list(selectedAccountId, { suppressFeatureDisabledEvent: true }),
        api.scenarios.list({ accountId: selectedAccountId }),
        api.commonVars.list(selectedAccountId, undefined, { suppressFeatureDisabledEvent: true }),
        Promise.resolve().then(() => api.notifications.operatorRules.list(selectedAccountId)),
        Promise.resolve().then(() => scenarioReferenceData.templates(selectedAccountId)),
        Promise.resolve().then(() => scenarioReferenceData.reminders(selectedAccountId)),
        Promise.resolve().then(() => scenarioReferenceData.events(selectedAccountId)),
      ])
      if (cancelled) return
      setOptions({
        templates: templates.status === 'fulfilled' && templates.value.success ? templates.value.data.map(t => ({ ...t, id: t.id, name: t.name })) : [],
        reminders: reminders.status === 'fulfilled' && reminders.value.success ? reminders.value.data.map(t => ({ ...t, id: t.id, name: t.name })) : [],
        events: events.status === 'fulfilled' && events.value.success ? events.value.data.map(t => ({ ...t, id: t.id, name: t.name })) : [],
        targetsLoading: false,
        targetsError: [tags, fields, marks, scenarios, vars, notifications, templates, reminders, events].some(result => result.status === 'rejected' || !result.value.success) ? '選ぶ候補の一部を読み込めませんでした。' : undefined,
        notificationRules: notifications.status === 'fulfilled' && notifications.value.success ? notifications.value.data.items.filter(r=>r.isActive&&r.status==='published').map(r=>({id:r.id,name:r.name,version:r.version??1})) : [],
        tags:
          tags.status === 'fulfilled' && tags.value.success
            ? tags.value.data.map((t) => ({ ...t, id: t.id, name: t.name }))
            : [],
        fields:
          fields.status === 'fulfilled' && fields.value.success
            ? fields.value.data.map((f) => ({ ...f, id: f.id, name: f.name }))
            : [],
        marks:
          marks.status === 'fulfilled' && marks.value.success
            ? marks.value.data.map((m) => ({ id: m.id, name: m.name }))
            : [],
        scenarios:
          scenarios.status === 'fulfilled' && scenarios.value.success
            ? scenarios.value.data.map((s) => ({ ...s, id: s.id, name: s.name }))
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
  }, [selectedAccountId, attempt])

  return { ...options, retryTargets: () => setAttempt(value => value + 1) }
}

type Props = {
  actions: InlineAction[]
  onChange: (next: InlineAction[]) => void
} & ActionOptions

/** 既存の呼び出し口も、B-169 の共通の行で描く。 */
export default function InlineActionList(props: Props) {
  return <InlineActionRowsV8 {...props} />
}
