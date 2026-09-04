'use client'

import { Fragment, useState, useEffect, useCallback, useRef } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Scenario, ScenarioStep, ScenarioTriggerType, MessageType, DeliveryMode, Folder } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import Button from '@/components/shared/button'
import FlexPreviewComponent from '@/components/flex-preview'
import ActionEditor from '@/components/scenarios/action-editor'
import TriggerEditor from '@/components/scenarios/trigger-editor'
import CarouselPicker from '@/components/scenarios/carousel-picker'
import InsertToolbar from '@/components/scenarios/insert-toolbar'
import MessageKindFields, {
  emptyMessageKindState,
  parseMessageKind,
  serializeMessageKind,
  type MessageKind,
  type MessageKindState,
} from '@/components/scenarios/message-kind-fields'

/** 専用の入力欄で書く種別か。 */
function isStructuredKind(type: MessageType): boolean {
  return type === 'location' || type === 'video' || type === 'audio' || type === 'sticker'
}
import QuestionEditor, {
  emptyQuestion,
  type ScenarioQuestion,
} from '@/components/scenarios/question-editor'
import {
  ConditionDialog,
  OnCompleteDialog,
  TestSendDialog,
  ON_COMPLETE_LABEL,
  describeCondition,
  type OnCompleteMode,
} from '@/components/scenarios/scenario-dialogs'
import type { SegmentCondition } from '@/components/shared/condition-builder'
import ScheduleInput, {
  emptySchedule,
  buildSchedulePayload,
  uiFromOffsetMinutes,
  type ScheduleValue,
} from '@/components/scenarios/schedule-input'
import BulkPreviewModal from '@/components/scenarios/bulk-preview-modal'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { Th } from '@/components/shared/table'
import {
  scenarioReachBarWidth,
  scenarioReachCountLabel,
  scenarioReachPercent,
  scenarioReachPercentLabel,
} from './scenario-reach-display'
import { describeAfterSend, describeStepAudience } from './scenario-step-audience'
import { usePageTitle } from '@/components/shell/page-chrome'

type ScenarioWithSteps = Scenario & { steps: ScenarioStep[] }

const triggerOptions: { value: ScenarioTriggerType; label: string }[] = [
  { value: 'friend_add', label: '友だち追加時' },
  { value: 'tag_added', label: 'タグ付与時' },
  { value: 'manual', label: '手動' },
]

/*
 * 送れる種別（132 で拡張）。
 *
 * Flex はLステップのタブには無いが、こちらには前からある。カードタイプの
 * メッセージを直に書くための口なので残す。
 */
const messageTypeOptions: { value: MessageType; label: string }[] = [
  { value: 'text', label: 'テキスト' },
  { value: 'image', label: '画像' },
  { value: 'flex', label: 'Flex（カードタイプ）' },
  { value: 'sticker', label: 'スタンプ' },
  { value: 'location', label: '位置情報' },
  { value: 'video', label: '動画' },
  { value: 'audio', label: '音声' },
  { value: 'carousel', label: 'カルーセル' },
]

const modeBadgeStyle: Record<DeliveryMode, { bg: string; text: string; label: string }> = {
  relative: { bg: 'bg-canvas-sunken', text: 'text-ink-secondary', label: 'Legacy' },
  elapsed: { bg: 'bg-blue-50', text: 'text-blue-700', label: '経過時間' },
  absolute_time: { bg: 'bg-amber-50', text: 'text-amber-700', label: '時刻指定' },
}

function formatDelay(minutes: number): string {
  if (minutes === 0) return '即時'
  if (minutes < 60) return `${minutes}分後`
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m === 0 ? `${h}時間後` : `${h}時間${m}分後`
  }
  const d = Math.floor(minutes / 1440)
  const remaining = minutes % 1440
  if (remaining === 0) return `${d}日後`
  const h = Math.floor(remaining / 60)
  return h > 0 ? `${d}日${h}時間後` : `${d}日${remaining}分後`
}

function formatScheduleLabel(mode: DeliveryMode | undefined, step: ScenarioStep): string {
  const m = mode ?? 'relative'
  if (m === 'relative') return formatDelay(step.delayMinutes)
  if (m === 'elapsed') {
    const days = step.offsetDays ?? 0
    const mins = step.offsetMinutes ?? 0
    const h = Math.floor(mins / 60)
    const r = mins % 60
    if (days === 0 && mins === 0) return '即時 (購読開始)'
    const parts: string[] = []
    if (days > 0) parts.push(`${days}日`)
    if (h > 0) parts.push(`${h}時間`)
    if (r > 0) parts.push(`${r}分`)
    return `購読開始から${parts.join('')}後`
  }
  // absolute_time
  return `購読開始から${step.offsetDays ?? 0}日後の ${step.deliveryTime ?? '00:00'}`
}

interface StepFormState {
  stepOrder: number
  schedule: ScheduleValue
  messageType: MessageType
  messageContent: string
  templateId: string | null
  onReachTagId: string | null
  /** この通を送ったあと。'pause' なら次へ進めず止める。 */
  afterSend: 'continue' | 'pause'
  inputMode: 'direct' | 'template'
  /** 1通ごとの配信対象。null は「購読中の全員に配信する」。 */
  targetCondition: SegmentCondition | null
  /** 質問メッセージ。null ならふつうの通。 */
  question: ScenarioQuestion | null
  /** 下書き。1 なら配信しない。 */
  isDraft: boolean
}

function emptyStepForm(stepOrder: number): StepFormState {
  return {
    stepOrder,
    schedule: { ...emptySchedule },
    messageType: 'text',
    messageContent: '',
    templateId: null,
    onReachTagId: null,
    afterSend: 'continue',
    inputMode: 'direct',
    targetCondition: null,
    question: null,
    isDraft: false,
  }
}

interface TemplateOpt {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  question: ScenarioQuestion | null
}

interface TagOpt {
  id: string
  name: string
}

interface ScenarioStats {
  enrolledTotal: number
  activeNow: number
  completed: number
  paused: number
  steps: Array<{
    stepOrder: number
    reachedCount: number
    reachRate?: number | null
  }>
}

function FlexPreview({ content }: { content: string }) {
  return <FlexPreviewComponent content={content} maxWidth={300} />
}

function ImagePreview({ content }: { content: string }) {
  try {
    const parsed = JSON.parse(content)
    const url = parsed.previewImageUrl || parsed.originalContentUrl
    return (
      <div>
        <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded mb-2 inline-block">画像</span>
        {url ? (
          <img src={url} alt="preview" className="border-hairline rounded-card mt-1 max-w-[200px] border" />
        ) : (
          <p className="text-xs text-ink-faint">プレビューなし</p>
        )}
      </div>
    )
  } catch {
    return <p className="text-xs text-red-500">画像 JSON パースエラー</p>
  }
}

/**
 * 設定の札1枚。設計は5枚を横に並べ、直せるものだけ右上に入口を出す。
 *
 * 直す先が無いものに入口を付けると、押しても何も起きない札ができる。
 * action を渡さなければ、読むだけの札になる。
 */
function SettingCard({
  label,
  action,
  onAction,
  children,
}: {
  label: string
  action?: string
  onAction?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="bg-canvas rounded-card border-hairline border p-4">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="text-ink-faint text-xs">{label}</p>
        {action && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="text-accent shrink-0 text-xs hover:underline"
          >
            {action}
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

/**
 * 通の編集の1段。
 *
 * 設計では「配信タイミング」「メッセージ」「この通の配信対象」「送信後の
 * アクション」がそれぞれ別の面になっている。実装は1枚に全部入っていて、
 * 到達タグ・配信後・絞り込み・下書きが「到達時のアクション」という1つの
 * 見出しの下にまとめて並んでいた。**どれがどの面の話なのかが読めない。**
 *
 * 段に分けて、段ごとに設計のNodeを持たせる。1枚ずつ直すと同じ画面を
 * 4回触ることになるので、区切りは一度に入れる。
 */
function FormSection({
  node,
  title,
  description,
  action,
  children,
}: {
  node?: string
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      data-design-node={node}
      className="bg-canvas border-hairline rounded-card border p-4"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-ink text-sm font-bold">{title}</h4>
          {description && (
            <p className="text-ink-faint mt-0.5 text-xs leading-relaxed">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export default function ScenarioDetailClient({
  scenarioId,
  showStarted = false,
}: {
  scenarioId: string
  showStarted?: boolean
}) {
  usePageTitle('シナリオ詳細')
  const id = scenarioId

  const [scenario, setScenario] = useState<ScenarioWithSteps | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', triggerType: 'friend_add' as ScenarioTriggerType, isActive: true, allowConcurrent: true, folderId: '' })
  const [folders, setFolders] = useState<Folder[]>([])

  useEffect(() => {
    let cancelled = false
    void api.folders.list('scenario').then((res) => {
      if (!cancelled && res.success) setFolders(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const [saving, setSaving] = useState(false)

  const router = useRouter()
  const [duplicating, setDuplicating] = useState(false)
  /** 表の行で開いている1通ぶんのプレビュー。設計の「プレビュー」。 */
  const [previewStepId, setPreviewStepId] = useState<string | null>(null)
  const [duplicatingStepId, setDuplicatingStepId] = useState<string | null>(null)
  const [deleteStepTarget, setDeleteStepTarget] = useState<ScenarioStep | null>(null)
  const [deletingStepId, setDeletingStepId] = useState<string | null>(null)
  const [deleteStepError, setDeleteStepError] = useState('')
  const [deleteScenarioOpen, setDeleteScenarioOpen] = useState(false)
  const [deletingScenario, setDeletingScenario] = useState(false)
  const [deleteScenarioError, setDeleteScenarioError] = useState('')
  const [showStepForm, setShowStepForm] = useState(false)
  /** 何通目のあとに差し込むか。末尾に足すときは null。 */
  const [insertAfter, setInsertAfter] = useState<number | null>(null)
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [stepForm, setStepForm] = useState<StepFormState>(() => emptyStepForm(1))
  const [stepSaving, setStepSaving] = useState(false)
  const [stepError, setStepError] = useState('')

  /* --- 追加した窓。開いているものだけ描く --- */
  /** シナリオ全体の配信対象。 */
  const [audienceOpen, setAudienceOpen] = useState(false)
  /** 最終コンテンツ配信後の処理。 */
  const [onCompleteOpen, setOnCompleteOpen] = useState(false)
  /** 1通ごとの配信対象。編集中のフォームに対して開く。 */
  const [stepTargetOpen, setStepTargetOpen] = useState(false)
  /** テスト送信。null なら閉じている。stepId が null なら全通。 */
  const [testSend, setTestSend] = useState<{ stepId: string | null; label: string } | null>(null)
  /** アクション設定。 */
  const [actionTarget, setActionTarget] = useState<{
    hook: 'step_sent' | 'scenario_completed' | 'choice_selected'
    stepId: string | null
    choiceIndex: number | null
    title: string
  } | null>(null)
  /** 通ごとのアクション件数。バッジに出す。 */
  const [actionCounts, setActionCounts] = useState<Record<string, number>>({})
  /** 開始のきっかけ。窓の開閉と、札に出す件数。 */
  const [triggerOpen, setTriggerOpen] = useState(false)
  const [triggerCount, setTriggerCount] = useState<number | null>(null)
  /** 位置情報・動画・音声・スタンプの入力。 */
  const [kindState, setKindState] = useState<MessageKindState>(() => emptyMessageKindState())
  /** 差し込みをカーソルの位置に入れるために、本文の入力欄を持つ。 */
  const stepBodyRef = useRef<HTMLTextAreaElement>(null)

  const [previewOpen, setPreviewOpen] = useState(false)

  const [stats, setStats] = useState<ScenarioStats | null>(null)
  const [templates, setTemplates] = useState<TemplateOpt[]>([])
  const [tags, setTags] = useState<TagOpt[]>([])

  const deliveryMode: DeliveryMode = (scenario?.deliveryMode ?? 'relative') as DeliveryMode

  const loadScenario = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.scenarios.get(id)
      if (res.success) {
        setScenario(res.data)
        setEditForm({
          name: res.data.name,
          description: res.data.description ?? '',
          triggerType: res.data.triggerType,
          isActive: res.data.isActive,
          allowConcurrent: res.data.allowConcurrent !== false,
          folderId: res.data.folderId ?? '',
        })
      } else {
        setError(res.error)
      }
    } catch {
      setError('シナリオの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadScenario()
  }, [loadScenario])

  // 並列で stats / templates / tags を取得（リグレッションを起こさないよう失敗は無視）
  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([
      api.scenarios.stats(id).catch(() => null),
      api.templates.list().catch(() => null),
      api.tags.list().catch(() => null),
    ]).then(([statsRes, tplRes, tagRes]) => {
      if (cancelled) return
      if (statsRes && statsRes.success) setStats(statsRes.data)
      if (tplRes && tplRes.success) {
        setTemplates(tplRes.data
          .filter((t) => !t.question || t.questionStatus === 'published')
          .map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          messageType: t.messageType,
          messageContent: t.messageContent,
          question: (t.question as ScenarioQuestion | null) ?? null,
        })))
      }
      if (tagRes && tagRes.success) {
        setTags(tagRes.data.map((t) => ({ id: t.id, name: t.name })))
      }
    })
    return () => { cancelled = true }
  }, [id])

  /**
   * 通ごとのアクション件数。行に「アクション 2」と出すために引く。
   * 件数が見えないと、設定したことを忘れて二重に足す。
   */
  const reloadActionCounts = useCallback(() => {
    api.scenarios.actions
      .list(id)
      .then((res) => {
        if (!res.success) return
        const counts: Record<string, number> = {}
        for (const action of res.data) {
          const key = action.hook === 'scenario_completed' ? '__complete__' : (action.stepId ?? '')
          if (!key) continue
          counts[key] = (counts[key] ?? 0) + 1
        }
        setActionCounts(counts)
      })
      .catch(() => {})
  }, [id])

  useEffect(() => {
    if (id) reloadActionCounts()
  }, [id, reloadActionCounts])

  useEffect(() => {
    if (!id) return
    api.scenarios.triggers
      .list(id)
      .then((res) => {
        if (res.success) setTriggerCount(res.data.length)
      })
      .catch(() => {})
  }, [id])

  const reloadStats = useCallback(() => {
    api.scenarios.stats(id).then((r) => { if (r.success) setStats(r.data) }).catch(() => {})
  }, [id])

  /**
   * 重複購読の許可を切り替える。
   *
   * 編集モードに入らずその場で当てる。読むだけの説明の隣にあるものなので、
   * 「編集 → 変更 → 保存」を挟むと、何を編集しているのか分からなくなる。
   */
  const handleConcurrentChange = async (allow: boolean) => {
    if (!scenario || (scenario.allowConcurrent ?? true) === allow) return
    setError('')
    try {
      const res = await api.scenarios.update(id, { allowConcurrent: allow })
      if (res.success) loadScenario()
      else setError(res.error)
    } catch {
      setError('重複購読の設定を変更できませんでした')
    }
  }

  /**
   * シナリオを丸ごと複製する。
   *
   * 似た流れをもう1本作るとき、通を1つずつ写すのは現実的でない。
   * 中身だけ写して、名前に「のコピー」を付け、止めた状態で作る。
   * 作った直後に配信が始まると、確かめる前に届いてしまう。
   */
  const handleDuplicate = async () => {
    if (!scenario || duplicating) return
    setDuplicating(true)
    setError('')
    try {
      const created = await api.scenarios.create({
        name: `${scenario.name} のコピー`,
        description: scenario.description,
        triggerType: scenario.triggerType,
        triggerTagId: scenario.triggerTagId,
        lineAccountId: scenario.lineAccountId,
        isActive: false,
        deliveryMode: scenario.deliveryMode,
        allowConcurrent: scenario.allowConcurrent,
      })
      if (!created.success) throw new Error(created.error)
      // 通は順に足す。まとめて入れる口が無い。
      for (const step of sortedSteps) {
        await api.scenarios.addStep(created.data.id, {
          stepOrder: step.stepOrder,
          offsetMinutes: step.offsetMinutes ?? 0,
          messageType: step.messageType,
          messageContent: step.messageContent,
          templateId: step.templateId ?? null,
          onReachTagId: step.onReachTagId ?? null,
          // 複製先でも同じところで止まる。止まる位置が変わると流れが別物になる。
          afterSend: step.afterSend ?? 'continue',
        })
      }
      router.push(`/scenarios/detail?id=${created.data.id}`)
    } catch {
      setError('複製に失敗しました')
    } finally {
      setDuplicating(false)
    }
  }

  const handleDeleteScenario = async () => {
    if (!scenario || deletingScenario) return
    setDeletingScenario(true)
    setDeleteScenarioError('')
    try {
      const res = await api.scenarios.delete(id)
      if (!res.success) throw new Error(res.error)
      setDeleteScenarioOpen(false)
      router.push('/scenarios')
    } catch {
      setDeleteScenarioError('このシナリオを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeletingScenario(false)
    }
  }

  const handleSaveScenario = async () => {
    if (!editForm.name.trim()) return
    setSaving(true)
    try {
      const res = await api.scenarios.update(id, {
        name: editForm.name,
        description: editForm.description || null,
        folderId: editForm.folderId || null,
        triggerType: editForm.triggerType,
        isActive: editForm.isActive,
        allowConcurrent: editForm.allowConcurrent,
      })
      if (res.success) {
        setEditing(false)
        loadScenario()
      } else {
        setError(res.error)
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const openAddStep = () => {
    const nextOrder = scenario ? (scenario.steps.length > 0 ? Math.max(...scenario.steps.map(s => s.stepOrder)) + 1 : 1) : 1
    setStepForm(emptyStepForm(nextOrder))
    setEditingStepId(null)
    setShowStepForm(true)
    setInsertAfter(null)
    setStepError('')
  }

  /**
   * テンプレートから1通足す。
   *
   * 中身を直に書くのと同じフォームを、最初からテンプレート選択の状態で
   * 開くだけ。別のフォームを作ると、あとから入力欄が片方にしか
   * 足されない形でずれていく。
   */
  /**
   * 質問（分岐）の通を新しく足す。
   *
   * 質問は本文を持たないので、messageContent は空のまま。配信側は
   * question_json があればそちらを組み立てる。
   */
  const openAddQuestionStep = () => {
    const nextOrder = scenario
      ? scenario.steps.length > 0
        ? Math.max(...scenario.steps.map((s) => s.stepOrder)) + 1
        : 1
      : 1
    setStepForm({ ...emptyStepForm(nextOrder), question: emptyQuestion() })
    setEditingStepId(null)
    setShowStepForm(true)
    setInsertAfter(null)
    setStepError('')
  }

  const openAddTemplateStep = () => {
    const nextOrder = scenario
      ? scenario.steps.length > 0
        ? Math.max(...scenario.steps.map(s => s.stepOrder)) + 1
        : 1
      : 1
    setStepForm({ ...emptyStepForm(nextOrder), inputMode: 'template' })
    setEditingStepId(null)
    setShowStepForm(true)
    setInsertAfter(null)
    setStepError('')
  }

  /**
   * 通と通のあいだに差し込む。
   *
   * 末尾にしか足せないと、3通目と4通目のあいだに1通入れたいときに、
   * 後ろを全部作り直すことになる。あいだの「ここに挿入」から開くと、
   * その位置の番号で新しい通を作る。
   */
  const openInsertStep = (afterOrder: number) => {
    setStepForm(emptyStepForm(afterOrder + 1))
    setEditingStepId(null)
    setShowStepForm(true)
    setInsertAfter(afterOrder)
    setStepError('')
  }

  const openEditStep = (step: ScenarioStep) => {
    const ui = uiFromOffsetMinutes(step.offsetMinutes)
    setStepForm({
      stepOrder: step.stepOrder,
      schedule: {
        delayMinutes: step.delayMinutes,
        offsetDays: step.offsetDays ?? 0,
        offsetHours: ui.offsetHours,
        offsetMinutesRemainder: ui.offsetMinutesRemainder,
        deliveryTime: step.deliveryTime ?? '09:00',
      },
      messageType: step.messageType,
      messageContent: step.messageContent,
      templateId: step.templateId ?? null,
      onReachTagId: step.onReachTagId ?? null,
      afterSend: step.afterSend ?? 'continue',
      inputMode: step.templateId ? 'template' : 'direct',
      targetCondition: (step.targetCondition as SegmentCondition | null) ?? null,
      question: (step.question as ScenarioQuestion | null) ?? null,
      isDraft: step.isDraft === true,
    })
    // 専用の欄で書く種別は、保存されている JSON を欄の形に戻す。
    setKindState(
      isStructuredKind(step.messageType)
        ? parseMessageKind(step.messageType as MessageKind, step.messageContent)
        : emptyMessageKindState(),
    )
    setEditingStepId(step.id)
    // 編集はステップ行直下にインライン表示するので、上部の新規追加フォームは閉じる
    setShowStepForm(false)
    setInsertAfter(null)
    setStepError('')
  }

  const closeStepForm = () => {
    setShowStepForm(false)
    setEditingStepId(null)
    setStepError('')
  }

  const handleSaveStep = async () => {
    if (stepForm.question) {
      if (!stepForm.question.text.trim()) {
        setStepError('質問文を入力してください')
        return
      }
      if (stepForm.question.choices.length === 0 || stepForm.question.choices.some((choice) => !choice.label.trim())) {
        setStepError('すべての選択肢に文字を入力してください')
        return
      }
    }
    // 直接入力モード: messageContent 必須 + Flex/画像 は JSON parse 検証
    if (!stepForm.question && stepForm.inputMode === 'direct') {
      if (!stepForm.messageContent.trim()) {
        setStepError('メッセージ内容を入力してください')
        return
      }
      if (stepForm.messageType === 'flex' || stepForm.messageType === 'image') {
        try {
          JSON.parse(stepForm.messageContent)
        } catch {
          setStepError(
            stepForm.messageType === 'flex'
              ? 'Flex メッセージの JSON が不正です'
              : '画像メッセージの JSON が不正です',
          )
          return
        }
      }
    } else {
      if (!stepForm.templateId) {
        setStepError('テンプレートを選択してください')
        return
      }
    }
    setStepSaving(true)
    setStepError('')
    try {
      const schedulePayload = buildSchedulePayload(deliveryMode, stepForm.schedule)
      // テンプレモード保存時は、選択中テンプレ内容を scenario_steps の messageType /
      // messageContent にスナップショットコピーする。テンプレ削除時に resolveStepContent
      // がここから正しい内容にフォールバックできるため。
      let payloadMessageType: MessageType = stepForm.messageType
      let payloadMessageContent: string = stepForm.messageContent || ' '
      if (stepForm.inputMode === 'template' && stepForm.templateId) {
        const tpl = templates.find((t) => t.id === stepForm.templateId)
        if (tpl) {
          // messageType: テンプレが image/carousel のときは scenario_steps の CHECK に
          // ('text','image','flex') の制約があるため text/image/flex のみ許容。
          // carousel が来る可能性は低いが念のため text にフォールバック。
          payloadMessageType = (['text', 'image', 'flex'].includes(tpl.messageType)
            ? tpl.messageType
            : 'text') as MessageType
          payloadMessageContent = tpl.messageContent || ' '
        }
      }
      const payload = {
        stepOrder: stepForm.stepOrder,
        ...schedulePayload,
        messageType: payloadMessageType,
        messageContent: payloadMessageContent,
        templateId: stepForm.inputMode === 'template' ? stepForm.templateId : null,
        onReachTagId: stepForm.onReachTagId,
        afterSend: stepForm.afterSend,
        // null を渡すと「絞り込みなし」に戻る。undefined だと据え置きになるので、
        // 外したつもりが残るのを防ぐために必ず値を送る。
        targetCondition: stepForm.targetCondition,
        question: stepForm.question,
        isDraft: stepForm.isDraft,
      }
      if (editingStepId) {
        const res = await api.scenarios.updateStep(id, editingStepId, payload)
        if (!res.success) {
          setStepError(res.error)
          return
        }
      } else {
        /*
         * あいだに差し込むときは、後ろの通の番号を先に1つずつ送る。
         * 送らずに同じ番号で足すと、並び順が重なってどちらが先か決まらない。
         * 後ろから順に動かすのは、途中で番号がぶつからないようにするため。
         */
        if (insertAfter !== null) {
          const moving = sortedSteps
            .filter((st) => st.stepOrder > insertAfter)
            .sort((a, b) => b.stepOrder - a.stepOrder)
          if (moving.length > 0) {
            const orders = moving.map((st) => ({ stepId: st.id, stepOrder: st.stepOrder + 1 }))
            const moved = await api.scenarios.reorderSteps(id, orders)
            if (!moved.success) {
              setStepError('あいだに入れるための並べ替えに失敗しました')
              return
            }
          }
        }
        const res = await api.scenarios.addStep(id, payload)
        if (!res.success) {
          setStepError(res.error)
          return
        }
      }
      closeStepForm()
      loadScenario()
      reloadStats()
    } catch {
      setStepError('ステップの保存に失敗しました')
    } finally {
      setStepSaving(false)
    }
  }

  /**
   * この通を複製する（設計の行の操作）。
   *
   * 同じ中身の通を、すぐ下（stepOrder + 1）に作る。あいだに入れるので、
   * 後ろの通は「ここに挿入」と同じ経路で押し出される。
   */
  const handleDuplicateStep = async (step: ScenarioStep) => {
    if (duplicatingStepId) return
    setDuplicatingStepId(step.id)
    try {
      await api.scenarios.addStep(id, {
        stepOrder: step.stepOrder + 1,
        messageType: step.messageType,
        messageContent: step.messageContent,
        delayMinutes: step.delayMinutes,
        offsetDays: step.offsetDays ?? undefined,
        offsetMinutes: step.offsetMinutes ?? undefined,
        deliveryTime: step.deliveryTime ?? undefined,
        templateId: step.templateId ?? null,
        onReachTagId: step.onReachTagId ?? null,
        afterSend: step.afterSend,
      })
      loadScenario()
      reloadStats()
    } catch {
      setError('この通を複製できませんでした')
    } finally {
      setDuplicatingStepId(null)
    }
  }

  const handleDeleteStep = async () => {
    if (!deleteStepTarget || deletingStepId) return
    const stepId = deleteStepTarget.id
    setDeletingStepId(stepId)
    setDeleteStepError('')
    try {
      const result = await api.scenarios.deleteStep(id, stepId)
      if (!result.success) throw new Error(result.error)
      if (editingStepId === stepId) closeStepForm()
      setDeleteStepTarget(null)
      void loadScenario()
      void reloadStats()
    } catch {
      setDeleteStepError('この通を削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeletingStepId(null)
    }
  }

  const handleMoveStep = async (stepId: string, direction: 'up' | 'down') => {
    if (!scenario) return
    const sorted = [...scenario.steps].sort((a, b) => a.stepOrder - b.stepOrder)
    const idx = sorted.findIndex((s) => s.id === stepId)
    const swap = direction === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swap < 0 || swap >= sorted.length) return
    const a = sorted[idx]
    const b = sorted[swap]
    try {
      await api.scenarios.reorderSteps(id, [
        { stepId: a.id, stepOrder: b.stepOrder },
        { stepId: b.id, stepOrder: a.stepOrder },
      ])
      loadScenario()
      // 到達率バッジは stepOrder ベースでマッチングするので、並び替え後は stats も再取得
      reloadStats()
    } catch {
      setError('並び替えに失敗しました')
    }
  }

  // 新規追加（上部）とステップ編集（行直下インライン）の両方で使うフォーム。
  // 同時に開くのは常に片方だけなので、state は stepForm を共有する。
  const renderStepForm = () => (
    <div className={`${editingStepId ? 'mt-3' : 'mb-6'} border-hairline rounded-card bg-canvas-sunken border p-4`}>
      <h4 className="text-sm font-medium text-ink-secondary mb-3">
        {editingStepId ? 'ステップを編集' : '新しいステップを追加'}
      </h4>
      {/* 左が編集、右が「いまどの通を触っているか」。任意値の桁指定ではなく
          3列の標準段で組む（2:1）。直書きの数を増やさない。 */}
      <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <FormSection
          node="xfYLn"
          title="配信タイミング"
          description="いつ送るか。送ったあと次の通へ進むかどうかも、設計どおりここでそろえて決めます。"
        >
          <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1">ステップ順序</label>
          <input
            type="number"
            min={1}
            className="w-32 border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            value={stepForm.stepOrder}
            onChange={(e) => setStepForm({ ...stepForm, stepOrder: Number(e.target.value) })}
          />
        </div>
        <ScheduleInput
          mode={deliveryMode}
          value={stepForm.schedule}
          onChange={(schedule) => setStepForm({ ...stepForm, schedule })}
        />
        {/*
          送ったあと止めるかどうか。体調の記録をお願いして返事を待つ、と
          いった流れで要る。止めておけば、返事が来てから人が再開できる。

          設計（xfYLn）はこれを配信タイミングの4つ目の口として並べる。
          以前は画面のいちばん下、到達タグと同じ束に置いていたので、
          「いつ送るか」を決めているときに目に入らなかった。
        */}
        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1">送信後</label>
          <select
            className="w-full border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            value={stepForm.afterSend}
            onChange={(e) =>
              setStepForm({ ...stepForm, afterSend: e.target.value as 'continue' | 'pause' })
            }
          >
            <option value="continue">送信後：次のステップへ進む</option>
            <option value="pause">送信後：ここで一時停止する</option>
          </select>
          <p className="text-xs text-ink-faint mt-0.5">
            一時停止にすると、この通を送ったところで止まります。再開するまで次は届きません。
          </p>
        </div>
          </div>
        </FormSection>

        <FormSection title="メッセージ" description="LINEへ届く中身です。">
          <div className="space-y-3">
        {/* 入力モード切替: 直接入力 / テンプレート参照 */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-ink-secondary">メッセージの指定方法</label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={stepForm.inputMode === 'direct'}
                onChange={() => setStepForm({ ...stepForm, inputMode: 'direct', templateId: null })}
              />
              <span>直接入力</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={stepForm.inputMode === 'template'}
                onChange={() => setStepForm({ ...stepForm, inputMode: 'template' })}
              />
              <span>テンプレートを使う</span>
            </label>
          </div>
        </div>

        {/*
          質問（分岐）の通。本文の代わりに選択肢を組み立てる。ふつうの通と
          行き来できるように、切り替えのボタンをここに置く。
        */}
        {stepForm.question ? (
          <div className="border-hairline rounded-card border p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-ink text-sm font-bold">質問（分岐）</h4>
              <button
                type="button"
                onClick={() => setStepForm({ ...stepForm, question: null })}
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-9 border px-3 text-xs"
              >
                ふつうの通に戻す
              </button>
            </div>
            <QuestionEditor
              value={stepForm.question}
              onChange={(next) => setStepForm({ ...stepForm, question: next })}
              onOpenChoiceActions={
                editingStepId
                  ? (choiceIndex) =>
                      setActionTarget({
                        hook: 'choice_selected',
                        stepId: editingStepId,
                        choiceIndex,
                        title: `選択肢${choiceIndex + 1}が押されたとき`,
                      })
                  : undefined
              }
            />
            {!editingStepId && (
              <p className="text-ink-faint mt-3 text-xs">
                選択肢ごとのアクションは、この通を保存してから設定できます。
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setStepForm({ ...stepForm, question: emptyQuestion() })}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-9 self-start border px-3 text-xs"
          >
            この通を質問（分岐）にする
          </button>
        )}

        {!stepForm.question && stepForm.inputMode === 'template' && (
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">テンプレート <span className="text-danger">*</span></label>
            <select
              className="w-full border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              value={stepForm.templateId ?? ''}
              onChange={(e) => {
                const templateId = e.target.value || null
                const template = templates.find((item) => item.id === templateId)
                setStepForm({
                  ...stepForm,
                  templateId,
                  question: template?.question ? structuredClone(template.question) : null,
                  messageType: (template?.messageType as MessageType | undefined) ?? stepForm.messageType,
                  messageContent: template?.messageContent ?? stepForm.messageContent,
                })
              }}
            >
              <option value="">-- 選択してください --</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.category ? ` (${t.category})` : ''}</option>
              ))}
            </select>
            <p className="text-xs text-amber-700 mt-1">
              ⓘ テンプレートが修正されると、このステップの内容も自動で同期されます
            </p>
          </div>
        )}

        {!stepForm.question && stepForm.inputMode === 'direct' && (
          <>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">メッセージタイプ</label>
              <select
                className="w-full border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={stepForm.messageType}
                onChange={(e) => setStepForm({ ...stepForm, messageType: e.target.value as MessageType })}
              >
                {messageTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {/*
              位置情報・動画・音声・スタンプは、本文ではなく専用の欄で書く。
              中身は JSON なので、生のまま書かせると必ず壊れる。
            */}
            {stepForm.messageType === 'carousel' ? (
              // カルーセルはテンプレートを指す形。中身はそちらが持つ。
              <CarouselPicker
                value={stepForm.templateId ?? ''}
                onChange={(id, tpl) =>
                  setStepForm((prev) => ({
                    ...prev,
                    templateId: id || null,
                    // 控えは実物を入れる。テンプレートを消したときに
                    // これが使われるので、要約では送れなくなる。
                    messageContent: tpl?.messageContent ?? '',
                  }))
                }
              />
            ) : isStructuredKind(stepForm.messageType) ? (
              <MessageKindFields
                kind={stepForm.messageType as MessageKind}
                value={kindState}
                onChange={(next) => {
                  setKindState(next)
                  const json = serializeMessageKind(stepForm.messageType as MessageKind, next)
                  setStepForm((prev) => ({ ...prev, messageContent: json ?? '' }))
                }}
              />
            ) : (
              <div>
                <label className="block text-xs font-medium text-ink-secondary mb-1">メッセージ内容 <span className="text-danger">*</span></label>
                {/* 差し込みは本文のときだけ。Flex は JSON なので、入れる位置を
                    間違えると本文が壊れる。 */}
                {stepForm.messageType === 'text' && (
                  <div className="mb-2">
                    <InsertToolbar
                      targetRef={stepBodyRef}
                      value={stepForm.messageContent}
                      onChange={(next) => setStepForm((prev) => ({ ...prev, messageContent: next }))}
                    />
                  </div>
                )}
                <textarea
                  ref={stepBodyRef}
                  className="w-full border-hairline rounded-control bg-canvas text-ink resize-none border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  rows={4}
                  placeholder="メッセージ内容を入力..."
                  value={stepForm.messageContent}
                  onChange={(e) => setStepForm({ ...stepForm, messageContent: e.target.value })}
                />
              </div>
            )}
          </>
        )}

          </div>
        </FormSection>

        {/*
          1通ごとの配信対象。シナリオ全体の絞り込みとは別。対象から外れた人は
          この通だけ飛ばして次へ進む（止めない）。

          設計（r6Gzsu）では独立した面。以前は到達タグ・配信後・下書きと
          同じ束に埋まっていて、「この通だけ誰に送るか」を決める場所だと
          読み取れなかった。
        */}
        <FormSection
          node="r6Gzsu"
          title="この通の配信対象"
          description="条件に合わない人には、この通だけ送りません。次の通へはそのまま進みます。"
          action={
            <button
              type="button"
              onClick={() => setStepTargetOpen(true)}
              className="text-accent shrink-0 text-xs hover:underline"
            >
              条件を編集
            </button>
          }
        >
          <p className="text-ink text-sm font-bold">
            {describeStepAudience(stepForm.targetCondition, tags)}
          </p>
        </FormSection>

        {/*
          送信後のアクション。設計（hz9ti）では独立した面。ここでは段の枠だけ
          作り、中の並びは触っていない（別担当の受け持ち）。
        */}
        <FormSection
          node="hz9ti"
          title="送信後のアクション"
          description="この通が届いたあとに動かすものです。"
          action={
            editingStepId ? (
              <button
                type="button"
                onClick={() =>
                  setActionTarget({
                    hook: 'step_sent',
                    stepId: editingStepId,
                    choiceIndex: null,
                    title: `${stepForm.stepOrder}通目を送ったあと`,
                  })
                }
                className="text-accent shrink-0 text-xs hover:underline"
              >
                ＋ アクションを追加
              </button>
            ) : undefined
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">到達したらタグ付与</label>
              <select
                className="w-full border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={stepForm.onReachTagId ?? ''}
                onChange={(e) => setStepForm({ ...stepForm, onReachTagId: e.target.value || null })}
              >
                <option value="">-- なし --</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <p className="text-xs text-ink-faint mt-0.5">
                このステップが配信完了したら、選んだタグを友だちに付与します
              </p>
            </div>
            {!editingStepId && (
              <p className="text-ink-faint text-xs">
                そのほかのアクションは、この通を保存してから設定できます。
              </p>
            )}
          </div>
        </FormSection>

        {/* 下書き。書きかけを保存しておくため。配信からは外れる。 */}
        <label className="text-ink-secondary flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={stepForm.isDraft}
            onChange={(e) => setStepForm({ ...stepForm, isDraft: e.target.checked })}
          />
          下書きにする（配信されません。テスト送信では送れます）
        </label>

        {stepError && <p className="text-xs text-red-600">{stepError}</p>}

        <div className="flex gap-2">
          <button
            onClick={handleSaveStep}
            disabled={stepSaving}
 className="bg-accent-deep text-on-accent transition-colors hover:brightness-92 px-4 py-2 min-h-[44px] text-sm font-medium rounded-control disabled:opacity-50"
          >
            {stepSaving ? '保存中...' : editingStepId ? '更新' : '追加'}
          </button>
          <button
            onClick={closeStepForm}
            className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control min-h-[44px] px-4 py-2 text-sm font-medium transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>

      {/*
        設計（xfYLn）の右の柱。いま何通目を触っているのか、その通が誰に
        どう届くのかを、編集の手を止めずに読めるようにする。
        以前は編集を閉じて表へ戻らないと、前後の通が見えなかった。
      */}
      <aside data-design-node="xfYLn" className="min-w-0 space-y-4">
        <div className="bg-canvas border-hairline rounded-card border p-4">
          <h4 className="text-ink text-sm font-bold">配信の流れ</h4>
          <p className="text-ink-faint mt-0.5 text-xs">いま編集しているのは緑の行です。</p>
          {sortedSteps.length === 0 ? (
            <p className="text-ink-faint mt-3 text-xs">保存すると、ここに並びます。</p>
          ) : (
            <ol className="mt-3 space-y-1.5">
              {sortedSteps.map((row) => {
                const current = editingStepId === row.id
                const rowTitle =
                  (row.templateId ? templates.find((t) => t.id === row.templateId)?.name : null) ??
                  (row.messageContent || '').split('\n')[0].slice(0, 24)
                return (
                  <li
                    key={row.id}
                    className={`rounded-control flex items-center gap-2 px-2 py-1.5 text-xs ${
                      current ? 'bg-accent-soft text-accent font-semibold' : 'bg-canvas-sunken text-ink-secondary'
                    }`}
                  >
                    <span className="shrink-0 tabular-nums">{row.stepOrder}通目</span>
                    <span className="shrink-0">{formatScheduleLabel(deliveryMode, row)}</span>
                    <span className="min-w-0 flex-1 truncate">{rowTitle}</span>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <div className="bg-canvas border-hairline rounded-card border p-4">
          <h4 className="text-ink text-sm font-bold">設定内容</h4>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-faint shrink-0">配信対象</dt>
              <dd className="text-ink min-w-0 text-right font-semibold">
                {describeStepAudience(stepForm.targetCondition, tags)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-faint shrink-0">配信日時</dt>
              <dd className="text-ink min-w-0 text-right font-semibold">
                {formatScheduleLabel(deliveryMode, {
                  delayMinutes: stepForm.schedule.delayMinutes,
                  ...buildSchedulePayload(deliveryMode, stepForm.schedule),
                } as unknown as ScenarioStep)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-faint shrink-0">送信後</dt>
              <dd className="text-ink min-w-0 text-right font-semibold">
                {describeAfterSend(stepForm.afterSend).label}
              </dd>
            </div>
            {/* 「送信枠を超えていません」「テスト送信が未完了です」は設計にあるが、
                残りの送信枠もテスト送信の済み／未済も**数える口が無い**。
                数を作らずに、繋がっていないことをそのまま書く。 */}
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-faint shrink-0">配信前チェック</dt>
              <dd className="text-ink-faint min-w-0 text-right">—</dd>
            </div>
          </dl>
          <p className="text-ink-faint mt-2 text-xs leading-relaxed">
            配信前チェックはまだ繋がっていません。残りの送信枠とテスト送信の記録を返す取得口が接続されると表示されます。
          </p>
        </div>
      </aside>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div>

        <div className="bg-canvas rounded-card border border-hairline p-8 animate-pulse space-y-4">
          <div className="bg-canvas-sunken h-6 w-1/3 rounded" />
          <div className="h-4 bg-canvas-sunken rounded w-2/3" />
          <div className="h-4 bg-canvas-sunken rounded w-1/2" />
        </div>
      </div>
    )
  }

  if (!scenario) {
    return (
      <div>

        <div className="bg-canvas rounded-card border border-hairline p-8 text-center">
          <p className="text-ink-faint">{error || 'シナリオが見つかりません'}</p>
          <Link href="/scenarios" className="text-accent hover:text-accent-hover mt-4 inline-block text-sm">
            ← シナリオ一覧に戻る
          </Link>
        </div>
      </div>
    )
  }

  const sortedSteps = [...scenario.steps].sort((a, b) => a.stepOrder - b.stepOrder)

  /**
   * 隣り合う通の間で、いちばん人が減ったところ。
   *
   * 到達人数はステップごとに集計済みだったが、画面はそれを表の中でしか
   * 使っていなかった。「どこで読まれなくなるか」は1通ずつ見比べないと
   * 分からず、通数が増えるほど気づけない。差がいちばん大きい1か所を出す。
   *
   * 減っていない（増えている）ときは出さない。分岐で人が分かれた場合など、
   * 減少として読むと誤解になる。
   */
  const biggestDrop = (() => {
    const steps = stats?.steps ?? []
    if (steps.length < 2) return null
    let worst: { fromOrder: number; toOrder: number; lost: number; rate: number } | null = null
    for (let i = 0; i < steps.length - 1; i += 1) {
      const from = steps[i]
      const to = steps[i + 1]
      const lost = from.reachedCount - to.reachedCount
      if (lost <= 0 || from.reachedCount === 0) continue
      const rate = lost / from.reachedCount
      if (!worst || lost > worst.lost) {
        worst = { fromOrder: from.stepOrder, toOrder: to.stepOrder, lost, rate }
      }
    }
    return worst
  })()
  const modeBadge = modeBadgeStyle[deliveryMode]

  return (
    <div>
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/scenarios" className="hover:underline">
          シナリオ配信
        </Link>
        <span className="mx-1.5">/</span>
        <span>{scenario.name}</span>
      </nav>

      <div data-design="Head">
        <Header
          title="シナリオ編集"
          description="配信のタイミングと内容を並べます。開始するには友だち追加時の配信やアクションから呼び出します。"
          action={
            /* 設計の並び：マニュアル / 一括プレビュー / 一括テスト送信 / 保存。
               一覧へ戻る導線は設計では最下部にあり、ここには置かない
               （下の「シナリオ一覧に戻る」がそれ）。 */
            <div className="flex flex-wrap items-center gap-2">
              <Button href={`/scenarios/results?id=${id}`}>配信結果を見る</Button>
              <button
                disabled
                title="マニュアルは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                マニュアル
              </button>
              <button
                onClick={() => setPreviewOpen(true)}
                disabled={sortedSteps.length === 0}
                title={sortedSteps.length === 0 ? 'コンテンツがまだありません' : undefined}
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                一括プレビュー
              </button>
              <button
                onClick={() => setTestSend({ stepId: null, label: 'このシナリオの全通' })}
                disabled={sortedSteps.length === 0}
                title={sortedSteps.length === 0 ? 'コンテンツがまだありません' : undefined}
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                一括テスト送信
              </button>
              {/* 保存するものは、いま開いている編集の内容。カードの「編集」
                  「変更」を押していないときは、保存するものが無い。 */}
              <button
                onClick={handleSaveScenario}
                disabled={!editing || saving}
                title={editing ? undefined : '「編集」か「変更」を押すと、ここで保存できます'}
                className="bg-accent-deep hover:brightness-92 text-on-accent rounded-control px-4 py-2 text-sm font-bold transition-colors disabled:opacity-40"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          }
        />
      </div>

      {showStarted ? (
        <div
          data-design-node="NrBkW"
          className="border-success bg-success-bg text-success mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border px-4 py-3 text-sm"
          role="status"
        >
          <p className="font-semibold">
            配信を開始しました。条件を満たした友だちから順に配信します。
          </p>
          <Link href={`/scenarios/results?id=${encodeURIComponent(id)}`} className="font-semibold underline underline-offset-2">
            開始後の結果を見る
          </Link>
        </div>
      ) : null}

      {/*
        設計（bV5Vs）はこれを帯で置く。以前は見出し下の説明文へ混ぜていて、
        ほかの説明と同じ重さで流れ、**作っただけで配信されると思われていた**。
        始め方の入口も同じ帯に置く。読んだ直後に次の一手へ進める。
      */}
      <section
        data-design-node="bV5Vs"
        className="border-warning bg-warning-bg rounded-card mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border px-4 py-3"
        role="note"
      >
        <p className="text-warning text-sm font-semibold">
          作成しただけでは配信されません。開始条件を設定し、テスト送信後に配信を開始してください。
        </p>
        {/* 設計はここに「配信を始める方法」の入口を描くが、案内の行き先が
            まだ無い（上の「マニュアル」も準備中のまま）。行き先の無い青字を
            置くと押されて何も起きないので、次の一手を言葉で書く。 */}
        <span className="text-ink-secondary text-xs">
          このすぐ下の「開始のきっかけ」から設定できます。
        </span>
      </section>

      {/*
        同時購読の決まり。シナリオを組む前に知っておかないと設計を間違える。

        右で切り替えられる。これまでは文だけ置いて「許可しない」と書いて
        いたが、実際は列（allow_concurrent）で持っていて、作るときにしか
        決められなかった。読むだけの説明の隣に、それを決める場所が無い。
      */}
      <section className="bg-info-bg rounded-card mb-4 flex flex-wrap items-start gap-4 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-info text-sm font-semibold">同時に購読できるシナリオは 1つ</p>
          <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
            別のシナリオを開始すると、いま流れているシナリオは停止します。あとで戻すと、止まった続きから再開します。複数の流れを同時に届けたい場合は、1つのシナリオ内で分岐させてください。
          </p>
        </div>
        <div className="border-hairline bg-canvas rounded-control flex shrink-0 overflow-hidden border">
          {[
            { value: false, label: '重複を許可しない' },
            { value: true, label: '許可する' },
          ].map((opt) => {
            const on = (scenario.allowConcurrent ?? true) === opt.value
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => void handleConcurrentChange(opt.value)}
                aria-pressed={on}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  on ? 'bg-accent-soft text-accent' : 'text-ink-secondary hover:bg-canvas-sunken'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </section>

      {error && (
        <div className="bg-danger-bg text-danger rounded-card mb-4 p-4 text-sm">
          {error}
        </div>
      )}

      {/* Scenario Info */}
      <div className="bg-canvas rounded-card border border-hairline p-6 mb-6">
        {editing ? (
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">シナリオ名 <span className="text-danger">*</span></label>
              <input
                type="text"
                className="w-full border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">説明</label>
              <textarea
                className="w-full border-hairline rounded-control bg-canvas text-ink resize-none border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                rows={2}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">フォルダ</label>
              <select
                className="border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent w-full"
                value={editForm.folderId}
                onChange={(e) => setEditForm({ ...editForm, folderId: e.target.value })}
              >
                <option value="">未分類</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <p className="text-ink-faint mt-1 text-xs">一覧の左のパネルで、この分類ごとに絞り込めます。</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">トリガー</label>
              <select
                className="w-full border-hairline rounded-control bg-canvas text-ink border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                value={editForm.triggerType}
                onChange={(e) => setEditForm({ ...editForm, triggerType: e.target.value as ScenarioTriggerType })}
              >
                {triggerOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="editIsActive"
                checked={editForm.isActive}
                onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                className="h-4 w-4 rounded border-hairline text-accent focus:ring-accent"
              />
              <label htmlFor="editIsActive" className="text-sm text-ink-secondary">有効</label>
            </div>
            <div className="border-hairline rounded-card border p-3">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={!editForm.allowConcurrent}
                  onChange={(e) => setEditForm({ ...editForm, allowConcurrent: !e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-hairline text-accent focus:ring-accent"
                />
                <span className="text-ink-secondary text-sm">
                  他のシナリオが動いている人は登録しない
                  <span className="text-ink-faint block text-xs leading-relaxed">
                    既定では、1人が複数のシナリオに同時に入れます。
                    ここをチェックすると、他のシナリオが動いている人はこのシナリオに入りません。
                    すでに入っている人には影響しません。
                  </span>
                </span>
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveScenario}
                disabled={saving}
 className="bg-accent-deep text-on-accent transition-colors hover:brightness-92 px-4 py-2 min-h-[44px] text-sm font-medium rounded-control disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={() => {
                  setEditing(false)
                  setEditForm({
                    name: scenario.name,
                    description: scenario.description ?? '',
                    triggerType: scenario.triggerType,
                    isActive: scenario.isActive,
                    allowConcurrent: scenario.allowConcurrent !== false,
                    folderId: scenario.folderId ?? '',
                  })
                }}
                className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control min-h-[44px] px-4 py-2 text-sm font-medium transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/*
              設計は5枚の札を横に並べ、それぞれに直す入口を付ける。
              以前は名前と説明の下に定義リストを縦に置いていたが、
              どれが直せてどれが読むだけなのかが見分けられなかった。
            */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <SettingCard label="シナリオ名" action="編集" onAction={() => setEditing(true)}>
                <p className="text-ink truncate text-sm font-bold">{scenario.name}</p>
                {/* 置き場は scenarios.folder_id（099）。一覧の左のパネルで
                    絞り込む先になる。 */}
                <p className="text-ink-faint mt-0.5 truncate text-xs">
                  フォルダ：{folders.find((f) => f.id === scenario.folderId)?.name ?? '未分類'}
                </p>
              </SettingCard>

              <SettingCard label="配信方式">
                <p className="text-ink text-sm font-bold">{modeBadge.label}</p>
                <p className="text-ink-faint mt-0.5 text-xs">作ったあとは変えられません</p>
              </SettingCard>

              <SettingCard label="状態" action="変更" onAction={() => setEditing(true)}>
                <p className={`text-sm font-bold ${scenario.isActive ? 'text-ink' : 'text-warning'}`}>
                  {scenario.isActive ? '配信可' : '一時停止中'}
                </p>
                <p className="text-ink-faint mt-0.5 text-xs">
                  {scenario.isActive ? '配信を一時停止する' : '配信を再開する'}
                </p>
              </SettingCard>

              {/*
                シナリオ全体の配信対象。購読したあとに条件から外れた人には
                送らずに止める（完了にはしない）。条件に戻れば人が再開できる。
              */}
              {/*
                開始のきっかけ。1本に複数持てる（128）。0本は「止まっている」
                ではなく「外から呼ばれたときだけ流れる」なので、そう書く。
              */}
              {/* 設計（bV5Vs）はこの札に「設定」の入口を出し、押すと開始条件の
                  面（EvVO5）が開く。値そのものを押す形だけだと、読むだけの札と
                  見分けが付かない。 */}
              <SettingCard label="開始のきっかけ" action="設定" onAction={() => setTriggerOpen(true)}>
                <button type="button" onClick={() => setTriggerOpen(true)} className="text-left">
                  <span className="text-ink block text-sm font-bold underline-offset-2 hover:underline">
                    {triggerCount === null
                      ? '—'
                      : triggerCount === 0
                        ? '呼ばれたときだけ'
                        : `${triggerCount} 件`}
                  </span>
                  <span className="text-ink-faint mt-0.5 block text-xs">
                    {triggerCount === 0 ? 'アクションなどから開始できます' : '押すと足せます'}
                  </span>
                </button>
              </SettingCard>

              <SettingCard label="対象の絞り込み">
                <button
                  type="button"
                  onClick={() => setAudienceOpen(true)}
                  className="text-left"
                >
                  <span className="text-ink block text-sm font-bold underline-offset-2 hover:underline">
                    {describeCondition((scenario.audienceCondition as SegmentCondition | null) ?? null)}
                  </span>
                  <span className="text-ink-faint mt-0.5 block text-xs">
                    押すと条件を組み立てられます
                  </span>
                </button>
              </SettingCard>

              <SettingCard label="最終ステップ後の処理">
                <button type="button" onClick={() => setOnCompleteOpen(true)} className="text-left">
                  <span className="text-ink block text-sm font-bold underline-offset-2 hover:underline">
                    {ON_COMPLETE_LABEL[(scenario.onCompleteMode ?? 'pause') as OnCompleteMode]}
                  </span>
                  <span className="text-ink-faint mt-0.5 block text-xs">
                    {actionCounts['__complete__']
                      ? `アクション ${actionCounts['__complete__']} 件`
                      : '読み終えた人を次のシナリオへ送ることもできます'}
                  </span>
                </button>
              </SettingCard>
            </div>

            {/*
              シナリオの説明はここに出さない。絵にこの段落が無い。
              中身は「シナリオ名」の札の「編集」を開けば読める。
            */}
          </div>
        )}
      </div>

      {/*
        統計。設計は1行。カード4枚に散らすと、購読中と読了済と離脱地点を
        見比べるのに目が横に大きく動く。並べて読むものなので1本にまとめる。

        位置は5枚の札の下。絵がその並びで、以前は逆に出していた。
      */}
      {stats && stats.enrolledTotal > 0 && (
        <div
          data-design="KPIs"
          className="bg-canvas rounded-card border-hairline mb-4 flex flex-wrap items-center gap-x-8 gap-y-3 border px-5 py-4"
        >
          <div>
            <p className="text-ink-faint text-xs">購読中</p>
            <p className="text-ink text-xl font-bold tabular-nums">
              {stats.activeNow.toLocaleString('ja-JP')}
              <span className="text-ink-faint ml-0.5 text-xs font-normal">人</span>
            </p>
          </div>
          <div className="border-hairline border-l pl-8">
            <p className="text-ink-faint text-xs">読了済</p>
            <p className="text-ink text-xl font-bold tabular-nums">
              {stats.completed.toLocaleString('ja-JP')}
              <span className="text-ink-faint ml-0.5 text-xs font-normal">人</span>
            </p>
          </div>
          <div className="border-hairline border-l pl-8">
            <p className="text-ink-faint text-xs">離脱が大きい地点</p>
            {biggestDrop ? (
              <p className="text-warning text-xl font-bold">
                {biggestDrop.fromOrder}通目 <span className="mx-1">→</span> {biggestDrop.toOrder}通目
              </p>
            ) : (
              <p className="text-ink-faint text-xl font-bold">—</p>
            )}
          </div>
          {biggestDrop && (
            <p className="text-warning ml-auto text-xs">
              ↘ {biggestDrop.fromOrder}通目で {biggestDrop.lost.toLocaleString('ja-JP')}人（
              {Math.round(biggestDrop.rate * 100)}%）が離脱しています
            </p>
          )}
        </div>
      )}

      {/* Steps */}
      <div className="bg-canvas rounded-card border border-hairline p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-ink text-sm font-semibold">コンテンツ {sortedSteps.length} 通</h3>
          {/* 設計の3つ。一括プレビューは見出しへ移した。 */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={openAddStep}
              className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
            >
              ＋ メッセージを追加
            </button>
            {/* テンプレートは受け口がある（scenario_steps.template_id）。
                最初からテンプレートを選ぶ状態でフォームを開く。 */}
            <button
              onClick={openAddTemplateStep}
              className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
            >
              テンプレートを追加
            </button>
            {/* 質問メッセージ。選択肢ごとにタグ・友だち情報・シナリオを動かせる。
                押されたことは postback で戻ってくる（sq:<stepId>:<index>）。 */}
            <button
              onClick={openAddQuestionStep}
              title="質問メッセージを足します。選択肢ごとにタグ・友だち情報・シナリオを動かせます"
              className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
            >
              分岐を追加
            </button>
          </div>
        </div>

        {/* 新規ステップ追加フォーム（編集フォームは各ステップの行直下にインライン表示） */}
        {showStepForm && renderStepForm()}

        {/* Steps list */}
        {sortedSteps.length === 0 ? (
          <div className="text-center py-8 text-ink-faint text-sm">
            まだ1通もありません。上の「＋ メッセージを追加」から足してください。
          </div>
        ) : (
          /*
            設計は表。以前はカードを縦に積んでいたので、通ごとの
            タイミング・種別・到達人数を上下で見比べられなかった。
            桁をそろえると、上から下へ人数が減っていくのがそのまま見える。
          */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px]">
              <thead>
                {/* 見出しは共通の Th（Pencil `tPTMp`）。直書きの見出しを7個
                    置いていたので、表の桁の高さ・色・太さがこの画面だけ他と
                    ずれていた。 */}
                <tr className="border-hairline border-b">
                  <Th className="w-16" aria-label="並び" />
                  <Th>タイミング</Th>
                  <Th className="w-full max-w-0">内容</Th>
                  <Th>種別</Th>
                  {/* 設計（bV5Vs）の桁。誰に送る通なのかが、開かなくても読める。 */}
                  <Th>配信対象</Th>
                  <Th>到達人数</Th>
                  <Th>配信後</Th>
                  <Th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {sortedSteps.map((step, idx) => {
                  const stat = stats?.steps.find((v) => v.stepOrder === step.stepOrder)
                  const pct = scenarioReachPercent(stat?.reachRate)
                  const reachBarWidth = scenarioReachBarWidth(pct)
                  const tpl = step.templateId
                    ? templates.find((t) => t.id === step.templateId)
                    : null
                  const kindLabel = tpl
                    ? 'テンプレート'
                    : (messageTypeOptions.find((o) => o.value === step.messageType)?.label ??
                      step.messageType)
                  // 内容の桁は見出しだけ出す。中身はプレビューで開く。
                  // 本文をそのまま桁に入れると、行の高さが通ごとに変わって
                  // 上下の見比べができなくなる。
                  const title =
                    tpl?.name ??
                    (step.messageContent || '').split('\n')[0].slice(0, 60) ??
                    '（空）'
                  return (
                    <Fragment key={step.id}>
                      {idx > 0 && (
                        <tr className="group">
                          <td colSpan={8} className="px-0 py-0">
                            {/*
                              通と通のあいだに差し込む入口。末尾にしか足せないと、
                              3通目と4通目のあいだに1通入れたいときに後ろを
                              作り直すことになる。ふだんは薄く、近づいたときだけ見える。
                            */}
                            <div className="flex items-center py-1">
                              <div className="border-hairline flex-1 border-t opacity-0 transition-opacity group-hover:opacity-100" />
                              <button
                                type="button"
                                onClick={() => openInsertStep(sortedSteps[idx - 1].stepOrder)}
                                className="text-ink-faint hover:text-accent px-3 text-xs opacity-40 transition-opacity group-hover:opacity-100"
                              >
                                ＋ ここに挿入
                              </button>
                              <div className="border-hairline flex-1 border-t opacity-0 transition-opacity group-hover:opacity-100" />
                            </div>
                          </td>
                        </tr>
                      )}
                      <tr className="border-hairline hover:bg-canvas-sunken border-b">
                        <td className="px-2 py-3 align-top whitespace-nowrap">
                          <div className="text-ink-faint flex items-center gap-1 text-xs">
                            <span className="flex flex-col leading-none">
                              <button
                                type="button"
                                onClick={() => void handleMoveStep(step.id, 'up')}
                                disabled={idx === 0}
                                aria-label="上へ"
                                className="hover:text-ink-secondary disabled:opacity-30"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleMoveStep(step.id, 'down')}
                                disabled={idx === sortedSteps.length - 1}
                                aria-label="下へ"
                                className="hover:text-ink-secondary disabled:opacity-30"
                              >
                                ↓
                              </button>
                            </span>
                            <span className="text-ink tabular-nums">{step.stepOrder}</span>
                          </div>
                        </td>
                        <td className="text-ink px-3 py-3 align-top text-sm whitespace-nowrap">
                          {formatScheduleLabel(deliveryMode, step)}
                        </td>
                        <td className="w-full max-w-0 px-3 py-3 align-top">
                          <button
                            type="button"
                            onClick={() =>
                              editingStepId === step.id ? closeStepForm() : openEditStep(step)
                            }
                            className="text-info block w-full truncate text-left text-sm hover:underline"
                            title={title}
                          >
                            {title}
                          </button>
                          {step.onReachTagId && (
                            <p className="text-accent mt-0.5 truncate text-xs">
                              到達タグ: {tags.find((t) => t.id === step.onReachTagId)?.name ?? step.onReachTagId}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top whitespace-nowrap">
                          <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-xs">
                            {kindLabel}
                          </span>
                        </td>
                        {/* 誰に送る通か。絞り込みが無い通は `—` ではなく
                            「購読中の全員」。決まっている値なので、取れて
                            いない印と混ぜない。 */}
                        <td className="text-ink-secondary px-3 py-3 align-top text-sm whitespace-nowrap">
                          {describeStepAudience(step.targetCondition, tags)}
                        </td>
                        <td className="px-3 py-3 align-top whitespace-nowrap">
                          {stat ? (
                            <span className="inline-flex items-center gap-2">
                              {reachBarWidth === null ? null : (
                                <span className="bg-canvas-sunken h-1.5 w-20 overflow-hidden rounded-full">
                                  <span
                                    className="bg-accent block h-full rounded-full"
                                    style={{ width: reachBarWidth }}
                                  />
                                </span>
                              )}
                              <span className="text-ink text-sm tabular-nums">
                                {scenarioReachCountLabel(stat.reachedCount)}
                              </span>
                              <span className="text-ink-faint text-xs tabular-nums">
                                {scenarioReachPercentLabel(pct)}
                              </span>
                            </span>
                          ) : (
                            <span className="text-ink-faint text-sm">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top whitespace-nowrap">
                          {(() => {
                            const after = describeAfterSend(step.afterSend)
                            return after.paused ? (
                              <span className="bg-warning-bg text-warning rounded-pill px-2 py-0.5 text-xs font-medium">
                                {after.label}
                              </span>
                            ) : (
                              <span className="text-ink-secondary text-sm">{after.label}</span>
                            )
                          })()}
                        </td>
                        <td className="px-3 py-3 text-right align-top whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() =>
                                editingStepId === step.id ? closeStepForm() : openEditStep(step)
                              }
                              className="text-info hover:underline"
                            >
                              {editingStepId === step.id ? '閉じる' : '編集'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPreviewStepId(previewStepId === step.id ? null : step.id)}
                              className="text-info hover:underline"
                            >
                              プレビュー
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setTestSend({ stepId: step.id, label: `${step.stepOrder}通目` })
                              }
                              className="text-info hover:underline"
                            >
                              テスト
                            </button>
                            {/* この通を送ったあとに動かすアクション。件数を出すのは、
                                設定済みを忘れて二重に足すのを防ぐため。 */}
                            <button
                              type="button"
                              onClick={() =>
                                setActionTarget({
                                  hook: 'step_sent',
                                  stepId: step.id,
                                  choiceIndex: null,
                                  title: `${step.stepOrder}通目を送ったあと`,
                                })
                              }
                              className="text-info hover:underline"
                            >
                              アクション
                              {actionCounts[step.id] ? ` ${actionCounts[step.id]}` : ''}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDuplicateStep(step)}
                              disabled={duplicatingStepId === step.id}
                              title="この通を複製する"
                              aria-label="この通を複製する"
                              className="text-ink-faint hover:text-ink-secondary disabled:opacity-40"
                            >
                              複製
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteStepError('')
                                setDeleteStepTarget(step)
                              }}
                              title="この通を削除する"
                              aria-label="この通を削除する"
                              className="text-ink-faint hover:text-danger"
                            >
                              削除
                            </button>
                          </div>
                        </td>
                      </tr>
                      {previewStepId === step.id && (
                        <tr className="border-hairline border-b">
                          <td colSpan={8} className="px-3 pb-3">
                            <div className="text-ink-secondary bg-canvas-sunken rounded-card px-3 py-2 text-sm">
                              {(() => {
                                // テンプレ参照時は「いまのテンプレの中身」を見せる。
                                const t = tpl ? tpl.messageType : step.messageType
                                const c = tpl ? tpl.messageContent : step.messageContent
                                if (t === 'flex') return <FlexPreview content={c} />
                                if (t === 'image') return <ImagePreview content={c} />
                                return <p className="break-words whitespace-pre-wrap">{c}</p>
                              })()}
                            </div>
                          </td>
                        </tr>
                      )}
                      {editingStepId === step.id && (
                        <tr>
                          <td colSpan={8} className="px-3 pb-3">
                            {renderStepForm()}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/*
        画面のいちばん下。設計もこの位置。

        削除は右端に離して置く。編集の流れの途中にあると、保存のつもりで
        押し間違える。複製は左、戻るは中。
      */}
      <div className="border-hairline mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
        <button
          type="button"
          onClick={() => void handleDuplicate()}
          disabled={duplicating}
          className="text-ink-secondary hover:text-ink text-sm font-medium disabled:opacity-40"
        >
          {duplicating ? '複製中...' : 'このシナリオを複製'}
        </button>
        <Link href="/scenarios" className="text-ink-secondary hover:text-ink ml-auto text-sm">
          シナリオ一覧に戻る
        </Link>
        <button
          type="button"
          data-qa-open="dqFft-scenario"
          onClick={() => {
            setDeleteScenarioError('')
            setDeleteScenarioOpen(true)
          }}
          className="text-danger hover:underline text-sm font-medium"
        >
          このシナリオを削除
        </button>
      </div>

      <BulkPreviewModal
        open={previewOpen}
        scenarioId={id}
        onClose={() => setPreviewOpen(false)}
      />

      <ConfirmDialog
        open={deleteStepTarget !== null}
        title={deleteStepTarget ? `${deleteStepTarget.stepOrder}通目を削除しますか？` : 'この通を削除しますか？'}
        description={deleteStepTarget
          ? `${deleteStepTarget.stepOrder}通目と、その配信対象・送信後アクションが削除されます。到達済みの履歴は監査記録として残ります。この操作は取り消せません。`
          : ''}
        confirmLabel="この通を削除"
        destructive
        busy={deletingStepId !== null}
        error={deleteStepError}
        onConfirm={() => void handleDeleteStep()}
        onCancel={() => {
          if (deletingStepId) return
          setDeleteStepTarget(null)
          setDeleteStepError('')
        }}
      />

      <ConfirmDialog
        open={deleteScenarioOpen && scenario !== null}
        title={scenario ? `「${scenario.name}」を削除しますか？` : 'このシナリオを削除しますか？'}
        description={[
          stats?.activeNow === undefined
            ? '購読中の人数は確認できません。'
            : stats.activeNow === 0
              ? '現在購読中の友だちは0人です。'
              : `現在${stats.activeNow.toLocaleString('ja-JP')}人が購読中です。途中の人は続きを受け取れません。`,
          'シナリオの設定と今後の配信が削除されます。',
          'これまでの配信履歴は監査記録として残ります。',
          'この操作は取り消せません。',
        ].join(' ')}
        confirmLabel="このシナリオを削除"
        destructive
        busy={deletingScenario}
        error={deleteScenarioError}
        onConfirm={() => void handleDeleteScenario()}
        onCancel={() => {
          if (deletingScenario) return
          setDeleteScenarioOpen(false)
          setDeleteScenarioError('')
        }}
      />

      {/* シナリオ全体の配信対象 */}
      {audienceOpen && scenario && (
        <ConditionDialog
          title="対象の絞り込み"
          description="このシナリオを配る相手を絞ります。購読したあとに条件から外れた人は、送らずに止まります。"
          value={(scenario.audienceCondition as SegmentCondition | null) ?? null}
          onSave={async (next) => {
            const res = await api.scenarios.update(id, { audienceCondition: next } as never)
            if (res.success) await loadScenario()
          }}
          onClose={() => setAudienceOpen(false)}
        />
      )}

      {/* 最終コンテンツ配信後の処理 */}
      {onCompleteOpen && scenario && (
        <OnCompleteDialog
          scenarioId={id}
          mode={(scenario.onCompleteMode ?? 'pause') as OnCompleteMode}
          targetScenarioId={scenario.onCompleteScenarioId ?? null}
          onSave={async (mode, target) => {
            const res = await api.scenarios.update(id, {
              onCompleteMode: mode,
              onCompleteScenarioId: target,
            } as never)
            if (!res.success) return res.error
            await loadScenario()
            return null
          }}
          onClose={() => setOnCompleteOpen(false)}
          actionCount={actionCounts['__complete__'] ?? 0}
          onOpenActions={() => {
            setOnCompleteOpen(false)
            setActionTarget({
              hook: 'scenario_completed',
              stepId: null,
              choiceIndex: null,
              title: '最終コンテンツを配り終えたあと',
            })
          }}
        />
      )}

      {/* 1通ごとの配信対象。保存はフォームの「保存」でまとめて行う。 */}
      {stepTargetOpen && (
        <ConditionDialog
          title="この通の配信対象"
          description="条件に合わない人には、この通だけ送りません。次の通へはそのまま進みます。"
          value={stepForm.targetCondition}
          onSave={async (next) => {
            setStepForm((prev) => ({ ...prev, targetCondition: next }))
          }}
          onClose={() => setStepTargetOpen(false)}
        />
      )}

      {/* テスト送信 */}
      {testSend && (
        <TestSendDialog
          scenarioId={id}
          lineAccountId={scenario?.lineAccountId ?? null}
          stepId={testSend.stepId}
          stepLabel={testSend.label}
          steps={(testSend.stepId
            ? sortedSteps.filter((row) => row.id === testSend.stepId)
            : sortedSteps
          ).map((row) => ({
            id: row.id,
            stepOrder: row.stepOrder,
            timing: formatScheduleLabel(deliveryMode, row),
            kind:
              (row.templateId ? templates.find((t) => t.id === row.templateId)?.name : null) ??
              (messageTypeOptions.find((o) => o.value === row.messageType)?.label ??
                row.messageType),
          }))}
          onClose={() => setTestSend(null)}
        />
      )}

      {/* 開始のきっかけ */}
      {triggerOpen && (
        <TriggerEditor
          scenarioId={id}
          onClose={() => setTriggerOpen(false)}
          onChanged={setTriggerCount}
          audienceCondition={scenario.audienceCondition}
          activeNow={stats?.activeNow ?? null}
          lineAccountId={scenario.lineAccountId}
        />
      )}

      {/* アクション設定 */}
      {actionTarget && (
        <ActionEditor
          scenarioId={id}
          hook={actionTarget.hook}
          stepId={actionTarget.stepId}
          choiceIndex={actionTarget.choiceIndex}
          title={actionTarget.title}
          onClose={() => setActionTarget(null)}
          onChanged={reloadActionCounts}
        />
      )}
    </div>
  )
}
