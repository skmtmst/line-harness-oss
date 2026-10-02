'use client'

import { Fragment, useState, useEffect, useCallback, useRef } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Scenario, ScenarioStep, ScenarioTriggerType, MessageType, DeliveryMode, Folder } from '@line-crm/shared'
import { api, ApiError, type ScenarioRuns } from '@/lib/api'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import TargetMissing from '@/components/shared/target-missing'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import ActionEditor from '@/components/scenarios/action-editor'
import TriggerEditor from '@/components/scenarios/trigger-editor'
import CarouselPicker from '@/components/scenarios/carousel-picker'
import InsertToolbar from '@/components/scenarios/insert-toolbar'
import StepPreview, { previewOffsets, isDeliveryTimeSet } from '@/components/scenarios/step-preview'
import type { StepMessageKind } from '@/components/scenarios/message-type-tabs'
import MessageKindFields, {
  emptyMessageKindState,
  messageKindProblem,
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
  deadAnswerSettings,
  emptyQuestion,
  isUriOnlyBehavior,
  planChoiceActionRemap,
  validateChoiceUris,
  withChoiceKeys,
  type ScenarioQuestion,
} from '@/components/scenarios/question-editor'
import {
  ConditionDialog,
  MoveReferrersNotice,
  OnCompleteDialog,
  TestSendDialog,
  ON_COMPLETE_LABEL,
  describeCondition,
  type OnCompleteMode,
} from '@/components/scenarios/scenario-dialogs'
import { findInvalidRangeIssue, type SegmentCondition } from '@/components/shared/condition-builder'
import ScheduleInput, {
  emptySchedule,
  buildSchedulePayload,
  uiFromOffsetMinutes,
  type ScheduleValue,
} from '@/components/scenarios/schedule-input'
import BulkPreviewModal from '@/components/scenarios/bulk-preview-modal'
import ActionMenu from '@/components/shared/action-menu'
import { MoreAction } from '@/components/shared/row-actions'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import StatusChip from '@/components/shared/status-chip'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import {
  scenarioReachBarWidth,
  scenarioReachCountLabel,
  scenarioReachPercent,
  scenarioReachPercentLabel,
} from './scenario-reach-display'
import { describeAfterSend, describeStepAudience, stepKindLabel, stepListTitle } from './scenario-step-audience'
import {
  scenarioSimulationKey,
  simulationForKey,
  type ScenarioSimulationResult,
} from './scenario-simulation-refresh'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { scenarioReferenceData } from '@/components/scenarios/scenario-reference-data'
import { formatDateTime, formatNumber } from '@/lib/format'
import StickyBar from '@/components/shared/sticky-bar'
import { Pencil } from 'lucide-react'
import styles from './detail-v8.module.css'

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
  elapsed: { bg: 'bg-status-info-soft', text: 'text-action', label: '経過時間' },
  absolute_time: { bg: 'bg-status-warn-soft', text: 'text-warning', label: '時刻指定' },
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

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土']

/*
 * ★V8：通の行に「時刻の横に届く日時の例」を出す（PMLkX）。
 *
 * いま購読が始まった人が、その通をいつ受け取るかの例。elapsed /
 * absolute_time は「当日＋offsetDays日の deliveryTime」、relative は
 * 「いま＋delayMinutes」。0日後の当日配信には「（すぐ）」を付ける
 * （BxGhV の決まり：当日は「すぐ」、翌日以降は具体的な日付）。
 */
function stepExampleLabel(mode: DeliveryMode, step: ScenarioStep): string {
  const now = new Date()
  if (mode === 'relative') {
    const at = new Date(now.getTime() + (step.delayMinutes ?? 0) * 60_000)
    const soon = (step.delayMinutes ?? 0) <= 60 ? '（すぐ）' : ''
    return `${at.getMonth() + 1}月${at.getDate()}日（${WEEKDAYS_JA[at.getDay()]}）${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}${soon}`
  }
  const at = new Date(now.getTime() + (step.offsetDays ?? 0) * 86_400_000)
  const time = isDeliveryTimeSet(step.deliveryTime ?? '') ? step.deliveryTime : '—'
  const soon = (step.offsetDays ?? 0) === 0 ? '（すぐ）' : ''
  return `${at.getMonth() + 1}月${at.getDate()}日（${WEEKDAYS_JA[at.getDay()]}）${time}${soon}`
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
  // R235: 時刻を消したまま「○日後の 」と出すと、設定が済んだように見える。未設定とはっきり言う。
  if (!step.deliveryTime) return '時刻を入力してください'
  return `購読開始から${step.offsetDays ?? 0}日後の ${step.deliveryTime}`
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

/*
 * 次の通番号。通を足す3箇所（直書き・質問・テンプレ）で同じ式にすると、
 * 片方だけ直って番号がずれる（#495 軽18）。
 */
function nextStepOrder(steps: ReadonlyArray<{ stepOrder: number }>): number {
  return steps.length > 0 ? Math.max(...steps.map((s) => s.stepOrder)) + 1 : 1
}

/*
 * SCENARIO-09: 複製の途中で止まったことを、作りかけのコピーと
 * 一緒に運ぶ印。stage は「どの段階で止まったか」を運用者の言葉で持つ。
 */
class DuplicateAborted extends Error {
  constructor(
    readonly copyId: string,
    readonly stage: string,
    cause?: unknown,
  ) {
    super(cause instanceof Error && cause.message ? cause.message : '複製できませんでした')
  }
}

/*
 * R216: 複製で送る時刻の欄は、配信方式ごとに必要なものだけにする。
 * 全部送ると、口（validateStepSchedule）が余分な欄を見て 400 で止める。
 * 経過時間なのに delayMinutes を送ると、1通目で止まって作りかけの
 * コピーが残る。保存の buildSchedulePayload と同じ分け方にする。
 */
function stepScheduleForClone(
  mode: DeliveryMode,
  step: Pick<ScenarioStep, 'delayMinutes' | 'offsetDays' | 'offsetMinutes' | 'deliveryTime'>,
): { delayMinutes?: number; offsetDays?: number; offsetMinutes?: number; deliveryTime?: string } {
  if (mode === 'relative') return { delayMinutes: step.delayMinutes }
  if (mode === 'elapsed') {
    return {
      offsetDays: step.offsetDays ?? 0,
      offsetMinutes: step.offsetMinutes ?? 0,
    }
  }
  return {
    offsetDays: step.offsetDays ?? 0,
    deliveryTime: step.deliveryTime ?? '09:00',
  }
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

export default function ScenarioDetailV8({
  scenarioId,
  showStarted = false,
}: {
  scenarioId: string
  showStarted?: boolean
}) {
  const id = scenarioId
  usePageCrumbs([{ label: 'シナリオ配信', href: '/scenarios' }])

  const [scenario, setScenario] = useState<ScenarioWithSteps | null>(null)
  /* ★V7: コンテンツ表の操作は「編集＋…」の1行に収める。…の中身は行ごとに開く。 */
  const [stepMenuId, setStepMenuId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [scenarioMissing, setScenarioMissing] = useState(false)

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', triggerType: 'friend_add' as ScenarioTriggerType, isActive: true, allowConcurrent: true, folderId: '' })
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderState, setFolderState] = useState<'loading' | 'ready' | 'error'>('loading')
  const { selectedAccountId } = useAccount()

  /*
   * SCENARIO-20: フォルダはアカウント単位。無指定で全権限範囲を取ると、
   * 別アカウントの同名フォルダを選んで保存してしまう。シナリオの所属
   * アカウント（共通なら選択中のアカウント）の候補だけを出し、
   * アカウントが切り替わったら取り直す。候補を取り直せなかったときは
   * 「未分類」と決めつけず、いまは変更できない旨を示す。
   */
  const folderAccountId = scenario?.lineAccountId ?? selectedAccountId
  useEffect(() => {
    let cancelled = false
    setFolderState('loading')
    void api.folders.list('scenario', folderAccountId ?? undefined)
      .then((res) => {
        if (cancelled) return
        if (res.success) {
          setFolders(res.data)
          setFolderState('ready')
        } else {
          setFolderState('error')
        }
      })
      .catch(() => {
        if (!cancelled) setFolderState('error')
      })
    return () => {
      cancelled = true
    }
  }, [folderAccountId])

  /*
   * 保存済みのフォルダが、このアカウントの候補に無いか（SCENARIO-20）。
   * 無いまま「未分類」と見せると、別範囲の値を黙って上書きしてしまう。
   * 候補に無い保存値は、理由を示したうえで値そのものは保持する。
   */
  const editFolderMissing = Boolean(
    editForm.folderId && !folders.some((f) => f.id === editForm.folderId),
  )
  const scenarioFolderName = !scenario?.folderId
    ? '未分類'
    : folderState === 'loading'
      ? '読み込み中…'
      : folderState === 'error'
        ? '確認できません'
        : (folders.find((f) => f.id === scenario.folderId)?.name ?? '名前を確認できません')
  const [saving, setSaving] = useState(false)

  const router = useRouter()
  const [duplicating, setDuplicating] = useState(false)
  /*
   * SCENARIO-09: 複製が途中で止まったとき、作りかけのコピーが残る。
   * 残っているコピーの所在・どこで止まったかを保持し、窓から
   * 「続きからやり直す」「コピーを削除する」「コピーを開いて見る」を
   * 選べるようにする。
   */
  const [duplicateRemainder, setDuplicateRemainder] = useState<{
    copyId: string
    copyName: string
    stage: string
    detail: string
  } | null>(null)
  const [discardDuplicateOpen, setDiscardDuplicateOpen] = useState(false)
  const [discardingDuplicate, setDiscardingDuplicate] = useState(false)
  const [discardDuplicateError, setDiscardDuplicateError] = useState('')
  /** ★V8: 右の欄のスマホに出す通。行を押すとその通に切り替わる。 */
  const [railStepId, setRailStepId] = useState<string | null>(null)
  /** 停止中⇔稼働中の切り替え中。二重押しを止める。 */
  const [togglingActive, setTogglingActive] = useState(false)
  /** 見出し右の「…」（複製・削除）。 */
  const [headMenuOpen, setHeadMenuOpen] = useState(false)
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
  usePageTitle(editingStepId ? `${stepForm.stepOrder}通目を編集` : 'シナリオ詳細')
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
  /*
   * SCENARIO-15: 試算は「いま保存されている設定」に対する結果。
   * 結果は計算した設定の鍵と一緒に持ち、設定が変わって鍵が合わなく
   * なった旧値は確定値として出さない（取り直し中は計算中と出す）。
   */
  const [simulationResult, setSimulationResult] = useState<ScenarioSimulationResult | null>(null)
  const [runs, setRuns] = useState<ScenarioRuns | null>(null)
  const [templates, setTemplates] = useState<TemplateOpt[]>([])
  const [tags, setTags] = useState<TagOpt[]>([])

  const deliveryMode: DeliveryMode = (scenario?.deliveryMode ?? 'relative') as DeliveryMode
  const latestStartedAt = runs?.subscriptions[0]?.startedAt ?? null
  const latestStartedLabel = latestStartedAt
    ? formatDateTime(new Date(latestStartedAt))
    : null

  const loadScenario = useCallback(async (fresh = false) => {
    setLoading(true)
    setError('')
    setScenarioMissing(false)
    try {
      const res = await scenarioReferenceData.scenario(id, fresh)
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
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setScenarioMissing(true)
      } else {
        setError('シナリオの読み込みに失敗しました。もう一度読み込んでください。')
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadScenario()
  }, [loadScenario])

  // 並列で stats / templates / tags を取得（リグレッションを起こさないよう失敗は無視）
  useEffect(() => {
    if (!id || !scenario) return
    let cancelled = false
    Promise.all([
      scenarioReferenceData.stats(id).catch(() => null),
      scenarioReferenceData.templates(scenario?.lineAccountId).catch(() => null),
      scenarioReferenceData.tags(scenario?.lineAccountId).catch(() => null),
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
  }, [id, scenario?.lineAccountId])

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

  /*
   * SCENARIO-15: 試算の元になる設定を1つの鍵にまとめる。
   * 対象条件・同時購読・開始のきっかけ・各通の順番/時刻/絞り込みが
   * 変わると鍵が変わり、下の effect が取り直す。保存後の再読込では
   * id と lineAccountId が変わらないので、鍵を見ないと古い人数が
   * 残り続ける（以前の挙動）。
   */
  const simulationKey = scenarioSimulationKey(scenario, triggerCount)
  /** 今の設定に対する試算。旧鍵の結果は確定値として出さない。 */
  const simulation = simulationForKey(simulationResult, simulationKey)
  /** 設定が変わって取り直し中か（初回の取得中も true）。 */
  const simulationRefreshing =
    Boolean(simulationKey && scenario?.lineAccountId) &&
    simulationResult?.key !== simulationKey

  /**
   * 機能5 V6の開始前試算と運用記録。互いに独立した読取なので並列で取得する。
   * 失敗時は旧集計を残し、0件とは表示しない。
   *
   * SCENARIO-15: 依存に simulationKey を含める。設定を保存し直すと
   * scenario が読み直されて鍵が変わり、試算を取り直す。世代の掃除
   * （cancelled）で遅れて届いた旧応答は捨てるので、遅い旧試算が
   * 新しい版を上書きしない。
   */
  useEffect(() => {
    const lineAccountId = scenario?.lineAccountId
    if (!id || !lineAccountId || !simulationKey) {
      setSimulationResult(null)
      setRuns(null)
      return
    }
    let cancelled = false
    const key = simulationKey
    void Promise.all([
      api.scenarios.simulate(id, lineAccountId).catch(() => null),
      api.scenarios.runs(id, lineAccountId, { limit: 50 }).catch(() => null),
    ]).then(([simulationResponse, runsResponse]) => {
      if (cancelled) return
      setSimulationResult({
        key,
        value: simulationResponse?.success ? simulationResponse.data : null,
      })
      setRuns(runsResponse?.success ? runsResponse.data : null)
    })
    return () => {
      cancelled = true
    }
  }, [id, scenario?.lineAccountId, simulationKey])

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
    scenarioReferenceData.stats(id, true).then((r) => { if (r.success) setStats(r.data) }).catch(() => {})
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
      if (res.success) loadScenario(true)
      else setError(res.error)
    } catch {
      setError('重複購読の設定を変更できませんでした')
    }
  }

  /*
   * ★V8「3 配信」の箱：一時停止する／配信を再開する。
   *
   * v7 は「状態」札の「変更」から編集フォームへ入って保存する2段だった。
   * 止める・再開するだけなら名前やフォルダの編集を経由する必要がないので、
   * その場で確定する。止めても途中の人の記録は残る（購読は消えない）。
   */
  const handleToggleActive = async () => {
    if (!scenario || togglingActive) return
    setTogglingActive(true)
    setError('')
    try {
      const res = await api.scenarios.update(id, { isActive: !scenario.isActive })
      if (res.success) await loadScenario(true)
      else setError(res.error)
    } catch {
      setError('配信状態を変更できませんでした。通信を確かめて、もう一度お試しください。')
    } finally {
      setTogglingActive(false)
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
    const copyName = `${scenario.name} のコピー`
    /*
     * SCENARIO-09: 途中で失敗したあと新しく作り直すと、不完全なコピーが
     * 1つ増えるだけ。前回作りかけのコピーが残っていれば新しく作らず、
     * その続きから写す。
     */
    let copyId = duplicateRemainder?.copyId ?? null
    try {
      if (!copyId) {
        const created = await api.scenarios.create({
          name: copyName,
          description: scenario.description,
          triggerType: scenario.triggerType,
          triggerTagId: scenario.triggerTagId,
          lineAccountId: scenario.lineAccountId,
          isActive: false,
          deliveryMode: scenario.deliveryMode,
          allowConcurrent: scenario.allowConcurrent,
          folderId: scenario.folderId ?? null,
        })
        if (!created.success) throw new Error(created.error)
        copyId = created.data.id
      }
      const copy = copyId

      /*
       * SCENARIO-08: シナリオ全体の配信対象と、最後まで届いた人の行き先
       * （終了後の処理）も写す。通だけ写すと、同じ名前でまったく別の
       * 動きをするコピーができてしまう。create はこれらを受けないので
       * 直後の update で入れる。
       */
      try {
        const updated = await api.scenarios.update(copy, {
          audienceCondition: scenario.audienceCondition ?? null,
          onCompleteMode: scenario.onCompleteMode ?? 'pause',
          onCompleteScenarioId: scenario.onCompleteScenarioId ?? null,
        })
        if (!updated.success) throw new Error(updated.error)
      } catch (cause) {
        throw new DuplicateAborted(copy, 'シナリオ全体の設定（配信対象・終了後の処理）', cause)
      }

      /*
       * 再開でも同じ通を二重に足さないよう、コピーに既にある通の番号を
       * 読む。読めないと「どこまで写ったか」が分からないので止める。
       */
      const existing = await api.scenarios.get(copy).catch(() => null)
      if (!existing?.success) {
        throw new DuplicateAborted(
          copy,
          'コピー済みの内容の確認',
          new Error(existing && !existing.success ? existing.error : 'コピーの内容を読めませんでした'),
        )
      }
      const existingByOrder = new Map(existing.data.steps.map((s) => [s.stepOrder, s.id]))
      const stepIdMap = new Map<string, string>()
      // 通は順に足す。まとめて入れる口が無い。
      // 時刻・絞り込み・質問・下書きの別まで写す。落とすと別物の流れに
      // なる。時刻は方式に合う欄だけ送る（余分な欄があると 400 で止まる）。
      for (const step of sortedSteps) {
        const already = existingByOrder.get(step.stepOrder)
        if (already) {
          stepIdMap.set(step.id, already)
          continue
        }
        const copied = await api.scenarios.addStep(copy, {
          stepOrder: step.stepOrder,
          ...stepScheduleForClone(deliveryMode, step),
          messageType: step.messageType,
          messageContent: step.messageContent,
          templateId: step.templateId ?? null,
          onReachTagId: step.onReachTagId ?? null,
          // 複製先でも同じところで止まる。止まる位置が変わると流れが別物になる。
          afterSend: step.afterSend ?? 'continue',
          targetCondition: (step.targetCondition as SegmentCondition | null) ?? null,
          question: (step.question as ScenarioQuestion | null) ?? null,
          isDraft: step.isDraft === true,
        }).catch((cause) => ({ success: false as const, error: cause instanceof Error && cause.message ? cause.message : '通をコピーできませんでした' }))
        // 途中で止める。続けると通が欠けた別物の流れが残る。
        if (!copied.success) throw new DuplicateAborted(copy, `${step.stepOrder}通目のコピー`, new Error(copied.error))
        stepIdMap.set(step.id, copied.data.id)
      }

      /*
       * SCENARIO-08: 開始のきっかけ。写さないと「複製したのに
       * 始まらない」コピーになる。再開時は既にあるものを足さない。
       */
      try {
        const [sourceTriggers, copyTriggers] = await Promise.all([
          api.scenarios.triggers.list(id),
          api.scenarios.triggers.list(copy),
        ])
        if (!sourceTriggers.success) throw new Error(sourceTriggers.error)
        if (!copyTriggers.success) throw new Error(copyTriggers.error)
        const have = new Set(copyTriggers.data.map((t) => `${t.kind}:${t.tagId ?? ''}`))
        for (const trigger of sourceTriggers.data) {
          if (have.has(`${trigger.kind}:${trigger.tagId ?? ''}`)) continue
          const added = await api.scenarios.triggers.add(copy, trigger.kind, trigger.tagId)
          if (!added.success) throw new Error(added.error)
        }
      } catch (cause) {
        throw new DuplicateAborted(copy, '開始のきっかけ', cause)
      }

      /*
       * SCENARIO-08: アクション（通を送ったとき・選択肢を押したとき・
       * 配り終えたとき）。通にぶら下がるものは写した先の通へ張り替える。
       */
      try {
        const [sourceActions, copyActions] = await Promise.all([
          api.scenarios.actions.list(id),
          api.scenarios.actions.list(copy),
        ])
        if (!sourceActions.success) throw new Error(sourceActions.error)
        if (!copyActions.success) throw new Error(copyActions.error)
        const keyOf = (
          hook: string,
          stepId: string | null,
          choiceIndex: number | null,
          actionType: string,
          sortOrder: number,
        ) => `${hook}:${stepId ?? ''}:${choiceIndex ?? ''}:${actionType}:${sortOrder}`
        const have = new Set(
          copyActions.data.map((a) => keyOf(a.hook, a.stepId, a.choiceIndex, a.actionType, a.sortOrder)),
        )
        for (const action of sourceActions.data) {
          const mappedStepId = action.stepId === null ? null : stepIdMap.get(action.stepId) ?? null
          if (action.stepId !== null && mappedStepId === null) {
            // 写せなかった通にぶら下がるアクションは足さない。
            continue
          }
          const key = keyOf(action.hook, mappedStepId, action.choiceIndex, action.actionType, action.sortOrder)
          if (have.has(key)) continue
          const createdAction = await api.scenarios.actions.create(copy, {
            hook: action.hook,
            stepId: mappedStepId,
            choiceIndex: action.choiceIndex,
            actionType: action.actionType,
            config: action.config,
            condition: action.condition,
            repeatOnRefire: action.repeatOnRefire,
            sortOrder: action.sortOrder,
          })
          if (!createdAction.success) throw new Error(createdAction.error)
          have.add(key)
        }
      } catch (cause) {
        throw new DuplicateAborted(copy, 'アクション', cause)
      }

      setDuplicateRemainder(null)
      router.push(`/scenarios/detail?id=${copy}`)
    } catch (e) {
      if (e instanceof DuplicateAborted) {
        // SCENARIO-09: 不完全なコピーが残っていることを隠さない。
        // 所在・止まった段階・やり直し/削除の窓を出す。
        setDuplicateRemainder({
          copyId: e.copyId,
          copyName,
          stage: e.stage,
          detail: e.message,
        })
        setError(`複製が「${e.stage}」で止まりました。途中まで作成されたコピーが残っています。`)
      } else {
        setError(e instanceof Error && e.message ? e.message : '複製に失敗しました。通信を確かめて、もう一度お試しください。')
      }
    } finally {
      setDuplicating(false)
    }
  }

  /*
   * SCENARIO-09: 途中まで作られたコピーを捨てる。元のシナリオは
   * 触らない。失敗したら窓の中に理由を出して開いたままにする。
   */
  const handleDiscardDuplicate = async () => {
    if (!duplicateRemainder || discardingDuplicate) return
    setDiscardingDuplicate(true)
    setDiscardDuplicateError('')
    try {
      const res = await api.scenarios.delete(duplicateRemainder.copyId)
      if (!res.success) throw new Error(res.error)
      setDiscardDuplicateOpen(false)
      setDuplicateRemainder(null)
    } catch {
      setDiscardDuplicateError('作りかけのコピーを削除できませんでした。コピーを開いて状態を確認し、もう一度お試しください。')
    } finally {
      setDiscardingDuplicate(false)
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
        loadScenario(true)
      } else {
        setError(res.error)
      }
    } catch {
      setError('保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  const openAddStep = () => {
    const nextOrder = nextStepOrder(scenario?.steps ?? [])
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
    const nextOrder = nextStepOrder(scenario?.steps ?? [])
    setStepForm({ ...emptyStepForm(nextOrder), question: emptyQuestion() })
    setEditingStepId(null)
    setShowStepForm(true)
    setInsertAfter(null)
    setStepError('')
  }

  const openAddTemplateStep = () => {
    const nextOrder = nextStepOrder(scenario?.steps ?? [])
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
      /* R246: 開くときに鍵を振る。削除・追加の追跡に使う。 */
      question: step.question ? withChoiceKeys(step.question as ScenarioQuestion) : null,
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

  /*
   * R246: 選択肢別アクションの紐づけを、位置ではなく選択肢の鍵で付け替える。
   * 口に choiceIndex の書き換えが無いため、移動は「消して作り直し」で行う
   * （中身・条件・繰り返しは引き継ぐ）。失敗時は文を返し、呼び出し側が
   * 画面を閉じずに知らせる。成功・対象なしは null。
   */
  const remapChoiceActions = async (
    stepId: string,
    nextQuestion: ScenarioQuestion | null,
  ): Promise<string | null> => {
    const prevStep = scenario?.steps.find((step) => step.id === stepId)
    const prevQuestion = (prevStep?.question as ScenarioQuestion | null) ?? null
    if (!prevQuestion && !nextQuestion) return null
    const list = await api.scenarios.actions.list(id)
    if (!list.success) return '選択肢の動作を読み直せませんでした。画面を開き直して対応を確認してください。'
    const rows = list.data.filter(
      (action) => action.hook === 'choice_selected' && (action.stepId ?? null) === stepId,
    )
    if (rows.length === 0) return null
    const plan = planChoiceActionRemap(prevQuestion?.choices ?? [], nextQuestion?.choices ?? [], rows)
    if (plan.removeIds.length === 0 && plan.moveTo.length === 0) return null
    const moveById = new Map(plan.moveTo.map((move) => [move.id, move.choiceIndex]))
    for (const row of rows) {
      const moveTo = moveById.get(row.id)
      if (moveTo === undefined && !plan.removeIds.includes(row.id)) continue
      const removed = await api.scenarios.actions.remove(id, row.id)
      if (!removed.success) return '選択肢の動作の付け替えに失敗しました。画面を開き直して対応を確認してください。'
      if (moveTo !== undefined) {
        const recreated = await api.scenarios.actions.create(id, {
          hook: row.hook,
          stepId: row.stepId,
          choiceIndex: moveTo,
          actionType: row.actionType,
          config: row.config ?? {},
          condition: row.condition ?? null,
          repeatOnRefire: row.repeatOnRefire,
          sortOrder: row.sortOrder,
        })
        if (!recreated.success) return '選択肢の動作の付け替えに失敗しました。画面を開き直して対応を確認してください。'
      }
    }
    return null
  }

  const handleSaveStep = async () => {
    /*
     * SCENARIO-21: 質問・直接入力・テンプレートはそれぞれ独立して検査する。
     * 以前は質問がある通も else に流れてテンプレート必須判定にかかり、
     * 直接作った質問が保存できなかった。
     */
    if (stepForm.question) {
      if (!stepForm.question.text.trim()) {
        setStepError('質問文を入力してください')
        return
      }
      if (stepForm.question.choices.length === 0 || stepForm.question.choices.some((choice) => !choice.label.trim())) {
        setStepError('すべての選択肢に文字を入力してください')
        return
      }
      /*
       * SCENARIO-22: URLなどを開くだけの挙動に、届かない通知を待つ設定
       * （返信・タグ・友だち情報）が残っていると保存を止める。消すか
       * 「何もしない」に変えるかは本人に選ばせ、黙って消さない。
       */
      const deadIndex = stepForm.question.choices.findIndex(
        (choice) => isUriOnlyBehavior(choice.behavior) && deadAnswerSettings(choice).length > 0,
      )
      if (deadIndex >= 0) {
        const dead = deadAnswerSettings(stepForm.question.choices[deadIndex])
        setStepError(
          `選択肢${deadIndex + 1}はURLなどを開くだけの挙動のため、設定されている${dead.join('・')}は実行されません。設定を消すか、挙動を「何もしない」に変えてください。`,
        )
        return
      }
      /*
       * R214: 行き先（URL・電話・メール）の形を見る。not-a-url のような
       * 値でも保存できると、設定済みに見えて実際は開けない通になる。
       * 下書きでも通さず、その場で直せるよう選択肢番号で名指しする。
       */
      const uriError = validateChoiceUris(stepForm.question)
      if (uriError) {
        setStepError(uriError)
        return
      }
    } else if (stepForm.inputMode === 'direct') {
      // 直接入力モード: messageContent 必須 + Flex/画像 は JSON parse 検証
      if (!stepForm.messageContent.trim()) {
        /*
         * R234: 専用欄（音声・スタンプなど）で「入っているが送れない」値の
         * ときは、どこが悪いかをはっきり言う。「入力してください」だけだと
         * 空欄と区別がつかず、足しても足しても通らない。
         */
        if (isStructuredKind(stepForm.messageType)) {
          const problem = messageKindProblem(stepForm.messageType as MessageKind, kindState)
          if (problem) {
            setStepError(problem)
            return
          }
        }
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
    /*
     * R235: 時刻指定なのに時刻が空のまま送ると、サーバーが 400 で断る。
     * 投げる前に時刻の欄へ戻す。時刻の欄の場所（「購読開始から ○日後の
     * ○に配信」）も文に入れ、どこを直すか分かるようにする。
     */
    if (deliveryMode === 'absolute_time' && !isDeliveryTimeSet(stepForm.schedule.deliveryTime)) {
      setStepError('配信する時刻を入力してください（「購読開始から ○日後の ○に配信」の時刻の欄）')
      return
    }
    /*
     * R247: 1通の配信条件の不正範囲（上下限の逆転など）は落とさず、
     * 欄の下で知らせて止める。保存済みの条件は維持する。
     */
    const rangeIssue = findInvalidRangeIssue(stepForm.targetCondition ?? null)
    if (rangeIssue) {
      setStepError(rangeIssue)
      return
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
      /* R246: 保存直前にも鍵を振る。削除・追加の追跡に使う。 */
      const keyedQuestion = stepForm.question ? withChoiceKeys(stepForm.question) : null
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
        question: keyedQuestion,
        isDraft: stepForm.isDraft,
      }
      if (editingStepId) {
        const res = await api.scenarios.updateStep(id, editingStepId, payload)
        if (!res.success) {
          setStepError(res.error)
          return
        }
        /*
         * R246: 質問と動作の更新を一緒に確定する。選択肢の削除・追加で
         * 位置がずれても、残る選択肢の動作を保持し、消えた選択肢の動作
         * だけを消す。新しい選択肢は行が無い（0件から始める）。
         */
        const remapError = await remapChoiceActions(editingStepId, keyedQuestion)
        if (remapError) {
          setStepError(remapError)
          await loadScenario(true)
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
              setStepError('あいだに入れるための並べ替えに失敗しました。通信を確かめて、もう一度お試しください。')
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
      loadScenario(true)
      reloadStats()
    } catch (error) {
      /*
       * R235: 入力の不備（400番台）と通信・サーバーの失敗を分ける。
       * 時刻の空などの入力エラーまで「通信を確かめて」と出すと、
       * 直せるものを直せず再試行を繰り返すことになる。
       */
      setStepError(error instanceof ApiError && error.status >= 400 && error.status < 500
        ? '入力内容に不備があります。時刻・本文を確かめて、もう一度お試しください。'
        : 'ステップの保存に失敗しました。通信を確かめて、もう一度お試しください。')
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
    setStepError('')
    try {
      /*
       * あいだに差し込むので、後ろの通を先に1つずつ送る。
       * 送らずに同じ番号で足すと、並び順が重なってどちらが先か決まらない。
       * 後ろから順に動かすのは、途中で番号がぶつからないようにするため。
       * （handleSaveStep の insertAfter 経路と同じ）
       */
      const moving = sortedSteps
        .filter((st) => st.stepOrder > step.stepOrder)
        .sort((a, b) => b.stepOrder - a.stepOrder)
      if (moving.length > 0) {
        const moved = await api.scenarios.reorderSteps(
          id,
          moving.map((st) => ({ stepId: st.id, stepOrder: st.stepOrder + 1 })),
        )
        if (!moved.success) {
          setStepError('あいだに入れるための並べ替えに失敗しました。通信を確かめて、もう一度お試しください。')
          return
        }
      }
      const res = await api.scenarios.addStep(id, {
        stepOrder: step.stepOrder + 1,
        messageType: step.messageType,
        messageContent: step.messageContent,
        // 方式に合う時刻の欄だけ送る。余分な欄があると口が 400 で止める。
        ...stepScheduleForClone(deliveryMode, step),
        templateId: step.templateId ?? null,
        onReachTagId: step.onReachTagId ?? null,
        afterSend: step.afterSend,
        targetCondition: (step.targetCondition as SegmentCondition | null) ?? null,
        question: (step.question as ScenarioQuestion | null) ?? null,
        isDraft: step.isDraft === true,
      })
      if (!res.success) {
        setStepError(res.error)
        return
      }
      loadScenario(true)
      reloadStats()
    } catch {
      setStepError('この通を複製できませんでした')
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
      void loadScenario(true)
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
      loadScenario(true)
      // 到達率バッジは stepOrder ベースでマッチングするので、並び替え後は stats も再取得
      reloadStats()
    } catch {
      setError('並び替えに失敗しました。通信を確かめて、もう一度お試しください。')
    }
  }

  /*
   * 通の編集フォームの右の柱（「配信の流れ」「設定サマリー」）へ渡す
   * 日・時間・分。方式ごとの持ち方（relative の合計分 / elapsed の
   * 日・時間・分）を previewOffsets 1か所でそろえる。分だけ渡し忘れると、
   * 設定内容は「1分後」なのにプレビューが「すぐに」のまま残る（#616 SC-02b）。
   */
  const stepFormPreview = previewOffsets(deliveryMode, stepForm.schedule)

  // 新規追加（上部）とステップ編集（行直下インライン）の両方で使うフォーム。
  // 同時に開くのは常に片方だけなので、state は stepForm を共有する。
  const renderStepForm = () => (
    <div className={editingStepId ? '' : 'border-hairline rounded-card bg-canvas-sunken border p-4'}>
      {!editingStepId && (
        <h4 className="text-sm font-semibold text-ink-secondary mb-3">新しいステップを追加</h4>
      )}
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
          <Select
            aria-label="送信後"
            value={stepForm.afterSend}
            onChange={(value) =>
              setStepForm({ ...stepForm, afterSend: value as 'continue' | 'pause' })
            }
            options={[
              { value: 'continue', label: '送信後：次のステップへ進む' },
              { value: 'pause', label: '送信後：ここで一時停止する' },
            ]}
            size="full"
          />
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
          <RadioCardGroup legend="メッセージの指定方法" className="grid gap-2 sm:grid-cols-2">
            <RadioCard
              name="step-input-mode"
              value="direct"
              checked={stepForm.inputMode === 'direct'}
              onChange={() => setStepForm({ ...stepForm, inputMode: 'direct', templateId: null })}
              title="直接入力"
            />
            <RadioCard
              name="step-input-mode"
              value="template"
              checked={stepForm.inputMode === 'template'}
              onChange={() => setStepForm({ ...stepForm, inputMode: 'template' })}
              title="テンプレートを使う"
            />
          </RadioCardGroup>
        </div>

        {/*
          質問（分岐）の通。本文の代わりに選択肢を組み立てる。ふつうの通と
          行き来できるように、切り替えのボタンをここに置く。
        */}
        {stepForm.question ? (
          <div className="border-hairline rounded-card border p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-ink text-sm font-bold">質問（分岐）</h4>
              <Button variant="secondary" className="text-ink-secondary h-9 px-3 text-xs whitespace-normal" type="button" onClick={() => setStepForm({ ...stepForm, question: null })}>
                ふつうの通に戻す
              </Button>
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
          <Button variant="secondary" className="text-ink-secondary h-9 self-start px-3 text-xs whitespace-normal" type="button" onClick={() => setStepForm({ ...stepForm, question: emptyQuestion() })}>
            この通を質問（分岐）にする
          </Button>
        )}

        {!stepForm.question && stepForm.inputMode === 'template' && (
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">テンプレート <span className="text-danger">*</span></label>
            <Select
              aria-label="テンプレート"
              value={stepForm.templateId ?? ''}
              onChange={(value) => {
                const templateId = value || null
                const template = templates.find((item) => item.id === templateId)
                setStepForm({
                  ...stepForm,
                  templateId,
                  question: template?.question
                    ? withChoiceKeys(structuredClone(template.question) as ScenarioQuestion)
                    : null,
                  messageType: (template?.messageType as MessageType | undefined) ?? stepForm.messageType,
                  messageContent: template?.messageContent ?? stepForm.messageContent,
                })
              }}
              options={[
                { value: '', label: '-- 選択してください --' },
                ...templates.map((t) => ({
                  value: t.id,
                  label: `${t.name}${t.category ? ` (${t.category})` : ''}`,
                })),
              ]}
              size="full"
            />
            <p className="text-xs text-warning mt-1">
              ⓘ テンプレートが修正されると、このステップの内容も自動で同期されます
            </p>
          </div>
        )}

        {!stepForm.question && stepForm.inputMode === 'direct' && (
          <>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">メッセージタイプ</label>
              <Select
                aria-label="メッセージタイプ"
                value={stepForm.messageType}
                onChange={(value) => setStepForm({ ...stepForm, messageType: value as MessageType })}
                options={messageTypeOptions}
                size="full"
              />
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
              className="text-action shrink-0 text-xs hover:underline"
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
                className="text-action shrink-0 text-xs hover:underline"
              >
                ＋ アクションを追加
              </button>
            ) : undefined
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">到達したらタグ付与</label>
              <Select
                aria-label="到達したらタグ付与"
                value={stepForm.onReachTagId ?? ''}
                onChange={(value) => setStepForm({ ...stepForm, onReachTagId: value || null })}
                options={[
                  { value: '', label: '-- なし --' },
                  ...tags.map((t) => ({ value: t.id, label: t.name })),
                ]}
                size="full"
              />
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
        <Checkbox
          checked={stepForm.isDraft}
          onCheckedChange={(checked) => setStepForm({ ...stepForm, isDraft: checked })}
        >
          下書きにする（配信されません。テスト送信では送れます）
        </Checkbox>

        {stepError && <p className="text-danger text-xs">{stepError}</p>}

        <div className="flex gap-2">
          <Button variant="primary" className="px-4 py-2 min-h-[44px] font-medium disabled:opacity-50 border-0 h-auto whitespace-normal" onClick={handleSaveStep} disabled={stepSaving}>
            {stepSaving ? '保存中...' : editingStepId ? '更新' : '追加する'}
          </Button>
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
        <StepPreview
          deliveryMode={deliveryMode}
          stepOrder={stepForm.stepOrder}
          offsetDays={stepFormPreview.offsetDays}
          deliveryTime={stepForm.schedule.deliveryTime}
          offsetHours={stepFormPreview.offsetHours}
          offsetMinutes={stepFormPreview.offsetMinutes}
          kind={(stepForm.question
            ? 'question'
            : stepForm.messageType === 'flex'
              ? 'text'
              : stepForm.messageType) as StepMessageKind}
          templateName={
            stepForm.templateId
              ? templates.find((template) => template.id === stepForm.templateId)?.name
              : null
          }
          body={stepForm.messageContent}
          imageUrl={null}
          question={stepForm.question}
          kindState={kindState}
          audienceLabel={describeStepAudience(stepForm.targetCondition, tags)}
          afterSend={stepForm.afterSend}
        />

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

        {/* ★V7 仕上げ §3: 枠は最初から本物で出し、中身の場所だけ骨組み。 */}
        <div className="bg-canvas rounded-card border border-hairline p-8 space-y-4">
          <DelayedSkeleton
            loading
            skeleton={
              <div className="space-y-4">
                <Skeleton className="block h-6 w-1/3" />
                <Skeleton className="block h-4 w-2/3" />
                <Skeleton className="block h-4 w-1/2" />
              </div>
            }
          />
        </div>
      </div>
    )
  }

  if (!scenario && (scenarioMissing || !error)) {
    return (
      <TargetMissing
        kind="not-found"
        title="このシナリオは見つかりません"
        description="削除されたか、別の LINE アカウントのものです。一覧から選び直してください。"
        backHref="/scenarios"
        backLabel="シナリオ一覧へ戻る"
      />
    )
  }

  if (!scenario) {
    return (
      <TargetMissing
        kind="error"
        title="シナリオを読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => void loadScenario(true)}
      />
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
  const isActiveNow = showStarted || scenario.isActive
  /* 右の欄のスマホに出す通。行を押した通、無ければいちばん上の通。 */
  const railStep = sortedSteps.find((step) => step.id === railStepId) ?? sortedSteps[0] ?? null
  const railTemplate = railStep?.templateId
    ? templates.find((template) => template.id === railStep.templateId) ?? null
    : null

  return (
    <div className={styles.page}>
      <div className={editingStepId ? `${styles.split} ${styles.splitEditing}` : styles.split}>
      <div className={styles.main}>
        {/*
          ★V8（PMLkX）の見出し。「← シナリオ配信へ」・題・状態の札・
          名前を変える鉛筆。副の行にフォルダ・配信方式（作ったあとは
          変えられません）・同時購読の状態を並べる。右には「配信結果を
          見る・まとめて下見・まとめてテストを送る」と「…」（複製・削除）。
        */}
        <nav data-design="Crumb">
          <Link href="/scenarios" className={styles.backLink}>
            ← シナリオ配信へ
          </Link>
        </nav>

        <div className={editingStepId ? styles.editHeadRow : styles.head}>
        {!editingStepId ? (
          <div data-design="Head">
            <div className={styles.headRow}>
              <h1 className={styles.title}>
                <span className={styles.titleName}>{scenario.name}</span>
                <StatusChip status={isActiveNow ? 'running' : 'paused'} size="default" />
                <button
                  type="button"
                  className={styles.renameButton}
                  aria-label="名前を変える"
                  title="名前を変える"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              </h1>
              <div className={styles.headActions}>
                <Button href={`/scenarios/results?id=${id}`}>配信結果を見る</Button>
                <Button
                  variant="secondary"
                  onClick={() => setPreviewOpen(true)}
                  disabled={sortedSteps.length === 0}
                  title={sortedSteps.length === 0 ? 'コンテンツがまだありません' : undefined}
                >
                  まとめて下見
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setTestSend({ stepId: null, label: 'このシナリオの全通' })}
                  disabled={sortedSteps.length === 0}
                  title={sortedSteps.length === 0 ? 'コンテンツがまだありません' : undefined}
                >
                  まとめてテストを送る
                </Button>
                <span className="relative inline-flex">
                  <MoreAction
                    label="シナリオのその他操作"
                    aria-expanded={headMenuOpen}
                    onClick={() => setHeadMenuOpen((open) => !open)}
                  />
                  <ActionMenu
                    open={headMenuOpen}
                    ariaLabel="シナリオの操作"
                    onClose={() => setHeadMenuOpen(false)}
                    items={[
                      { id: 'duplicate', label: duplicating ? '複製中…' : '複製する', disabled: duplicating, disabledReason: 'このシナリオを複製しています', onSelect: () => { void handleDuplicate() } },
                      { id: 'delete', label: 'このシナリオを削除する', tone: 'danger' as const, dividerBefore: true, onSelect: () => { setDeleteScenarioError(''); setDeleteScenarioOpen(true) } },
                    ]}
                  />
                </span>
              </div>
            </div>
            <p className={styles.meta}>
              フォルダ：{scenarioFolderName}・配信方式：{modeBadge.label}（作ったあとは変えられません）・
              {/* 現在値とヘルプを一致させる（U007）。札の文言は編集フォームの
                  「他のシナリオが動いている人は登録しない」と同じ意味で、
                  今の状態と切り替え後の影響を分けて書く。 */}
              <button
                type="button"
                onClick={() => void handleConcurrentChange(!(scenario.allowConcurrent ?? true))}
                title={
                  (scenario.allowConcurrent ?? true)
                    ? 'いまは同時購読を許しています。他のシナリオが動いている人にも、このシナリオを並行して流します。押すと「同時に1つだけ」へ変わり、他のシナリオが動いている人はこのシナリオに入らなくなります。'
                    : 'いまは同時に1つだけです。他のシナリオが動いている人はこのシナリオに入りません。すでに入っている人には影響しません。押すと同時購読を許すようになります。'
                }
                className={styles.metaLink}
              >
                {(scenario.allowConcurrent ?? true)
                  ? '同時購読を許可中'
                  : '同時に購読できるシナリオは 1つ'}
              </button>
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-faint text-xs">{stepForm.stepOrder}通目を編集</span>
            <span className={styles.editHeadGap} />
            <Button onClick={closeStepForm}>編集を閉じる</Button>
            <Button variant="primary" onClick={() => void handleSaveStep()} disabled={stepSaving} busy={stepSaving}>保存する
            </Button>
          </div>
        )}
        </div>

      {editingStepId ? (
        <section data-design-node="xfYLn">
          {renderStepForm()}
        </section>
      ) : (
      <>
      {/* nMSiE：配信を始めた直後の知らせ。*/}
      {showStarted ? (
        <div className={styles.startedBanner} role="status">
          <p className={styles.startedText}>
            配信を始めました。
            {simulationRefreshing
              ? '予約中の人数を計算しています…'
              : simulation
                ? `予約中の ${formatNumber(simulation.audience.newStartPlanned)} 人へ、条件を満たした人から順に送ります`
                : '条件を満たした友だちから順に送ります。'}
          </p>
          <Link href={`/scenarios/results?id=${encodeURIComponent(id)}`} className={styles.startedLink}>
            始めた記録を見る
          </Link>
        </div>
      ) : null}

      {error && (
        <Notice tone="danger" message={error} className="mb-4" />
      )}

      {/*
        ★V8（PMLkX・ARuZ4）：3 つの箱は同じ高さ。
        1 保存／2 開始のきっかけ／3 配信。「作成しただけでは配信されません」は
        1 の箱の説明として残す（帯で別段にすると流れと読み分けがつかなかった）。
      */}
      <div className={styles.boxGrid}>
        <section className={styles.box}>
          <p className={styles.boxStep}>1</p>
          <h3 className={styles.boxTitle}>保存</h3>
          <p className={styles.boxBody}>
            {scenario.updatedAt
              ? `保存済み ${formatDateTime(new Date(scenario.updatedAt))}`
              : '保存済み'}
          </p>
          <p className={styles.boxNote}>保存しただけでは誰にも届きません</p>
        </section>
        <section className={styles.box}>
          <p className={styles.boxStep}>2</p>
          <h3 className={styles.boxTitle}>開始のきっかけ</h3>
          <p className={styles.boxBody}>
            {triggerCount === null
              ? '—'
              : triggerCount === 0
                ? '呼ばれたときだけ'
                : `${triggerCount} 件のきっかけ`}
          </p>
          <p className={styles.boxNote}>
            対象：{describeCondition((scenario.audienceCondition as SegmentCondition | null) ?? null)}。
            {triggerCount === 0 ? 'アクションなどから開始できます' : 'きっかけが来た人から始まります'}
          </p>
          <button
            type="button"
            className={styles.boxAction}
            onClick={() => setTriggerOpen(true)}
            data-qa-open="EvVO5"
          >
            設定を変える
          </button>
          <button
            type="button"
            onClick={() => setAudienceOpen(true)}
            className={styles.boxLink}
          >
            対象の絞り込み
          </button>
        </section>
        <section className={styles.box}>
          <p className={styles.boxStep}>3</p>
          <h3 className={styles.boxTitle}>配信</h3>
          <p className={styles.boxBody}>
            <StatusChip status={isActiveNow ? 'running' : 'paused'} size="default" />
            {' '}
            {isActiveNow ? '送っています' : '止めています'}
          </p>
          <p className={styles.boxNote}>
            {isActiveNow
              ? showStarted && latestStartedLabel
                ? `${latestStartedLabel} 開始。止めても、途中の人の記録は残ります`
                : '止めても、途中の人の記録は残ります'
              : '再開すると、止めたところから続き送ります'}
          </p>
          <Button
            variant={isActiveNow ? 'secondary' : 'primary'}
            onClick={() => void handleToggleActive()}
            disabled={togglingActive}
            busy={togglingActive}
          >
            {isActiveNow ? '一時停止する' : '配信を再開する'}
          </Button>
        </section>
      </div>

      {/*
        ★V8：名前・説明・フォルダなどは鉛筆から開く編集の面。
        「保存」は下の帯。フィールドの集合は v7 の編集フォームと同じ。
      */}
      {editing ? (
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>シナリオの設定</h3>
          <div className="space-y-4">
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
              {/*
                SCENARIO-20: 候補はシナリオ所属アカウントのものだけ。
                取得できないあいだは変更を止める（候補外の値を
                黙って保存しないため）。保存済みの値が候補に無いときは
                値を消さず、名前を確認できない旨の選択肢として残す。
              */}
              <Select
                aria-label="フォルダ"
                value={editForm.folderId}
                disabled={folderState !== 'ready'}
                onChange={(value) => setEditForm({ ...editForm, folderId: value })}
                options={[
                  { value: '', label: '未分類' },
                  ...(editFolderMissing
                    ? [{ value: editForm.folderId, label: '名前を確認できません' }]
                    : []),
                  ...folders.map((f) => ({ value: f.id, label: f.name })),
                ]}
                size="full"
              />
              <p className="text-ink-faint mt-1 text-xs">一覧の左のパネルで、この分類ごとに絞り込めます。</p>
              {folderState !== 'ready' ? (
                <p className="text-ink-faint mt-1 text-xs">
                  {folderState === 'loading'
                    ? 'フォルダを読み込んでいます。'
                    : 'フォルダを確認できないため、いまは変更できません。'}
                </p>
              ) : editFolderMissing ? (
                <p className="text-warning mt-1 text-xs">
                  選択中のフォルダはこのアカウントの候補にありません（別アカウントのものか、削除済みです）。保存済みの分類はそのまま残ります。
                </p>
              ) : null}
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">トリガー</label>
              <Select
                aria-label="トリガー"
                value={editForm.triggerType}
                onChange={(value) => setEditForm({ ...editForm, triggerType: value as ScenarioTriggerType })}
                options={triggerOptions}
                size="full"
              />
            </div>
            <div className="border-hairline rounded-card border p-3">
              <Checkbox
                checked={!editForm.allowConcurrent}
                onCheckedChange={(checked) => setEditForm({ ...editForm, allowConcurrent: !checked })}
                description="既定では、1人が複数のシナリオに同時に入れます。ここをチェックすると、他のシナリオが動いている人はこのシナリオに入りません。すでに入っている人には影響しません。"
              >
                他のシナリオが動いている人は登録しない
              </Checkbox>
            </div>
          </div>
        </section>
      ) : null}

      {/*
        ★V8 の数の帯 4 つ（PMLkX）：購読中・読み終えた・始まる見込み（試算）・
        離脱が多い所。試算は「いま保存されている設定」への結果で、取り直し中は
        旧値を確定値として出さない（SCENARIO-15）。
      */}
      {stats && stats.enrolledTotal > 0 && (
        <div data-design="KPIs" className={styles.statBand}>
          <div className={styles.statCell}>
            <p className={styles.statLabel}>購読中</p>
            <p className={styles.statValue}>
              {formatNumber(stats.activeNow)}
              <span className={styles.statUnit}>人</span>
            </p>
            <p className={styles.statNote}>いま途中にいる人</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statLabel}>読み終えた</p>
            <p className={styles.statValue}>
              {formatNumber(stats.completed)}
              <span className={styles.statUnit}>人</span>
            </p>
            <p className={styles.statNote}>最後の1通まで届いた人</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statLabel}>始まる見込み（試算）</p>
            <p className={styles.statValue}>
              {simulationRefreshing ? '…' : simulation ? formatNumber(simulation.audience.newStartPlanned) : '—'}
              <span className={styles.statUnit}>人</span>
            </p>
            <p className={styles.statNote}>きっかけが来たら始まる見込み。確定ではない</p>
          </div>
          <div className={styles.statCell}>
            <p className={styles.statLabel}>離脱が多い所</p>
            {biggestDrop ? (
              <p className={styles.statDrop}>
                {biggestDrop.fromOrder}→{biggestDrop.toOrder}通目
              </p>
            ) : (
              <p className={styles.statValue}>—</p>
            )}
            <p className={styles.statNote}>
              {biggestDrop
                ? `${biggestDrop.fromOrder}通目で ${formatNumber(biggestDrop.lost)}人（${Math.round(biggestDrop.rate * 100)}%）が離れています`
                : 'いまのところ大きく減る所はありません'}
            </p>
          </div>
        </div>
      )}

      {/* ★V8「最後の1通の後」の行（変える → OnCompleteDialog）。 */}
      <div className={styles.completeRow}>
        <span className={styles.completeLabel}>最後の1通の後</span>
        <strong className={styles.completeValue}>
          {ON_COMPLETE_LABEL[(scenario.onCompleteMode ?? 'pause') as OnCompleteMode]}
        </strong>
        <span className={styles.completeNote}>
          {(scenario.onCompleteMode ?? 'pause') === 'move' && !scenario.onCompleteScenarioId
            ? '移動先が選ばれていません。変えるから選び直してください。'
            : actionCounts['__complete__']
              ? `アクション ${actionCounts['__complete__']} 件`
              : '読み終えた人を次のシナリオへ送ることができます'}
        </span>
        <button type="button" className={styles.completeAction} onClick={() => setOnCompleteOpen(true)}>
          変える
        </button>
      </div>

      {/*
        ★V8「メッセージ（N通）」。行は「N通目・いつ・届く日時の例・内容の
        見出し・種別・↑↓・…」。行を押すと右の欄のスマホがその通に変わる。
        行のあいだの「＋ ここに挿入」は v7 と同じ位置に出す（V8 では
        常に見せる。薄くすると気づかれない）。
      */}
      <section className={styles.panel}>
        <h3 className={styles.panelTitle}>メッセージ（{sortedSteps.length}通）</h3>

        {sortedSteps.length === 0 && !showStepForm ? (
          <div className={styles.emptySteps}>
            まだ1通もありません。下の「＋ メッセージを追加する」から足してください。
          </div>
        ) : (
          <ul className={styles.stepList}>
            {sortedSteps.map((step, idx) => {
              const tpl = step.templateId
                ? templates.find((t) => t.id === step.templateId)
                : null
              // 内容の桁は見出しだけ出す。中身は右の欄のスマホで見る。
              // R215: 質問の通は messageContent が空（' '）のまま残る。
              // 質問文を見出しにする。
              const kindLabel = stepKindLabel(
                step,
                tpl?.name ?? null,
                messageTypeOptions.find((o) => o.value === step.messageType)?.label ??
                  step.messageType,
              )
              const title = stepListTitle(step, tpl?.name ?? null)
              const isRailTarget = railStep?.id === step.id
              return (
                <Fragment key={step.id}>
                  {idx > 0 && (
                    <li className={styles.insertRow}>
                      <span className={styles.insertLine} aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => openInsertStep(sortedSteps[idx - 1].stepOrder)}
                        className={styles.insertButton}
                      >
                        ＋ ここに挿入
                      </button>
                      <span className={styles.insertLine} aria-hidden="true" />
                    </li>
                  )}
                  <li
                    className={`${styles.stepRow}${isRailTarget ? ` ${styles.stepRowSelected}` : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.stepMain}
                      onClick={() => setRailStepId(step.id)}
                      title="右の欄にこの通の見え方を出す"
                    >
                      <span className={styles.stepNo}>{step.stepOrder}通目</span>
                      <span className={styles.stepTiming}>
                        <span className={styles.stepWhen}>{formatScheduleLabel(deliveryMode, step)}</span>
                        <span className={styles.stepExample}>{stepExampleLabel(deliveryMode, step)}</span>
                      </span>
                      <span className={styles.stepTitleCell}>
                        <span className={styles.stepTitle}>{title}</span>
                        {step.isDraft === true && <StatusChip status="draft" />}
                      </span>
                    </button>
                    <span className={styles.stepKind}>{kindLabel}</span>
                    <span className={styles.stepOps}>
                      <button
                        type="button"
                        onClick={() => void handleMoveStep(step.id, 'up')}
                        disabled={idx === 0}
                        aria-label="上へ"
                        className={styles.moveButton}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveStep(step.id, 'down')}
                        disabled={idx === sortedSteps.length - 1}
                        aria-label="下へ"
                        className={styles.moveButton}
                      >
                        ↓
                      </button>
                      <span className="relative inline-flex">
                        <MoreAction
                          label={`${step.stepOrder}通目のその他操作`}
                          aria-expanded={stepMenuId === step.id}
                          onClick={() => setStepMenuId((current) => (current === step.id ? null : step.id))}
                        />
                        <ActionMenu
                          open={stepMenuId === step.id}
                          ariaLabel={`${step.stepOrder}通目の操作`}
                          onClose={() => setStepMenuId(null)}
                          items={[
                            { id: 'edit', label: editingStepId === step.id ? '編集を閉じる' : '編集', onSelect: () => { if (editingStepId === step.id) { closeStepForm() } else { openEditStep(step) } } },
                            { id: 'preview', label: '見え方を確認', onSelect: () => setRailStepId(step.id) },
                            { id: 'test', label: 'テスト', onSelect: () => setTestSend({ stepId: step.id, label: `${step.stepOrder}通目` }) },
                            /* この通を送ったあとに動かすアクション。件数を出すのは、設定済みを忘れて二重に足すのを防ぐため。 */
                            { id: 'action', label: `アクション${actionCounts[step.id] ? ` ${actionCounts[step.id]}` : ''}`, onSelect: () => setActionTarget({ hook: 'step_sent', stepId: step.id, choiceIndex: null, title: `${step.stepOrder}通目を送ったあと` }) },
                            { id: 'duplicate', label: duplicatingStepId === step.id ? '複製中…' : '複製', disabled: duplicatingStepId === step.id, disabledReason: 'この通を複製しています', onSelect: () => { void handleDuplicateStep(step) } },
                            { id: 'delete', label: '削除する', tone: 'danger' as const, dividerBefore: true, onSelect: () => { setDeleteStepError(''); setDeleteStepTarget(step) } },
                          ]}
                        />
                      </span>
                    </span>
                  </li>
                  {editingStepId === step.id && (
                    <li className={styles.stepEditRow}>
                      {renderStepForm()}
                    </li>
                  )}
                  {showStepForm && insertAfter === step.stepOrder && (
                    <li className={styles.stepEditRow}>
                      {renderStepForm()}
                    </li>
                  )}
                </Fragment>
              )
            })}
          </ul>
        )}

        {/* 末尾へ足すときの新規フォームは一覧の下に出す。 */}
        {showStepForm && insertAfter === null && !editingStepId && (
          <div className={styles.stepEditRow}>{renderStepForm()}</div>
        )}

        {/*
          ★V8「通ごとの数」。稼働中で、どこかの通に届いた記録があるときだけ
          出す（始めた直後・停止中の絵には無い）。届いたところが無い段階で
          出すと、全部「0人・—」の並びになって意味が読めない。
        */}
        {isActiveNow && (stats?.steps ?? []).some((s) => s.reachedCount > 0) && (
          <div className={styles.countPanel}>
            <h4 className={styles.countTitle}>通ごとの数</h4>
            <ul>
              {sortedSteps.map((step) => {
                const stat = stats?.steps.find((v) => v.stepOrder === step.stepOrder)
                const pct = scenarioReachPercent(stat?.reachRate)
                const width = scenarioReachBarWidth(pct)
                const after = describeAfterSend(step.afterSend)
                return (
                  <li key={step.id} className={styles.countRow}>
                    <span className={styles.countNo}>{step.stepOrder}通目</span>
                    <span className={styles.countAudience}>
                      {step.isDraft === true
                        ? <StatusChip status="draft" />
                        : describeStepAudience(step.targetCondition, tags)}
                    </span>
                    <span className={styles.countBar} aria-hidden="true">
                      {width !== null && <span style={{ width }} />}
                    </span>
                    <span className={styles.countReach}>
                      {stat
                        ? `到達 ${scenarioReachCountLabel(stat.reachedCount)}・${scenarioReachPercentLabel(pct)}`
                        : '— 到達'}
                    </span>
                    <span className={after.paused ? styles.countStop : styles.countContinue}>
                      配信後：{after.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* ★V8：行の下の文字ボタン 3 つ。質問は選択肢ごとに動きを付けられる。 */}
        <div className={styles.addRow}>
          <button type="button" className={styles.addButton} onClick={openAddStep}>
            ＋ メッセージを追加する
          </button>
          <button type="button" className={styles.addButton} onClick={openAddTemplateStep}>
            テンプレートを追加する
          </button>
          <button
            type="button"
            className={styles.addButton}
            onClick={openAddQuestionStep}
            title="質問メッセージを足します。選択肢ごとにタグ・友だち情報・シナリオを動かせます"
          >
            分岐を追加する
          </button>
        </div>
      </section>

      {/*
        SCENARIO-09: 途中まで作られたコピーが残っているとき、その所在と
        やり直し・削除・確認の導線を出す。黙って残すと、どこまで写ったか
        分からないシナリオが一覧に増える。
      */}
      {duplicateRemainder && (
        <div className="border-warning bg-warning-bg rounded-card border px-4 py-3" role="alert">
          <p className="text-warning text-sm font-bold">
            複製が「{duplicateRemainder.stage}」の途中で止まりました
          </p>
          <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
            途中まで作成されたコピー「{duplicateRemainder.copyName}」が残っています。
            {duplicateRemainder.detail ? `（${duplicateRemainder.detail}）` : ''}
            続きから複製をやり直すか、作りかけのコピーを削除してください。
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <button
              type="button"
              onClick={() => void handleDuplicate()}
              disabled={duplicating}
              className="text-info font-medium hover:underline disabled:opacity-40"
            >
              {duplicating ? '複製中...' : '続きから複製をやり直す'}
            </button>
            <Link
              href={`/scenarios/detail?id=${encodeURIComponent(duplicateRemainder.copyId)}`}
              className="text-ink-secondary hover:text-ink"
            >
              作りかけのコピーを開く
            </Link>
            <button
              type="button"
              onClick={() => {
                setDiscardDuplicateError('')
                setDiscardDuplicateOpen(true)
              }}
              className="text-danger font-medium hover:underline"
            >
              作りかけのコピーを削除する
            </button>
          </div>
        </div>
      )}

      </>
      )}
      </div>

      {/*
        ★V8 右の欄（380）：選んだ通の見え方。行を押すとその通に切り替わる。
        編集中の通はフォーム内のプレビューが見せるので、ここは保存済みの通。
      */}
      {!editingStepId && (
        <aside className={styles.side}>
          <h3 className={styles.sideTitle}>
            選んだ通{railStep ? `（${railStep.stepOrder}通目）` : ''}の見え方
          </h3>
          {railStep ? (
            <StepPreview
              deliveryMode={deliveryMode}
              stepOrder={railStep.stepOrder}
              offsetDays={railStep.offsetDays ?? 0}
              deliveryTime={railStep.deliveryTime ?? '09:00'}
              offsetHours={uiFromOffsetMinutes(railStep.offsetMinutes ?? 0).offsetHours}
              offsetMinutes={uiFromOffsetMinutes(railStep.offsetMinutes ?? 0).offsetMinutesRemainder}
              kind={(railStep.question
                ? 'question'
                : railStep.messageType === 'flex'
                  ? 'text'
                  : railStep.messageType) as StepMessageKind}
              templateName={railTemplate?.name ?? null}
              body={railTemplate ? railTemplate.messageContent : railStep.messageContent}
              imageUrl={null}
              question={(railStep.question as ScenarioQuestion | null) ?? null}
              kindState={
                isStructuredKind(railStep.messageType)
                  ? parseMessageKind(railStep.messageType as MessageKind, railStep.messageContent)
                  : emptyMessageKindState()
              }
              audienceLabel={describeStepAudience(railStep.targetCondition, tags)}
              afterSend={railStep.afterSend ?? 'continue'}
            />
          ) : (
            <p className={styles.sideEmpty}>
              まだ通がありません。メッセージを足すと、ここに見え方が出ます。
            </p>
          )}
        </aside>
      )}
      </div>

      {/*
        ★V8 の下の帯：削除は左端、キャンセル・複製する・保存するは真ん中。
        保存するものは鉛筆で開いた「シナリオの設定」の内容。
      */}
      {!editingStepId && (
        <StickyBar
          destructive={(
            <button
              type="button"
              data-qa-open="dqFft-scenario"
              onClick={() => {
                setDeleteScenarioError('')
                setDeleteScenarioOpen(true)
              }}
              className={styles.deleteButton}
            >
              このシナリオを削除する
            </button>
          )}
          status={duplicateRemainder ? `作りかけのコピー「${duplicateRemainder.copyName}」が残っています` : undefined}
          actions={(
            <>
              {/*
                SCENARIO-08: 何を写すか・何を写さないかを、押す前に見える
                場所に書く。写らないもの（配信履歴・購読中の人）まで写った
                と思って開始されると困る。
              */}
              <details className={styles.duplicateNote}>
                <summary className="cursor-pointer hover:text-ink-secondary">複製に含まれるもの</summary>
                <p className="mt-1 max-w-prose leading-relaxed">
                  名前・説明・置き場・配信対象の条件・終了後の処理・開始のきっかけ・すべての通
                  （内容・配信タイミング・配信対象・質問・下書きの別）・アクションを写し、
                  停止した状態で作ります。配信履歴と購読中の友だちは写りません。
                  複製しただけでは配信されません。
                </p>
              </details>
              <Button
                onClick={editing
                  ? () => {
                      setEditing(false)
                      setEditForm({
                        name: scenario.name,
                        description: scenario.description ?? '',
                        triggerType: scenario.triggerType,
                        isActive: scenario.isActive,
                        allowConcurrent: scenario.allowConcurrent !== false,
                        folderId: scenario.folderId ?? '',
                      })
                    }
                  : () => router.push('/scenarios')}
              >
                キャンセル
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleDuplicate()}
                disabled={duplicating}
                busy={duplicating}
              >
                {duplicateRemainder ? '続きから複製をやり直す' : '複製する'}
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveScenario}
                disabled={!editing || saving}
                busy={saving}
                title={editing ? undefined : '名前の横の鉛筆を押すと、ここで保存できます'}
              >
                保存する
              </Button>
            </>
          )}
        />
      )}

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
        confirmLabel="この通を削除する"
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
              : `現在${formatNumber(stats.activeNow)}人が購読中です。途中の人は続きを受け取れません。`,
          'シナリオの設定と今後の配信が削除されます。',
          'これまでの配信履歴は監査記録として残ります。',
          'この操作は取り消せません。',
        ].join(' ')}
        confirmLabel="このシナリオを削除する"
        destructive
        busy={deletingScenario}
        error={deleteScenarioError}
        onConfirm={() => void handleDeleteScenario()}
        onCancel={() => {
          if (deletingScenario) return
          setDeleteScenarioOpen(false)
          setDeleteScenarioError('')
        }}
      >
        {/* R250: 終了後の移動先にされていると、削除で参照元の設定が変わる。件数が取れたときだけ出す。 */}
        <div className="text-ink-secondary mt-3 space-y-2 text-sm">
          <MoveReferrersNotice scenarioId={id} />
        </div>
      </ConfirmDialog>

      {/* SCENARIO-09: 複製が途中で止まったときの、作りかけコピーの削除確認 */}
      <ConfirmDialog
        open={discardDuplicateOpen && duplicateRemainder !== null}
        title={duplicateRemainder ? `作りかけのコピー「${duplicateRemainder.copyName}」を削除しますか？` : ''}
        description={`複製が「${duplicateRemainder?.stage ?? ''}」の途中で止まったため、内容が欠けた状態で残っています。削除しても元のシナリオは変わりません。この操作は取り消せません。`}
        confirmLabel="作りかけのコピーを削除する"
        destructive
        busy={discardingDuplicate}
        error={discardDuplicateError}
        onConfirm={() => void handleDiscardDuplicate()}
        onCancel={() => {
          if (discardingDuplicate) return
          setDiscardDuplicateOpen(false)
          setDiscardDuplicateError('')
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
            if (res.success) await loadScenario(true)
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
            await loadScenario(true)
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
