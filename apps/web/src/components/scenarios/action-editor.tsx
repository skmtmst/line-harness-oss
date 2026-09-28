'use client'

/*
 * シナリオのアクションを編集する窓（設計 `V6 5 hz9ti 送信後のアクションを設定`）。
 *
 * 段の並びは設計に合わせて **「追加する動作を選ぶ」が先、「実行する動作」が後**。
 * 先に一覧を出して最後に追加口を置くと、まだ1つも無いときに何をすれば
 * いいのかが画面の一番下にしか無く、空の枠だけを見て手が止まる。
 *
 * 動作を番号つきのカードで積む形は変えていない。カードごとに条件・
 * 並べ替え・削除を置く。種別ごとに窓を分けると、「タグを付けてから、
 * そのタグを条件に次を動かす」が書けなくなる。
 *
 * 保存は操作のたびにすぐ行う。まとめて保存にすると、途中で閉じたときに
 * どこまで残ったかが分からない。打った値はまず画面に写し、保存は裏で
 * 1本の列に並べる（R244）。キャンセルは開いたときの状態に戻す（R242）。
 * 条件だけは下書きを持ち、「条件を保存」で保存する（R243）。
 *
 * 設計にあって、ここに置いていないもの:
 *
 *   - 共通設定の「アクション名」「フォルダ」と「保存済みセットの呼出し」…
 *     `scenario_actions` に名前もフォルダもセットの口も無く、読む口も
 *     書く口も無い。入口だけ置くと、書いたものが消えたように見える・
 *     保存できるように見えて設定済みだと誤認させる（R241）。
 *     引き継ぎは `docs/design-qa/v6-scenario-action-editor-handoff.md`
 *   - 8つの動作 … 現行の編集口が持つ種別は `ScenarioActionType` の5つ。
 *     変更時は、安全に変換できる設定をV6下書きAPIへ同時保存する
 *   - 「発動2回目以降も各動作を実行」をセクションに1つ … `repeatOnRefire` は
 *     動作1件ごとの列。1つにまとめると、動作ごとに違う値を持てなくなり、
 *     既にある設定を黙って上書きすることになる
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Calendar, FileText, Flag, MessageSquare, Tag, User, Variable, Workflow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import styles from './action-editor.module.css'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Combobox from '@/components/shared/combobox'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import {
  api,
  type ScenarioAction,
  type ScenarioActionHook,
  type ScenarioActionType,
  type ScenarioDraftActionV6,
} from '@/lib/api'
import Notice from '@/components/shared/notice'
import ConditionBuilder, {
  findInvalidRangeIssue,
  isEmptyCondition,
  isRuleComplete,
  type SegmentCondition,
  type SegmentRule,
} from '@/components/shared/condition-builder'
import { useAccount } from '@/contexts/account-context'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { scenarioReferenceData } from './scenario-reference-data'

export const ACTION_KINDS: {
  feature?: 'friend_fields' | 'support_marks' | 'common_vars'
  type: ScenarioActionType
  label: string
  /** 札の上に出す目印（設計 18px）。文字だけだと5つが同じ形に見える。 */
  icon: LucideIcon
  make: () => unknown
}[] = [
  { type: 'tag', label: 'タグ操作', icon: Tag, make: () => ({ op: 'add', tagIds: [] }) },
  {
    type: 'friend_field',
    label: '友だち情報操作',
    feature: 'friend_fields',
    icon: User,
    make: () => ({ fieldId: '', op: 'set', value: '' }),
  },
  { type: 'support_mark', label: '対応マーク操作', feature: 'support_marks', icon: Flag, make: () => ({ markId: null }) },
  {
    type: 'scenario',
    label: 'シナリオ操作',
    icon: Workflow,
    make: () => ({ op: 'start', scenarioId: '', restart: 'from_start' }),
  },
  {
    type: 'common_var',
    label: '共通情報操作',
    feature: 'common_vars',
    icon: Variable,
    make: () => ({ varKey: '', op: 'add', value: '1' }),
  },
  { type: 'send_message', label: 'テキスト送信', icon: MessageSquare, make: () => ({ content: '' }) },
  { type: 'send_template', label: 'テンプレート送信', icon: FileText, make: () => ({ templateId: '' }) },
  { type: 'reminder', label: 'リマインダ操作', icon: Bell, make: () => ({ reminderId: '' }) },
  { type: 'event_booking', label: 'イベント予約操作', icon: Calendar, make: () => ({ eventId: '' }) },
]

const KIND_LABEL: Record<ScenarioActionType, string> = {
  tag: 'タグ操作',
  friend_field: '友だち情報操作',
  support_mark: '対応マーク操作',
  scenario: 'シナリオ操作',
  common_var: '共通情報操作',
  send_message: 'テキスト送信',
  send_template: 'テンプレート送信',
  reminder: 'リマインダ操作',
  event_booking: 'イベント予約操作',
}

/** 既存5種を、機能5 V6の下書き契約へ安全に写せる形だけ変換する。 */
function toDraftActions(actions: ScenarioAction[]): ScenarioDraftActionV6[] {
  return actions.flatMap<ScenarioDraftActionV6>((action, actionIndex) => {
    const config = (action.config ?? {}) as Record<string, unknown>
    const common = {
      hook: action.hook,
      stepId: action.stepId,
      choiceKey: action.choiceIndex === null ? null : String(action.choiceIndex),
      condition: action.condition,
      onFailure: 'stop' as const,
    }
    if (action.actionType === 'tag') {
      const ids = Array.isArray(config.tagIds)
        ? config.tagIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
      return ids.map((tagId, index) => ({
        ...common,
        id: `${action.id}-${index}`,
        type: config.op === 'remove' ? 'remove_tag' : 'add_tag',
        params: { tagId },
        sortOrder: actionIndex * 10 + index,
      }))
    }
    if (action.actionType === 'support_mark' && typeof config.markId === 'string' && config.markId) {
      return [{
        ...common,
        id: action.id,
        type: 'set_support_mark',
        params: { supportMarkId: config.markId },
        sortOrder: actionIndex * 10,
      }]
    }
    if (action.actionType === 'scenario' && typeof config.scenarioId === 'string' && config.scenarioId) {
      const type = config.op === 'stop' ? 'stop_scenario' : 'start_scenario'
      return [{
        ...common,
        id: action.id,
        type,
        params: { scenarioId: config.scenarioId },
        sortOrder: actionIndex * 10,
      }]
    }
    if (
      action.actionType === 'friend_field'
      && typeof config.fieldId === 'string'
      && config.fieldId
      && config.op === 'set'
    ) {
      return [{
        ...common,
        id: action.id,
        type: 'set_metadata',
        params: { values: { [config.fieldId]: config.value ?? '' } },
        sortOrder: actionIndex * 10,
      }]
    }
    if (action.actionType === 'send_message' && typeof config.content === 'string' && config.content.trim()) {
      return [{ ...common, id: action.id, type: 'send_message', params: { content: config.content }, sortOrder: actionIndex * 10 }]
    }
    if (action.actionType === 'send_template' && typeof config.templateId === 'string' && config.templateId) {
      return [{ ...common, id: action.id, type: 'send_message', params: { templateId: config.templateId }, sortOrder: actionIndex * 10 }]
    }
    if (action.actionType === 'reminder' && typeof config.reminderId === 'string' && config.reminderId) {
      return [{ ...common, id: action.id, type: 'start_reminder', params: { reminderId: config.reminderId }, sortOrder: actionIndex * 10 }]
    }
    if (action.actionType === 'event_booking' && typeof config.eventId === 'string' && config.eventId) {
      return [{ ...common, id: action.id, type: 'common_action', params: { eventId: config.eventId }, sortOrder: actionIndex * 10 }]
    }
    return []
  })
}

interface Option {
  id: string
  name: string
}

export interface ActionTargetOption extends Option {
  /** 行の右に出す補足（種別・状態など）。無ければ出さない。 */
  hint?: string
  /** 選んだ対象の内容の抜粋（テンプレートの本文など）。無ければ出さない。 */
  excerpt?: string
}

export interface ActionLookups {
  tags: Option[]
  fields: Option[]
  marks: Option[]
  scenarios: Option[]
  vars: { varKey: string; name: string }[]
  templates: ActionTargetOption[]
  reminders: ActionTargetOption[]
  events: ActionTargetOption[]
}

/** 長い本文を見出し用に切る。途中で切ったことが分かるよう「…」を付ける。 */
function truncateSummary(text: string, length = 24): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length > length ? `${trimmed.slice(0, length)}…` : trimmed
}

/*
 * R240: 動作の見出しと要約は、行番号ではなく実際の種別・対象・値から作る。
 * 並べ替えで変わるのは順序番号だけにする。
 */
export function describeAction(action: ScenarioAction, lookups: ActionLookups): string {
  const c = (action.config ?? {}) as Record<string, unknown>
  const tagNames = (ids: unknown) =>
    (Array.isArray(ids) ? ids : [])
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((id) => lookups.tags.find((t) => t.id === id)?.name ?? '名称不明のタグ')
  switch (action.actionType) {
    case 'tag': {
      const names = tagNames(c.tagIds)
      return `${c.op === 'remove' ? 'タグをはずす' : 'タグを追加'}${names.length > 0 ? `「${names.join('・')}」` : '（タグ未選択）'}`
    }
    case 'friend_field': {
      const field = typeof c.fieldId === 'string' ? lookups.fields.find((f) => f.id === c.fieldId)?.name : undefined
      if (!field) return '項目未選択'
      const value = String(c.value ?? '')
      if (c.op === 'clear') return `「${field}」を消去`
      if (c.op === 'add') return `「${field}」に「${value}」を足す`
      if (c.op === 'sub') return `「${field}」から「${value}」を引く`
      return `「${field}」に「${value}」を入れる`
    }
    case 'support_mark': {
      const mark = typeof c.markId === 'string' && c.markId
        ? lookups.marks.find((m) => m.id === c.markId)?.name
        : undefined
      return mark ? `対応マークを「${mark}」に変更` : 'マークを外す'
    }
    case 'scenario': {
      if (c.op === 'resume_previous') return '1つ前のシナリオを再開'
      const name = typeof c.scenarioId === 'string' && c.scenarioId
        ? lookups.scenarios.find((s) => s.id === c.scenarioId)?.name
        : undefined
      if (c.op === 'stop') return name ? `「${name}」の購読を止める` : 'このシナリオの購読を止める'
      return name ? `「${name}」の購読を始める` : '（シナリオ未選択）'
    }
    case 'common_var': {
      const target = typeof c.varKey === 'string' ? lookups.vars.find((v) => v.varKey === c.varKey)?.name : undefined
      if (!target) return '共通情報未選択'
      return `「${target}」に「${String(c.value ?? '')}」を${c.op === 'sub' ? '引く' : '足す'}`
    }
    case 'send_message': {
      const content = typeof c.content === 'string' ? c.content.trim() : ''
      return content ? `「${truncateSummary(content)}」を送信` : '本文未入力'
    }
    case 'send_template': {
      const target = typeof c.templateId === 'string' && c.templateId
        ? lookups.templates.find((t) => t.id === c.templateId)?.name
        : undefined
      return target ? `テンプレート「${target}」を送信` : 'テンプレート未選択'
    }
    case 'reminder': {
      const target = typeof c.reminderId === 'string' && c.reminderId
        ? lookups.reminders.find((t) => t.id === c.reminderId)?.name
        : undefined
      return target ? `リマインダ「${target}」` : 'リマインダ未選択'
    }
    case 'event_booking': {
      const target = typeof c.eventId === 'string' && c.eventId
        ? lookups.events.find((t) => t.id === c.eventId)?.name
        : undefined
      return target ? `イベント予約「${target}」` : 'イベント予約未選択'
    }
    default:
      return '設定した内容を実行'
  }
}

/*
 * R243: 編集中の未完成行は保持し、保存のときに入力不足を案内する。
 * 未完成のまま黙って「条件なし」に置き換えない。
 */
export function findConditionDraftIssue(draft: SegmentCondition | null): string | null {
  if (!draft || isEmptyCondition(draft)) return null
  const hasIncompleteRule = (rules: SegmentRule[]) => rules.some((rule) => !isRuleComplete(rule))
  if (hasIncompleteRule(draft.rules ?? [])) {
    return '入力が未完成の条件があります。空欄を埋めるか、「この条件を外す」で取り除いてください。'
  }
  for (const group of draft.groups ?? []) {
    if ((group.rules ?? []).length === 0) {
      return '空の「いずれか」の条件のかたまりがあります。項目を足すか、かたまりを外してください。'
    }
    if (hasIncompleteRule(group.rules ?? [])) {
      return '入力が未完成の条件があります。空欄を埋めるか、「この条件を外す」で取り除いてください。'
    }
  }
  return null
}

export interface ActionEditorProps {
  scenarioId: string
  hook: ScenarioActionHook
  stepId?: string | null
  choiceIndex?: number | null
  /** 見出しに出す説明。「この通を送ったあと」など。 */
  title: string
  onClose: () => void
  /** 保存のたびに呼ぶ。件数バッジの更新に使う。 */
  onChanged?: () => void
}

export default function ActionEditor({
  scenarioId,
  hook,
  stepId = null,
  choiceIndex = null,
  title,
  onClose,
  onChanged,
}: ActionEditorProps) {
  const { selectedAccountId } = useAccount()
  // 任意機能の動作種は、そのaccountで機能がオフなら追加口ごと出さない。
  const actionFeatureVisibility = useFeatureVisibility(selectedAccountId)
  const [actions, setActions] = useState<ScenarioAction[]>([])
  const actionsRef = useRef<ScenarioAction[]>([])
  const setActionsSync = (next: ScenarioAction[]) => {
    actionsRef.current = next
    setActions(next)
  }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [conditionFor, setConditionFor] = useState<string | null>(null)
  /*
   * R243: 条件は編集中の下書きとして持ち、保存のときだけ整える。
   * 入力のたびに作り直して欄を閉じたり、空値を取り除いたりしない。
   */
  const [conditionDraft, setConditionDraft] = useState<SegmentCondition | null>(null)
  const [conditionError, setConditionError] = useState('')
  const [conditionSaving, setConditionSaving] = useState(false)
  /*
   * R244: 内容編集の開閉は画面側で持つ。保存のたびに作り直して閉じない。
   * R242: キャンセルは開く前の値に戻すための、開いたときの写し。
   */
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const initialRef = useRef<ScenarioAction[] | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [draftVersion, setDraftVersion] = useState(0)
  const draftVersionRef = useRef(0)
  const [draftSaving, setDraftSaving] = useState(false)
  /* 打ち続けても保存の順序が入れ替わらないよう、保存は1本の列に並べる。 */
  const saveQueueRef = useRef(Promise.resolve())

  const [tags, setTags] = useState<Option[]>([])
  const [fields, setFields] = useState<Option[]>([])
  const [marks, setMarks] = useState<Option[]>([])
  const [scenarioOpts, setScenarioOpts] = useState<Option[]>([])
  const [vars, setVars] = useState<{ varKey: string; name: string }[]>([])
  /* R245: テンプレート・リマインダ・イベント予約は名前で選ぶための候補。 */
  const [templates, setTemplates] = useState<ActionTargetOption[]>([])
  const [reminders, setReminders] = useState<ActionTargetOption[]>([])
  const [events, setEvents] = useState<ActionTargetOption[]>([])
  const [targetsLoading, setTargetsLoading] = useState(false)

  const lookups: ActionLookups = {
    tags,
    fields,
    marks,
    scenarios: scenarioOpts,
    vars,
    templates,
    reminders,
    events,
  }

  /* 一覧の取得。表示の作り直しは呼び出し側が決める。 */
  const fetchActions = useCallback(async (): Promise<ScenarioAction[]> => {
    const res = await api.scenarios.actions.list(scenarioId)
    if (!res.success) {
      setError(res.error)
      return actionsRef.current
    }
    return res.data.filter(
        (a) =>
          a.hook === hook &&
          (a.stepId ?? null) === (stepId ?? null) &&
          (a.choiceIndex ?? null) === (choiceIndex ?? null),
      )
  }, [scenarioId, hook, stepId, choiceIndex])

  /* 初回の読み込みだけ「読み込んでいます」を出す。R244: 保存のたびに
   * 作り直して編集欄を閉じないよう、更新時は黙って入れ替える。 */
  const load = useCallback(async (): Promise<ScenarioAction[]> => {
    setLoading(true)
    const next = await fetchActions()
    setActionsSync(next)
    if (initialRef.current === null) initialRef.current = next
    setLoading(false)
    return next
  }, [fetchActions])

  /* 保存後の読み直し。開いている編集欄・入力焦点を残すため、読み込み中の
   * 表示には切り替えない。 */
  const refresh = useCallback(async (): Promise<ScenarioAction[]> => {
    const next = await fetchActions()
    setActionsSync(next)
    return next
  }, [fetchActions])

  const saveDraftSnapshot = async (next: ScenarioAction[]) => {
    if (!selectedAccountId) {
      setError('LINE公式アカウントを選んでください')
      return false
    }
    setDraftSaving(true)
    try {
      const response = await api.scenarios.saveDraft(scenarioId, {
        lineAccountId: selectedAccountId,
        expectedVersion: draftVersionRef.current,
        afterActions: toDraftActions(next),
      })
      if (!response.success) {
        setError(response.error)
        return false
      }
      draftVersionRef.current = response.data.version
      setDraftVersion(response.data.version)
      return true
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'V6下書きを保存できませんでした')
      return false
    } finally {
      setDraftSaving(false)
    }
  }

  /* 保存は1本の列に並べる。打ち続けても順序が入れ替わらない。 */
  const enqueue = (task: () => Promise<void>) => {
    const run = saveQueueRef.current.then(task, task)
    saveQueueRef.current = run.catch(() => {})
    return run
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      load(),
      selectedAccountId
        ? api.scenarios.getDraft(scenarioId, selectedAccountId).catch(() => null)
        : Promise.resolve(null),
    ]).then(([, draftResponse]) => {
      if (cancelled) return
      const version = draftResponse?.success && draftResponse.data ? draftResponse.data.version : 0
      draftVersionRef.current = version
      setDraftVersion(version)
    })
    return () => {
      cancelled = true
    }
  }, [load, scenarioId, selectedAccountId])

  useEffect(() => {
    if (!selectedAccountId) {
      setMarks([])
      return
    }
    void (async () => {
      setTargetsLoading(true)
      const toOption = (row: unknown): Option => {
        const record = (row ?? {}) as Record<string, unknown>
        return {
          id: String(record.id ?? ''),
          name: String(record.name ?? '名称未設定'),
        }
      }
      const [tagRes, fieldRes, markRes, scenarioRes, varRes, templateRes, reminderRes, eventRes] =
        await Promise.all([
          scenarioReferenceData.tags(selectedAccountId),
          scenarioReferenceData.friendFields(selectedAccountId),
          scenarioReferenceData.supportMarks(selectedAccountId),
          scenarioReferenceData.scenarios(selectedAccountId),
          scenarioReferenceData.commonVars(selectedAccountId),
          scenarioReferenceData.templates(selectedAccountId),
          scenarioReferenceData.reminders(selectedAccountId),
          scenarioReferenceData.events(selectedAccountId),
        ])
      if (tagRes.success) setTags(tagRes.data.map((t) => ({ id: t.id, name: t.name })))
      if (fieldRes.success) setFields(fieldRes.data.map((f) => ({ id: f.id, name: f.name })))
      if (markRes.success) setMarks(markRes.data.map((m) => ({ id: m.id, name: m.name })))
      if (scenarioRes.success)
        setScenarioOpts(
          scenarioRes.data.filter((s) => s.id !== scenarioId).map((s) => ({ id: s.id, name: s.name })),
        )
      if (varRes.success) setVars(varRes.data.map((v) => ({ varKey: v.varKey, name: v.name })))
      /* R245: 対象はアカウントで絞った候補から名前で選ぶ。 */
      if (templateRes.success) {
        setTemplates(
          templateRes.data.map((t) => {
            const record = (t ?? {}) as Record<string, unknown>
            const content = typeof record.messageContent === 'string' ? record.messageContent : ''
            const excerpt = content.trim().replace(/\s+/g, ' ').slice(0, 80)
            return { ...toOption(t), excerpt: excerpt || undefined }
          }),
        )
      }
      if (reminderRes.success) setReminders(reminderRes.data.map(toOption))
      if (eventRes.success) {
        setEvents(
          eventRes.data.map((e) => {
            const record = (e ?? {}) as unknown as Record<string, unknown>
            return {
              ...toOption(e),
              hint: record.is_published ? '公開中' : '下書き',
            }
          }),
        )
      }
      setTargetsLoading(false)
    })()
  }, [scenarioId, selectedAccountId])

  const add = (kind: (typeof ACTION_KINDS)[number]) => {
    setError('')
    void enqueue(async () => {
      const res = await api.scenarios.actions.create(scenarioId, {
        hook,
        stepId,
        choiceIndex,
        actionType: kind.type,
        config: kind.make(),
        repeatOnRefire: true,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      const fresh = await refresh()
      await saveDraftSnapshot(fresh)
      onChanged?.()
    })
  }

  /*
   * R244: 打った値はまず画面に写し、保存は裏で列に並べる。保存に失敗しても
   * 入力は残し、欄外の文で知らせる。読み直しで編集欄を作り直さない。
   */
  const save = (action: ScenarioAction, patch: Partial<ScenarioAction>) => {
    setError('')
    const next = actionsRef.current.map((a) => (a.id === action.id ? { ...a, ...patch } : a))
    setActionsSync(next)
    void enqueue(async () => {
      const res = await api.scenarios.actions.update(scenarioId, action.id, {
        config: patch.config ?? action.config,
        condition: patch.condition !== undefined ? patch.condition : action.condition,
        repeatOnRefire: patch.repeatOnRefire ?? action.repeatOnRefire,
        sortOrder: patch.sortOrder ?? action.sortOrder,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      await saveDraftSnapshot(next)
      onChanged?.()
    })
  }

  const remove = (action: ScenarioAction) => {
    setError('')
    if (expandedId === action.id) setExpandedId(null)
    setActionsSync(actionsRef.current.filter((a) => a.id !== action.id))
    void enqueue(async () => {
      const res = await api.scenarios.actions.remove(scenarioId, action.id)
      if (!res.success) {
        setError(res.error)
        await refresh()
        return
      }
      const fresh = await refresh()
      await saveDraftSnapshot(fresh)
      onChanged?.()
    })
  }

  /** 上下の入れ替え。並び順は実行順なので、見た目と実行が一致している必要がある。 */
  const move = (index: number, direction: -1 | 1) => {
    const list = actionsRef.current
    const target = list[index + direction]
    if (!target) return
    const current = list[index]
    if (!current) return
    setError('')
    const next = [...list]
    next[index] = target
    next[index + direction] = current
    setActionsSync(next)
    void enqueue(async () => {
      const first = await api.scenarios.actions.update(scenarioId, current.id, {
        sortOrder: target.sortOrder,
      })
      const second = await api.scenarios.actions.update(scenarioId, target.id, {
        sortOrder: current.sortOrder,
      })
      if (!first.success) setError(first.error)
      else if (!second.success) setError(second.error)
      const fresh = await refresh()
      await saveDraftSnapshot(fresh)
      onChanged?.()
    })
  }

  /* R243: 条件の窓を開くとき、下書きに写して持つ。入力のたびに保存しない。 */
  const openCondition = (action: ScenarioAction) => {
    setConditionError('')
    setConditionDraft((action.condition as SegmentCondition | null) ?? null)
    setConditionFor(action.id)
  }

  /* R243: 保存のときだけ整える。未完成があれば欄を残して不足を案内する。 */
  const saveCondition = () => {
    const target = actionsRef.current.find((a) => a.id === conditionFor)
    if (!target) {
      setConditionFor(null)
      return
    }
    const issue = findConditionDraftIssue(conditionDraft) ?? findInvalidRangeIssue(conditionDraft)
    if (issue) {
      setConditionError(issue)
      return
    }
    setConditionError('')
    setConditionSaving(true)
    void enqueue(async () => {
      try {
        const res = await api.scenarios.actions.update(scenarioId, target.id, {
          condition: conditionDraft,
        })
        if (!res.success) {
          setError(res.error)
          return
        }
        const fresh = await refresh()
        await saveDraftSnapshot(fresh)
        onChanged?.()
        setConditionFor(null)
      } finally {
        setConditionSaving(false)
      }
    })
  }

  /*
   * R242: キャンセルは開く前の値に戻す。足したものは消し、消したものは
   * 作り直し、変えたものは書き戻してから閉じる。
   */
  const cancel = () => {
    const initial = initialRef.current
    if (!initial) {
      onClose()
      return
    }
    setCancelling(true)
    setError('')
    void enqueue(async () => {
      try {
        const current = await fetchActions()
        const initialIds = new Set(initial.map((a) => a.id))
        for (const a of current) {
          if (!initialIds.has(a.id)) {
            const res = await api.scenarios.actions.remove(scenarioId, a.id)
            if (!res.success) throw new Error(res.error)
          }
        }
        const currentIds = new Set(current.map((a) => a.id))
        for (const seed of initial) {
          if (!currentIds.has(seed.id)) {
            const res = await api.scenarios.actions.create(scenarioId, {
              hook: seed.hook,
              stepId: seed.stepId,
              choiceIndex: seed.choiceIndex,
              actionType: seed.actionType,
              config: seed.config ?? {},
              condition: seed.condition ?? null,
              repeatOnRefire: seed.repeatOnRefire,
              sortOrder: seed.sortOrder,
            })
            if (!res.success) throw new Error(res.error)
          } else {
            const res = await api.scenarios.actions.update(scenarioId, seed.id, {
              config: seed.config,
              condition: seed.condition ?? null,
              repeatOnRefire: seed.repeatOnRefire,
              sortOrder: seed.sortOrder,
            })
            if (!res.success) throw new Error(res.error)
          }
        }
        const fresh = await refresh()
        await saveDraftSnapshot(fresh)
        onChanged?.()
        onClose()
      } catch (restoreError) {
        setError(
          restoreError instanceof Error ? restoreError.message : '開く前の状態に戻せませんでした',
        )
      } finally {
        setCancelling(false)
      }
    })
  }

  const editing = actions.find((a) => a.id === conditionFor) ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'color-mix(in srgb, var(--color-ink) 40%, transparent)' }}>
      <div data-design-node="hz9ti" className={`${styles.dialog} flex w-full flex-col overflow-hidden rounded-card shadow-lg`}>
        {/* ① 見出しと説明。設計は見出し20/700・説明13。 */}
        <div className="border-hairline flex flex-wrap items-start justify-between gap-3 border-b px-6" style={{ paddingBlock: 18 }}>
          <div className="min-w-0">
            <h2 className="text-ink text-title font-bold">送信後のアクションを設定</h2>
            <p className="text-ink-secondary mt-1 text-label leading-relaxed">
              外部サービスの8動作をすべて扱い、条件分岐と実行順をこの画面だけで組み立てます。
            </p>
            <p className="hidden">{title}に実行する動作を決めます。上から順に実行します。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-secondary shrink-0 px-2 text-2xl leading-none"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        {editing ? (
          <div className="flex-1 px-6 pb-5 pt-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-ink text-sm font-bold">
                {actions.indexOf(editing) + 1}. [{KIND_LABEL[editing.actionType]}] の条件設定
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConditionFor(null)}
                  className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-9 border px-4 text-sm"
                >
                  戻る
                </button>
                <Button variant="primary" onClick={saveCondition} disabled={conditionSaving}>
                  {conditionSaving ? '保存中…' : '条件を保存'}
                </Button>
              </div>
            </div>
            <p className="text-ink-secondary mb-4 text-xs">
              ここで決めた条件に合う友だちにだけ、この動作を実行します。条件なしなら全員に実行します。
            </p>
            {conditionError && (
              <Notice tone="validation" className="mb-4">
                {conditionError}
              </Notice>
            )}
            {/*
              R243: 編集中の未完成行は下書きとして保持し、保存のときだけ
              不足を案内する。入力のたびに取り除かない。
            */}
            <ConditionBuilder value={conditionDraft} onChange={setConditionDraft} />
          </div>
        ) : (
          <div className="flex-1 px-6 pb-5 pt-0">
            {error && (
              <Notice tone="danger" className="mb-4">
                {error}
              </Notice>
            )}
            {/* R242: 保存方式と取消結果を目に見える形で示す。 */}
            <p className="text-ink-secondary mb-4 text-xs">
              追加・変更・削除はその場で保存されます。キャンセルは開いたときの状態に戻します。
            </p>
            {loading ? (
              <p className="text-ink-faint py-8 text-center text-sm">読み込んでいます</p>
            ) : (
              <div className="space-y-4">
                {/*
                  R240: 実際の種別と順序から組み立てる。0件は未設定と出す。
                  並べ替えで変わるのは順序番号だけ。
                  R241: 保存済みセットの検索・保存・呼出しの口は無いので、
                  呼出し操作と保存名の入力は置かない（置くと保存できる
                  ように見えて設定済みだと誤認させる）。
                */}
                <section className="bg-canvas-sunken rounded-control px-4 py-5">
                  <p className="text-ink text-sm font-bold">現在の送信後アクション</p>
                  <p className="text-ink-secondary mt-2 text-sm">
                    {actions.length === 0
                      ? '未設定'
                      : actions
                          .map((action, index) => `${index + 1}. ${KIND_LABEL[action.actionType]}`)
                          .join(' → ')}
                  </p>
                </section>
                {/*
                  ③ 追加する動作を選ぶ。設計は一覧より前。
                  1つも無いときに「次に何をするか」が画面の一番下にあると、
                  空の枠だけを見て手が止まる。
                */}
                <section>
                  <h3 className="text-ink text-sm font-bold">追加する動作を選ぶ</h3>
                  <p className="sr-only">
                    選ぶと、下の「実行する動作」の最後に足します。中身はあとから決められます。
                  </p>
                  {/* 設計は4×2。実装が持つ種別は5つなので、押せない札は並べない。 */}
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {ACTION_KINDS.filter((kind) => kind.type !== 'common_var' && (!kind.feature || actionFeatureVisibility.enabled(kind.feature))).map((kind) => {
                      const Icon = kind.icon
                      return (
                        <button
                          key={kind.type}
                          type="button"
                          onClick={() => void add(kind)}
                          className={`${styles.kindButton} border-hairline text-ink hover:bg-canvas-sunken flex flex-col items-center justify-center gap-1 border text-caption font-bold transition-colors`}
                        >
                          <Icon aria-hidden size={18} strokeWidth={1.75} />
                          {kind.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="sr-only">
                    {draftSaving
                      ? 'V6下書きへ保存しています…'
                      : `変更時にV6下書きへ保存${draftVersion > 0 ? `・版${draftVersion}` : ''}`}
                  </p>
                </section>

                {/* ④ 実行する動作。並び順がそのまま実行順。 */}
                <section>
                  <h3 className="text-ink text-sm font-bold">実行する動作（上から順に実行）</h3>
                  <p className="sr-only">
                    「発動2回目以降も実行する」は動作ごとに決めます。同じ友だちが2回目に通ったとき、
                    タグは付け直しても、加算はもう一度足したくない、といった使い分けができます。
                  </p>
                  <div className="mt-1 space-y-2">
                    {actions.map((action, index) => {
                      const open = expandedId === action.id
                      return (
                      <div key={action.id} className="border-hairline rounded-card border">
                        <div className={`${styles.actionRow} bg-canvas-sunken flex flex-wrap items-center justify-between gap-2 px-4 py-2.5`}>
                          <p className="text-ink flex flex-wrap items-center gap-2 text-sm font-bold">
                            {/* 実行順の丸番号（設計 26x26）。並べ替えるとここが変わる。 */}
                            <span className={`${styles.orderMark} bg-accent-deep text-on-accent flex shrink-0 items-center justify-center rounded-pill text-caption font-bold`}>
                              {index + 1}
                            </span>
                            {/*
                              R240: 種別と要約は実際の設定から作る。並べ替えで
                              変わるのは順序番号だけ。
                            */}
                            <span><span className="block">{KIND_LABEL[action.actionType]}</span><span className="text-ink-secondary mt-1 block text-xs font-normal">{describeAction(action, lookups)}</span></span>
                            {/* 埋まっていないアクションは配信で実行されない。
                                黙って何もしないと、効いていないことに気づけない。 */}
                            {action.complete === false && (
                              <span className="bg-warning-bg text-warning rounded-pill px-2 py-0.5 font-medium" style={{ fontSize: 10 }}>
                                未完成 — 配信では実行されません
                              </span>
                            )}
                          </p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openCondition(action)}
                              className={`rounded-control h-9 border px-3 text-xs ${
                                action.condition
                                  ? 'border-accent text-accent-deep bg-accent-soft'
                                  : 'border-hairline text-ink-secondary'
                              }`}
                            >
                              {action.condition ? '条件ON' : '条件OFF'}
                            </button>
                            {/*
                              R244: 開閉は画面側で持つ。保存のたびに作り直して
                              閉じないし、入力焦点も残る。
                            */}
                            <button
                              type="button"
                              onClick={() => setExpandedId(open ? null : action.id)}
                              aria-expanded={open}
                              className="text-action cursor-pointer list-none text-xs"
                            >
                              内容を編集
                            </button>
                          </div>
                        </div>
                        {open && (
                          <div className="border-hairline border-t p-4">
                            <ActionConfigEditor action={action} tags={tags} fields={fields} marks={marks} scenarios={scenarioOpts} vars={vars} templates={templates} reminders={reminders} events={events} targetsLoading={targetsLoading} onChange={(config) => save(action, { config })} />
                            <Checkbox className="mt-3" checked={action.repeatOnRefire} onCheckedChange={(checked) => save(action, { repeatOnRefire: checked })}>発動2回目以降も実行する</Checkbox>
                            <div className="mt-3 flex gap-2"><button type="button" onClick={() => move(index, -1)} disabled={index === 0}>上へ</button><button type="button" onClick={() => move(index, 1)} disabled={index === actions.length - 1}>下へ</button><button type="button" onClick={() => remove(action)} className="text-danger">削除</button></div>
                          </div>
                        )}
                      </div>
                      )
                    })}
                    {actions.length === 0 && (
                      <p className="text-ink-faint rounded-card border-hairline border border-dashed py-8 text-center text-sm">
                        まだ動作がありません。上の「追加する動作を選ぶ」から足してください。
                      </p>
                    )}
                  </div>
                </section>
                <p className="text-ink-faint text-xs">各動作の「条件ON」から15軸の条件ビルダーを開き、分岐できます。</p>
              </div>
            )}
          </div>
        )}
        {/* R242: キャンセルは開く前の値に戻して閉じる。反映は今の内容のまま閉じる。 */}
        {!editing && <div className="border-hairline flex justify-end gap-2 border-t px-6 py-4"><Button onClick={cancel} disabled={cancelling}>{cancelling ? '戻しています…' : 'キャンセル'}</Button><Button variant="primary" onClick={onClose}>このアクションを反映</Button></div>}
      </div>
    </div>
  )
}

const inputClass = 'border-hairline rounded-control text-ink h-9 border px-3 text-sm min-w-0 flex-1'

/**
 * アクション1つぶんの中身を編集する。
 *
 * 値と onChange だけで動く。シナリオ（scenario_actions の行）からも、
 * 自動応答（actions_json）からも同じものを使う。**中身の編集を2つ持つと、
 * 種別を足したときに片方だけ増える。**
 */
/*
 * R245: テンプレート・リマインダ・イベント予約の対象は、アカウントで絞った
 * 候補から名前で選ぶ。IDの直入力では運用者が選べず、内容も確かめられない。
 */
function TargetSelector({
  label,
  kindName,
  value,
  options,
  loading,
  onChange,
}: {
  /** 欄の名前（読み上げ用）。 */
  label: string
  /** 「選べる○○がありません」の○○。 */
  kindName: string
  value: string
  options: ActionTargetOption[]
  loading: boolean
  onChange: (value: string) => void
}) {
  const missing = value !== '' && !options.some((o) => o.id === value)
  return (
    <div className="min-w-0 flex-1">
      <Combobox
        aria-label={label}
        value={value}
        onChange={onChange}
        options={[
          ...options.map((o) => ({ value: o.id, label: o.name, hint: o.hint })),
          ...(missing ? [{ value, label: '現在の保存値（名前を取得できません）' }] : []),
        ]}
        loading={loading}
        placeholder="名前で探す"
      />
      {!loading && options.length === 0 && !missing && (
        <p className="text-ink-secondary mt-1.5 text-xs">選べる{kindName}がありません。</p>
      )}
      {missing && (
        <p className="text-warning mt-1.5 text-xs">
          保存されている対象はこのアカウントの候補にありません（別アカウント・削除済みの可能性）。選び直すと上書きされます。
        </p>
      )}
    </div>
  )
}

export function ActionConfigEditor({
  action,
  tags,
  fields,
  marks,
  scenarios,
  vars,
  templates = [],
  reminders = [],
  events = [],
  targetsLoading = false,
  onChange,
}: {
  action: ScenarioAction
  tags: Option[]
  fields: Option[]
  marks: Option[]
  scenarios: Option[]
  vars: { varKey: string; name: string }[]
  templates?: ActionTargetOption[]
  reminders?: ActionTargetOption[]
  events?: ActionTargetOption[]
  targetsLoading?: boolean
  onChange: (config: unknown) => void
}) {
  const c = (action.config ?? {}) as Record<string, unknown>

  switch (action.actionType) {
    case 'tag': {
      const selected = Array.isArray(c.tagIds) ? (c.tagIds as string[]) : []
      return (
        <>
          <RadioCardGroup legend="タグの操作" className="flex flex-wrap items-center gap-4">
            {(['add', 'remove'] as const).map((op) => (
              <RadioCard
                key={op}
                name="tag-op"
                value={op}
                checked={(c.op ?? 'add') === op}
                onChange={() => onChange({ ...c, op })}
                title={op === 'add' ? 'タグを追加' : 'タグをはずす'}
              />
            ))}
          </RadioCardGroup>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const on = selected.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...c,
                      tagIds: on ? selected.filter((id) => id !== tag.id) : [...selected, tag.id],
                    })
                  }
                  className={`rounded-pill h-8 px-3 text-xs transition-colors ${
                    on ? 'bg-accent-deep text-on-accent' : 'border-hairline text-ink-secondary border'
                  }`}
                >
                  {tag.name}
                </button>
              )
            })}
          </div>
        </>
      )
    }

    case 'friend_field':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="友だち情報の項目"
            value={String(c.fieldId ?? '')}
            onChange={(value) => onChange({ ...c, fieldId: value })}
            options={[
              { value: '', label: '項目を選ぶ' },
              ...fields.map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
          <span className="text-ink-secondary text-sm">に</span>
          {c.op !== 'clear' && (
            <input
              value={String(c.value ?? '')}
              onChange={(e) => onChange({ ...c, value: e.target.value })}
              className={inputClass}
            />
          )}
          <span className="text-ink-secondary text-sm">を</span>
          <Select
            aria-label="友だち情報の操作"
            value={String(c.op ?? 'set')}
            onChange={(value) => onChange({ ...c, op: value })}
            options={[
              { value: 'set', label: '← (代入)' },
              { value: 'add', label: '＋ (加算)' },
              { value: 'sub', label: '－ (減算)' },
              { value: 'clear', label: 'X (消去)' },
            ]}
          />
          <span className="text-ink-secondary text-sm">する</span>
        </div>
      )

    case 'support_mark':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">対応マーク</span>
          <Select
            aria-label="対応マーク"
            value={String(c.markId ?? '')}
            onChange={(value) => onChange({ ...c, markId: value || null })}
            options={[
              { value: '', label: 'マークを外す' },
              ...marks.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        </div>
      )

    case 'scenario':
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="シナリオ操作"
              value={String(c.op ?? 'start')}
              onChange={(value) => onChange({ ...c, op: value })}
              options={[
                { value: 'start', label: '購読を始める' },
                { value: 'stop', label: '購読を止める' },
                { value: 'resume_previous', label: '1つ前のシナリオを再開する' },
              ]}
            />
            {c.op !== 'resume_previous' && (
              <Select
                aria-label="対象のシナリオ"
                value={String(c.scenarioId ?? '')}
                onChange={(value) => onChange({ ...c, scenarioId: value })}
                options={[
                  { value: '', label: c.op === 'stop' ? 'このシナリオ' : 'シナリオを選ぶ' },
                  ...scenarios.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            )}
          </div>
          {c.op === 'start' && (
            <div className="bg-canvas-sunken rounded-card space-y-2 px-3 py-2.5">
              <p className="text-ink text-xs font-bold">シナリオを購読する場合</p>
              <RadioCardGroup legend="シナリオを購読する場合">
                {(
                  [
                    { value: 'from_start', label: '(新規)最初から／(再開)最初から' },
                    { value: 'from_read', label: '(再開)友だちが読んだところから' },
                  ] as const
                ).map((opt) => (
                  <RadioCard
                    key={opt.value}
                    name="scenario-restart"
                    value={opt.value}
                    checked={(c.restart ?? 'from_start') === opt.value}
                    onChange={() => onChange({ ...c, restart: opt.value })}
                    title={opt.label}
                  />
                ))}
              </RadioCardGroup>
              <Checkbox
                checked={c.rememberPrevious === true}
                onCheckedChange={(checked) => onChange({ ...c, rememberPrevious: checked })}
              >
                いま読んでいるシナリオを控えて、あとで「1つ前のシナリオを再開」で戻せるようにする
              </Checkbox>
            </div>
          )}
        </div>
      )

    case 'common_var':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="共通情報"
            value={String(c.varKey ?? '')}
            onChange={(value) => onChange({ ...c, varKey: value })}
            options={[
              { value: '', label: '共通情報を選ぶ' },
              ...vars.map((v) => ({ value: v.varKey, label: v.name })),
            ]}
          />
          <span className="text-ink-secondary text-sm">に</span>
          <input
            value={String(c.value ?? '')}
            onChange={(e) => onChange({ ...c, value: e.target.value })}
            className={inputClass}
          />
          <span className="text-ink-secondary text-sm">を</span>
          <Select
            aria-label="共通情報の操作"
            value={String(c.op ?? 'add')}
            onChange={(value) => onChange({ ...c, op: value })}
            options={[
              { value: 'add', label: '＋ (加算)' },
              { value: 'sub', label: '－ (減算)' },
            ]}
          />
          <span className="text-ink-secondary text-sm">する</span>
        </div>
      )

    case 'send_message':
      return <textarea value={String(c.content ?? '')} onChange={(e) => onChange({ ...c, content: e.target.value })} placeholder="送信する本文" />
    case 'send_template': {
      const templateId = typeof c.templateId === 'string' ? c.templateId : ''
      const selected = templates.find((t) => t.id === templateId)
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink text-sm font-medium">テンプレート</span>
            <TargetSelector
              label="テンプレート"
              kindName="テンプレート"
              value={templateId}
              options={templates}
              loading={targetsLoading}
              onChange={(value) => onChange({ ...c, templateId: value })}
            />
          </div>
          {selected?.excerpt && (
            <p className="text-ink-secondary text-xs">内容: {selected.excerpt}</p>
          )}
        </div>
      )
    }
    case 'reminder':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">リマインダ</span>
          <TargetSelector
            label="リマインダ"
            kindName="リマインダ"
            value={typeof c.reminderId === 'string' ? c.reminderId : ''}
            options={reminders}
            loading={targetsLoading}
            onChange={(value) => onChange({ ...c, reminderId: value })}
          />
        </div>
      )
    case 'event_booking':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink text-sm font-medium">イベント予約</span>
          <TargetSelector
            label="イベント予約"
            kindName="イベント予約"
            value={typeof c.eventId === 'string' ? c.eventId : ''}
            options={events}
            loading={targetsLoading}
            onChange={(value) => onChange({ ...c, eventId: value })}
          />
        </div>
      )

    default:
      return null
  }
}
