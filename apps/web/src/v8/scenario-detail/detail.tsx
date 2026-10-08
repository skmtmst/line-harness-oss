'use client'

/*
 * ★V8 シナリオ配信の編集（src/v8 に一から組み直した版）。
 * 板：稼働中 `PMLkX`・始めた直後 `nMSiE`・停止中 `ARuZ4`・競合 `kz2B6`、
 * 窓：止める確認 `OPGU2`・複製 `Al4Ek`・開始の確認 `F1LK4e`。
 *
 * 動き（読み込み・保存・複製・削除・開始/停止・通の編集）は今までの
 * app/scenarios/detail/detail-v8.tsx から写した（src/v8 は @/app を読めない）。
 * 見た目だけを絵の寸法で組み直した：板の頭／中身（左＝3つの箱・数の帯・
 * 最後の1通の後・メッセージの行・通ごとの数・足すボタン、右＝選んだ通のスマホ）／
 * 下の帯（削除・キャンセル・複製する・保存する）。
 * 閲覧のみの人には、変える操作のボタンを置かない（オーナー決定 2026-10-06）。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { Fragment, useState, useEffect, useCallback, useRef } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  Eye,
  FilePlus2,
  GitBranch,
  GitCompareArrows,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import type { Scenario, ScenarioStep, ScenarioTriggerType, MessageType, DeliveryMode, Folder } from '@line-crm/shared'
import { api, ApiError, type ScenarioRuns, type ScenarioTriggerItem } from '@/lib/api'
import StickyBar from '@/components/shared/sticky-bar'
import LinePreview from '@/components/shared/line-preview'
import Dialog from '@/components/shared/dialog'
import VersionCompare from '@/components/shared/version-compare'
import { TextField, TextArea } from '@/components/shared/text-field'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { startChecklist } from './start-checklist'
import styles from './detail.module.css'
import { PageFrame } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import TargetMissing from '@/components/shared/target-missing'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import FlexPreviewComponent from '@/components/flex-preview'
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

/** 開始のきっかけ1件を、画面で読める1行にする（一覧 page.tsx と同じ言い方）。 */
function describeStartTrigger(trigger: ScenarioTriggerItem, tagName: string | null): string {
  if (trigger.kind === 'friend_add') return '友だち追加のとき'
  if (trigger.kind === 'tag_added') {
    return tagName ? `タグ「${tagName}」が付いたとき` : 'タグが付いたとき（タグ名を確認できません）'
  }
  if (trigger.kind === 'form_answer') return 'フォームに答えたとき'
  if (trigger.kind === 'booking_confirmed') return '予約が確定したとき'
  return '呼ばれたとき'
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
import { RowMenu } from '@/components/shared/row-actions'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { notifyToast } from '@/components/shared/toast'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import StatusChip from '@/components/shared/status-chip'
import Notice from '@/components/shared/notice'
import { browserDraftKey } from '@/v8/autosave/use-browser-draft'
import { BrowserDraftNotice, ScenarioDraftConflictNotice } from '@/v8/autosave/browser-draft-notice'
import { scenarioDraftKey, useScenarioDraft } from '@/v8/autosave/use-scenario-draft'
import Select from '@/components/shared/select'
import FolderSelect, { folderById, folderCreator } from '@/components/shared/folder-select'
import {
  scenarioReachBarWidth,
  scenarioReachCountLabel,
  scenarioReachPercent,
  scenarioReachPercentLabel,
} from './scenario-reach-display'
import { describeAfterSend, describeStepAudience, stepListTitle } from './scenario-step-audience'
import {
  scenarioSimulationKey,
  simulationForKey,
  type ScenarioSimulationResult,
} from './scenario-simulation-refresh'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { scenarioReferenceData } from '@/components/scenarios/scenario-reference-data'
import { formatDateTime, formatNumber } from '@/lib/format'
import InsertTextField, { type InsertTextFieldHandle } from '@/components/shared/insert-text-field'

type ScenarioWithSteps = Scenario & { steps: ScenarioStep[] }

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

/** 板の頭の説明の行に出す配信方式の名前（絵 PMLkX「配信方式：時刻で指定」）。 */
const MODE_LABEL: Record<DeliveryMode, string> = {
  relative: '従来の方式',
  elapsed: '経過時間で指定',
  absolute_time: '時刻で指定',
}

/** 「最後の1通の後」の行の値（絵 PMLkX・ARuZ4）。窓の選択肢名より、行として読める言い方にする。 */
const ON_COMPLETE_SENTENCE: Record<OnCompleteMode, string> = {
  pause: '何もしない（一時停止）',
  resume_previous: '1つ前のシナリオを再開する',
  move: '次のシナリオへ移す',
}

const jstParts = (iso: string | null | undefined) => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  return parts as Record<string, string>
}

/** ①の箱「保存済み 10月1日 14:02」。 */
function formatSavedAt(iso: string | null | undefined): string {
  const p = jstParts(iso)
  return p ? `${p.month}月${p.day}日 ${p.hour}:${p.minute}` : ''
}

/** 競合の帯「〇〇 が 14:02 に保存しました」。 */
function formatClock(iso: string | null | undefined): string {
  const p = jstParts(iso)
  return p ? `${p.hour}:${p.minute}` : '少し前'
}

/** 行の札。絵は「テキスト・カルーセル・質問・テンプレート」の短い名前。 */
function stepKindShort(
  step: { question?: unknown; messageType: string },
  templateName: string | null,
): string {
  if (templateName) return 'テンプレート'
  if (step.question) return '質問'
  return messageTypeOptions.find((o) => o.value === step.messageType)?.label ?? step.messageType
}

/** 行の題。テンプレートを使う通は本文の1行目に「（テンプレート「名前」）」を添える（絵 PMLkX の4通目）。 */
function stepRowTitle(step: { messageContent: string; question?: unknown }, templateName: string | null): string {
  if (!templateName) return stepListTitle(step, null)
  const bodyLine = (step.messageContent || '').split('\n')[0].slice(0, 60).trim()
  return bodyLine ? `${bodyLine}（テンプレート「${templateName}」）` : templateName
}

/**
 * 行の時刻。時刻指定は1通目だけ「購読開始から0日後 10:00」、2通目からは「1日後 20:00」（絵 PMLkX）。
 * ほかの方式は今までの言い方のまま。
 */
function stepWhenLabel(mode: DeliveryMode, step: ScenarioStep, index: number): string {
  if (mode !== 'absolute_time') return formatScheduleLabel(mode, step)
  if (!step.deliveryTime) return '時刻を入力してください'
  const days = step.offsetDays ?? 0
  return index === 0 ? `購読開始から${days}日後 ${step.deliveryTime}` : `${days}日後 ${step.deliveryTime}`
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

function FlexPreview({ content }: { content: string }) {
  return <FlexPreviewComponent content={content} maxWidth={300} />
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

  const [scenario, setScenario] = useState<ScenarioWithSteps | null>(null)
  /* ★V7: コンテンツ表の操作は「編集＋…」の1行に収める。…の中身は行ごとに開く。 */
  const [stepMenuId, setStepMenuId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 404・空で見つからないとき。取得の失敗（error）とは分ける。 */
  const [scenarioMissing, setScenarioMissing] = useState(false)
  /*
   * ★V8 `kz2B6`：ほかの人が先に保存したら帯で知らせる。
   * この画面は書き換えない（読み直すまで古い内容のまま）。
   * 名前・時刻は API に無いので出さない。
   */
  const [conflict, setConflict] = useState(false)
  const [conflictLatest, setConflictLatest] = useState<ScenarioWithSteps | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const shownUpdatedAtRef = useRef<string | null>(null)

  const [, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', triggerType: 'friend_add' as ScenarioTriggerType, isActive: true, allowConcurrent: true, folderId: '' })
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderState, setFolderState] = useState<'loading' | 'ready' | 'error'>('loading')
  const { selectedAccountId, accounts } = useAccount()

  /*
   * SCENARIO-20: フォルダはアカウント単位。無指定で全権限範囲を取ると、
   * 別アカウントの同名フォルダを選んで保存してしまう。シナリオの所属
   * アカウント（共通なら選択中のアカウント）の候補だけを出し、
   * アカウントが切り替わったら取り直す。候補を取り直せなかったときは
   * 「未分類」と決めつけず、いまは変更できない旨を示す。
   */
  const folderAccountId = scenario?.lineAccountId ?? selectedAccountId

  /*
   * 閲覧のみ（staff）：作る・保存・削除・止める/再開・複製・通の操作は
   * 押せない形で出す。役割が取れるまで null なので、そのあいだは
   * 今までどおり押せる見た目（最後の守りはサーバの 403）。
   */
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)
  const readonlyReason = '閲覧のみのため、この操作はできません'

  /* --- ★V8 だけの状態 --- */
  /** 右の欄のスマホに出す通。押した行が選ばれる。 */
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  /** 通ごとの「届く日時の例」。/preview の試算結果（stepOrder → 日時の文）。 */
  const [previewLabels, setPreviewLabels] = useState<Record<number, string>>({})
  /** 開始のきっかけの一覧（件数だけだと箱に名前を出せない）。 */
  const [triggerItems, setTriggerItems] = useState<ScenarioTriggerItem[] | null>(null)
  /* 配信を始める前の確認（★V8 `F1LK4e`）・止める確認（`OPGU2`）。 */
  const [startOpen, setStartOpen] = useState(false)
  const [startBusy, setStartBusy] = useState(false)
  const [startError, setStartError] = useState('')
  const [startConfirmed, setStartConfirmed] = useState(false)
  const [stopOpen, setStopOpen] = useState(false)
  const [stopBusy, setStopBusy] = useState(false)
  const [stopError, setStopError] = useState('')
  /* 複製の窓（★V8 `Al4Ek`：新しい名前を本人が決める）。 */
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [duplicateName, setDuplicateName] = useState('')
  /* 名前・説明・フォルダを変える窓（題の横の鉛筆）。 */
  const [renameOpen, setRenameOpen] = useState(false)
  /* 始めた直後の知らせ（`nMSiE`）。URL の started=1 か、この画面で始めたとき。 */
  const [justStarted, setJustStarted] = useState(showStarted)
  useEffect(() => {
    if (showStarted) setJustStarted(true)
  }, [showStarted])

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
  /* 保存ボタンの「✓ 保存しました」（★V8 サクサク感 B）。変えたら消す。 */
  const [saveDone, setSaveDone] = useState(false)

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
  /** 表の行で開いている1通ぶんのプレビュー。設計の「プレビュー」。 */
  /* ★V8: 行の「プレビュー」は右の欄のスマホに出すので、行内の展開は持たない。 */
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
  usePageTitle(editingStepId ? `${stepForm.stepOrder}通目を編集` : 'シナリオ配信')
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
  /** 通の入力欄を開いた回の番号。開くたびに「開いた直後の形」を比べる元として採り直す。 */
  const [stepFormNonce, setStepFormNonce] = useState(0)
  const [stepFormBaseline, setStepFormBaseline] = useState<{ nonce: number; value: { stepForm: StepFormState; kindState: MessageKindState } } | null>(null)
  /** 差し込みをカーソルの位置に入れるために、本文の入力欄を持つ。 */
  const stepBodyRef = useRef<InsertTextFieldHandle | HTMLTextAreaElement>(null)

  const [previewOpen, setPreviewOpen] = useState(false)

  const [stats, setStats] = useState<ScenarioStats | null>(null)
  /*
   * ★V8: 開始前の確認で試算が取れなかったときの「読み直す」。
   * simulationKey が同じままだと取り直しが走らないので、回数を足して
   * 強制的にもう一度取らせる。
   */
  const [simRetry, setSimRetry] = useState(0)
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
  const loadScenario = useCallback(async (fresh = false) => {
    setLoading(true)
    setError('')
    setScenarioMissing(false)
    try {
      const res = await scenarioReferenceData.scenario(id, fresh)
      if (res.success) {
        setScenario(res.data)
        // 今見せている版を覚える。ほかの人の更新は更新日時のずれで見つける。
        shownUpdatedAtRef.current = res.data.updatedAt ?? null
        setConflict(false)
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

  /*
   * ★V8 `kz2B6`：別のタブから戻ってきたら更新日時だけ確かめる。
   * ずれていたら帯を出すだけで、画面は書き換えない。
   */
  useEffect(() => {
    if (loading || !scenario) return
    const recheck = () => {
      if (document.visibilityState !== 'visible') return
      void (async () => {
        try {
          const detail = await api.scenarios.get(id)
          if (!detail.success) return
          const shown = shownUpdatedAtRef.current
          const latest = detail.data.updatedAt ?? null
          if (shown !== null && latest !== null && latest !== shown) {
            setConflict(true)
            setConflictLatest(detail.data)
          }
        } catch {
          // 取れなくても今の画面は残す。次の機会に確かめる。
        }
      })()
    }
    const onVisible = () => recheck()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', recheck)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', recheck)
    }
  }, [id, loading, scenario])

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
  }, [id, scenario?.lineAccountId, simulationKey, simRetry])

  useEffect(() => {
    if (!id) return
    api.scenarios.triggers
      .list(id)
      .then((res) => {
        if (res.success) {
          setTriggerCount(res.data.length)
          /* ★V8: 箱に「友だち追加のとき」など名前で出すので一覧も持つ。 */
          setTriggerItems(res.data)
        }
      })
      .catch(() => {})
  }, [id])

  /*
   * ★V8: 各通の「届く日時の例」（行の時刻の下の青い行）は /preview の
   * 試算から取る。取れなければ出さない（時刻の行だけになる）。
   */
  useEffect(() => {
    if (!id || !scenario) return
    let cancelled = false
    api.scenarios
      .preview(id)
      .then((res) => {
        if (cancelled || !res.success) return
        const map: Record<number, string> = {}
        for (const step of res.data.steps) map[step.stepOrder] = step.deliveryAtLabel
        setPreviewLabels(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, scenario?.updatedAt])

  const reloadStats = useCallback(() => {
    scenarioReferenceData.stats(id, true).then((r) => { if (r.success) setStats(r.data) }).catch(() => {})
  }, [id])

  /**
   * シナリオを丸ごと複製する。
   *
   * 似た流れをもう1本作るとき、通を1つずつ写すのは現実的でない。
   * 中身だけ写して、名前に「のコピー」を付け、止めた状態で作る。
   * 作った直後に配信が始まると、確かめる前に届いてしまう。
   */
  const handleDuplicate = async (name?: string) => {
    if (!scenario || duplicating) return
    setDuplicating(true)
    setError('')
    const copyName = (name?.trim() || `${scenario.name} のコピー`)
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
      setDuplicateOpen(false)
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
        setRenameOpen(false)
        setSaveDone(true)
        loadScenario(true)
      } else {
        setError(res.error)
      }
    } catch (caught) {
      /*
       * ★V8 kz2B6：ほかの人が先に保存していた（409）。入力は残し、帯で知らせて
       * 「違いを比べる」「最新を読み込んで続ける」を選んでもらう。
       */
      if (caught instanceof ApiError && caught.status === 409) {
        setConflict(true)
        try {
          const latest = await api.scenarios.get(id)
          if (latest.success) setConflictLatest(latest.data as ScenarioWithSteps)
        } catch {
          // 最新が取れなくても帯は出す。「最新を読み込んで続ける」で取り直せる。
        }
      } else {
        setError('保存に失敗しました。通信を確かめて、もう一度お試しください。')
      }
    } finally {
      setSaving(false)
    }
  }

  /*
   * ★V8 `kz2B6`「最新を読み込んで続ける」。最新で入力を置き換える。
   * 比べる文は設定の要約（名前・状態・通の数）で作る。
   */
  const acceptLatestAndContinue = async () => {
    setCompareOpen(false)
    setConflict(false)
    setConflictLatest(null)
    await loadScenario(true)
  }

  const describeScenarioSummary = (input: { name: string; isActive: boolean; stepCount: number }): string =>
    [
      `名前：${input.name || '（未入力）'}`,
      `状態：${input.isActive ? '稼働中' : '停止中'}`,
      `通の数：${input.stepCount}`,
    ].join('\n')

  const currentSummary = scenario
    ? describeScenarioSummary({ name: editForm.name, isActive: editForm.isActive, stepCount: scenario.steps.length })
    : ''
  const latestSummary = conflictLatest
    ? describeScenarioSummary({ name: conflictLatest.name, isActive: conflictLatest.isActive, stepCount: conflictLatest.steps.length })
    : ''

  /*
   * ★V8: 3 の箱の「配信を再開する」。開始前の確認（`F1LK4e`）で
   * 対象人数・送信枠を確かめてから動かす。試算は画面が常に持っている
   * simulation / runs をそのまま使う（確認窓で取り直さない）。
   */
  const handleStart = async () => {
    if (!scenario || startBusy) return
    setStartBusy(true)
    setStartError('')
    try {
      const res = await api.scenarios.update(id, { isActive: true })
      if (!res.success) {
        setStartError(res.error)
        return
      }
      setStartOpen(false)
      setJustStarted(true)
      notifyToast('配信を始めました')
      loadScenario(true)
      reloadStats()
    } catch {
      setStartError('配信を始められませんでした。通信を確かめて、もう一度お試しください。')
    } finally {
      setStartBusy(false)
    }
  }

  /*
   * ★V8: 3 の箱の「一時停止する」（`OPGU2` 止める確認）。
   * 止めても途中の人の記録は残る。板にある「止める理由」の欄は、
   * 受け口（保存先）が API に無いので置いていない
   * （design/v8/DEVIN-QUESTIONS.md 参照）。
   */
  const handleStop = async () => {
    if (!scenario || stopBusy) return
    setStopBusy(true)
    setStopError('')
    try {
      const res = await api.scenarios.update(id, { isActive: false })
      if (!res.success) {
        setStopError(res.error)
        return
      }
      setStopOpen(false)
      notifyToast('配信を一時停止しました')
      loadScenario(true)
      reloadStats()
    } catch {
      setStopError('配信を止められませんでした。通信を確かめて、もう一度お試しください。')
    } finally {
      setStopBusy(false)
    }
  }

  /* ★V8 `Al4Ek`：複製の窓を開く。名前は「のコピー」を下書きに持つ。 */
  const openDuplicateDialog = () => {
    if (!scenario) return
    setDuplicateName(`${scenario.name} のコピー`)
    setDuplicateOpen(true)
  }

  /** 題の横の鉛筆。フォームへ今の値を戻してから開く。 */
  const openRenameDialog = () => {
    if (!scenario) return
    setEditForm({
      name: scenario.name,
      description: scenario.description ?? '',
      triggerType: scenario.triggerType,
      isActive: scenario.isActive,
      allowConcurrent: scenario.allowConcurrent !== false,
      folderId: scenario.folderId ?? '',
    })
    setRenameOpen(true)
  }

  /*
   * 追従バーの「保存する」が何かを持つのは、鉛筆の窓で名前などが
   * 変わっているときだけ。差分を見て押せる/押せないを決める。
   */
  const editDirty = Boolean(
    scenario &&
      (editForm.name !== scenario.name ||
        editForm.description !== (scenario.description ?? '') ||
        editForm.folderId !== (scenario.folderId ?? '') ||
        editForm.allowConcurrent !== (scenario.allowConcurrent !== false)),
  )

  useEffect(() => {
    if (editDirty) setSaveDone(false)
  }, [editDirty])

  /*
   * 追従バーに「未保存の変更があります」と出ている間（鉛筆の窓で変えた名前・説明・フォルダ・
   * 同時配信）は、左メニューなどで画面を離れる前に確かめる。保存すると印が消えて番兵も外れる。
   */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: editDirty, busy: saving })

  /** 追従バーの「キャンセル」。未保存があれば戻し、なければ一覧へ。 */
  const handleCancel = () => {
    if (scenario && editDirty) {
      setEditForm({
        name: scenario.name,
        description: scenario.description ?? '',
        triggerType: scenario.triggerType,
        isActive: scenario.isActive,
        allowConcurrent: scenario.allowConcurrent !== false,
        folderId: scenario.folderId ?? '',
      })
      return
    }
    router.push('/scenarios')
  }

  const openAddStep = () => {
    const nextOrder = nextStepOrder(scenario?.steps ?? [])
    setStepForm(emptyStepForm(nextOrder))
    setEditingStepId(null)
    setShowStepForm(true)
    setInsertAfter(null)
    setStepError('')
    setStepFormNonce((n) => n + 1)
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
    setStepFormNonce((n) => n + 1)
  }

  const openAddTemplateStep = () => {
    const nextOrder = nextStepOrder(scenario?.steps ?? [])
    setStepForm({ ...emptyStepForm(nextOrder), inputMode: 'template' })
    setEditingStepId(null)
    setShowStepForm(true)
    setInsertAfter(null)
    setStepError('')
    setStepFormNonce((n) => n + 1)
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
    setStepFormNonce((n) => n + 1)
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
    setStepFormNonce((n) => n + 1)
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
      stepDraft.clear()
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

  /*
   * 通の保存は配信の行へ直に入る（下書きの口が無い）。書きかけの通はこのブラウザに
   * だけ残し、同じ通を開き直したときに「前の入力を戻す」を出す。キャンセルで捨てる。
   */
  const stepFormOpen = showStepForm || editingStepId !== null
  const stepFormValue = { stepForm, kindState }
  useEffect(() => {
    if (!stepFormOpen) {
      if (stepFormBaseline !== null) setStepFormBaseline(null)
      return
    }
    if (stepFormBaseline?.nonce !== stepFormNonce) setStepFormBaseline({ nonce: stepFormNonce, value: stepFormValue })
    // 開いた直後の形だけを採る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFormOpen, stepFormNonce, stepFormBaseline])
  // 書きかけはシナリオの下書きの口（本物の通とは別の行・配信に使わない）へ残す。
  const stepDraft = useScenarioDraft({
    accountId: scenario?.lineAccountId ?? selectedAccountId,
    draftKey: stepFormOpen && scenario && stepFormBaseline?.nonce === stepFormNonce
      ? scenarioDraftKey(id, { stepId: editingStepId })
      : null,
    // 共通（アカウントなし）のシナリオは本物に紐づけられないので、キーだけで置く。
    scenarioId: scenario?.lineAccountId ? id : null,
    stepId: scenario?.lineAccountId ? editingStepId : null,
    legacyKey: scenario ? browserDraftKey(['scenario-step', scenario.lineAccountId, id, editingStepId ?? 'new']) : null,
    value: stepFormValue,
    baseline: stepFormBaseline?.value ?? stepFormValue,
    active: canEdit,
  })
  const restoreStepDraft = () => {
    const stored = stepDraft.restore()
    if (stored) applyStepDraft(stored)
  }
  const loadLatestStepDraft = () => {
    const latest = stepDraft.loadLatest()
    if (latest) applyStepDraft(latest)
  }
  function applyStepDraft(stored: typeof stepFormValue) {
    // 新しく足す通の番号は今の並びで決める（残っていた番号は古いことがある）。
    setStepForm(editingStepId ? stored.stepForm : { ...stored.stepForm, stepOrder: stepForm.stepOrder })
    setKindState(stored.kindState)
  }

  // 新規追加（上部）とステップ編集（行直下インライン）の両方で使うフォーム。
  // 同時に開くのは常に片方だけなので、state は stepForm を共有する。
  const renderStepForm = () => (
    <div className={editingStepId ? '' : 'border-hairline rounded-card bg-canvas-sunken border p-4'}>
      {!editingStepId && (
        <h4 className="text-sm font-semibold text-ink-secondary mb-3">新しいステップを追加</h4>
      )}
      <BrowserDraftNotice ago={stepDraft.pendingAgo} onRestore={restoreStepDraft} onDiscard={stepDraft.clear} />
      <ScenarioDraftConflictNotice ago={stepDraft.conflictAgo} onLoadLatest={loadLatestStepDraft} onOverwrite={stepDraft.overwrite} />
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
              { value: 'pause', label: '送信後：ここで止める' },
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
                <InsertTextField
                  ref={stepBodyRef}
                  className="w-full border-hairline rounded-control bg-canvas text-ink resize-none border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  rows={4}
                  placeholder="メッセージ内容を入力..."
                  value={stepForm.messageContent}
                  onValueChange={(next) => setStepForm({ ...stepForm, messageContent: next })}
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
          <Button variant="primary" onClick={handleSaveStep} disabled={stepSaving} busy={stepSaving}>
            {editingStepId ? '更新' : '追加する'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              stepDraft.clear()
              closeStepForm()
            }}
          >
            キャンセル
          </Button>
          {stepDraft.label ? <p className="text-ink-secondary self-center text-xs" aria-live="polite" data-autosave-status>{stepDraft.label}</p> : null}
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

  /* ===== ここから下は ★V8 の描画（PMLkX 稼働中 / nMSiE 始めた直後 / ARuZ4 停止中） ===== */

  if (loading) {
    return (
      <div className={styles.board}>
        <DelayedSkeleton
          loading
          skeleton={
            <div className="flex flex-col gap-4">
              <Skeleton className="block h-4 w-24" />
              <Skeleton className="block h-8 w-1/3" />
              <Skeleton className="block h-24 w-full" />
              <Skeleton className="block h-14 w-full" />
              <Skeleton className="block h-14 w-full" />
            </div>
          }
        />
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
  const modeLabel = MODE_LABEL[deliveryMode]

  /*
   * 右の欄のスマホに出す通。何も選んでいなければ先頭の通。
   * 通の削除などで selectedStepId が残っていても、無ければ先頭に戻す。
   */
  const shownStepId = sortedSteps.some((s) => s.id === selectedStepId)
    ? selectedStepId
    : (sortedSteps[0]?.id ?? null)
  const shownStep = sortedSteps.find((s) => s.id === shownStepId) ?? null
  const shownTpl = shownStep?.templateId
    ? templates.find((t) => t.id === shownStep.templateId) ?? null
    : null

  /*
   * ②の箱の大きい字。TriggerEditor ではなく「開始のきっかけ」の実一覧
   * （triggerItems）から名前を組み立てる。取れなければ「確認中…」、
   * 0件なら「呼ばれたときだけ」（アクション・手動での開始）。
   */
  const tagNameById = Object.fromEntries(tags.map((t) => [t.id, t.name]))
  const triggerHeadline =
    triggerItems === null
      ? '確認中…'
      : triggerItems.length === 0
        ? '呼ばれたときだけ'
        : triggerItems
            .map((t) => describeStartTrigger(t, t.tagId ? tagNameById[t.tagId] ?? null : null))
            .join('、')
  const audienceConditionLabel = describeCondition(
    (scenario.audienceCondition as SegmentCondition | null) ?? null,
  )

  /*
   * ③の箱の補足「最後：2026-11-05 12:00 まで予約あり」。いま購読中の人の
   * 次の配信予定のうち、いちばん遅いものを「最後」として出す。
   * nextDeliveryAt を持つ人がいなければ「予約はありません」。
   */
  const lastPlannedDelivery = (runs?.subscriptions ?? [])
    .map((s) => s.nextDeliveryAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1) ?? null

  /*
   * 開始前の確認（F1LK4e）の中身。画面が常に持っている試算・運用記録・
   * きっかけ一覧をそのまま使う（窓のために取り直さない）。
   * preflight が動いているあいだは「確認中」、両方取れないときは
   * 「試算できません」として開始ボタンを止める（SCENARIO-07 と同じ判断）。
   */
  const preflightLoading = simulationRefreshing || (simulation === null && runs === null && !scenario.lineAccountId)
  const preflightFailed = !simulationRefreshing && simulation === null && runs === null
  const startChecks = startChecklist({ ...scenario, stepCount: sortedSteps.length }).map((item, index) => {
    if (index === 1 && simulation) {
      const complete = simulation.steps.length > 0
      return {
        ...item,
        state: complete ? ('ok' as const) : ('warn' as const),
        detail: complete
          ? `${simulation.steps.length}通すべての配信日時を試算しました`
          : '配信日時を試算できない通があります',
      }
    }
    if (index === 2 && runs) {
      return {
        ...item,
        state: runs.testSends.length > 0 ? ('ok' as const) : ('warn' as const),
        detail:
          runs.testSends.length > 0
            ? `最新のテスト送信は${runs.testSends[0].messageCount}通です`
            : 'テスト送信の記録がありません',
      }
    }
    if (index === 3 && runs) {
      const enough =
        runs.quota.remaining === null
          ? runs.quota.state === 'unlimited'
          : runs.quota.remaining >= (simulation?.audience.newStartPlanned ?? 0)
      return {
        ...item,
        state: enough ? ('ok' as const) : ('warn' as const),
        detail:
          runs.quota.state === 'unlimited'
            ? '送信数の上限はありません'
            : runs.quota.remaining === null
              ? (runs.quota.reason ?? '送信枠を読み込めませんでした')
              : `残り${formatNumber(runs.quota.remaining)}通です`,
      }
    }
    return item
  })
  const startAccountLabel =
    scenario.lineAccountId === null
      ? '全アカウント共通'
      : (accounts.find((a) => a.id === scenario.lineAccountId)?.name ?? '—（名前を読み込めません）')
  const startCompleteSummary = ON_COMPLETE_LABEL[(scenario.onCompleteMode ?? 'pause') as OnCompleteMode]

  return (
    <PageFrame kind="detail" boardId={conflict ? 'kz2B6' : scenario.isActive ? 'PMLkX' : 'ARuZ4'} hasFooter>
      {/* 板の頭：戻る・題＋状態の札＋鉛筆・説明の1行。右に操作（配信結果・下見・まとめてテスト・その他）。 */}
      <header className={styles.head} data-design="Head">
        <div className={styles.headText}>
          <Link href="/scenarios" className={styles.back}>
            ← シナリオ配信へ
          </Link>
          <div className={styles.titleRow}>
            <h1 className={styles.title} title={scenario.name}>{scenario.name}</h1>
            <StatusChip status={scenario.isActive ? 'running' : 'paused'} />
            {canEdit ? (
              <button
                type="button"
                className={styles.iconButton}
                onClick={openRenameDialog}
                title="名前・説明・置き場を変える"
                aria-label="名前・説明・置き場を変える"
              >
                <Pencil aria-hidden />
              </button>
            ) : null}
          </div>
          <p className={styles.meta}>
            {`フォルダ：${scenarioFolderName}・配信方式：${modeLabel}（作ったあとは変えられません）・${(scenario.allowConcurrent ?? true) ? '同時購読を許可中' : '同時に1つだけ'}`}
          </p>
        </div>
        <div className={styles.headActions}>
          <Button variant="secondary" href={`/scenarios/results?id=${id}`}>
            <BarChart3 aria-hidden />
            配信結果を見る
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPreviewOpen(true)}
            disabled={sortedSteps.length === 0}
            title={sortedSteps.length === 0 ? '配る内容がまだありません' : undefined}
          >
            <Eye aria-hidden />
            まとめて下見
          </Button>
          {canEdit ? (
            <Button
              variant="secondary"
              onClick={() => setTestSend({ stepId: null, label: 'すべての通' })}
              disabled={sortedSteps.length === 0}
              title={sortedSteps.length === 0 ? '配る内容がまだありません' : undefined}
            >
              <Send aria-hidden />
              まとめてテストを送る
            </Button>
          ) : null}
          {canEdit ? (
            <span className={styles.menuBox}>
              <RowMenu
                appearance="plain"
                label="このシナリオのその他操作"
                menuLabel="このシナリオの操作"
                open={stepMenuId === '__head__'}
                onOpenChange={(next) => setStepMenuId(next ? '__head__' : null)}
                items={[
                  {
                    id: 'duplicate',
                    /* 下の帯の「複製する」と同じ窓を開く。文言を変えるのは、撮影・試験が下の帯のボタンと取り違えないため。 */
                    label: duplicating ? '複製中…' : 'このシナリオを複製',
                    disabled: duplicating,
                    onSelect: openDuplicateDialog,
                  },
                  {
                    id: 'delete',
                    label: 'このシナリオを削除',
                    tone: 'danger' as const,
                    dividerBefore: true,
                    onSelect: () => {
                      setDeleteScenarioError('')
                      setDeleteScenarioOpen(true)
                    },
                  },
                ]}
              />
            </span>
          ) : null}
        </div>
      </header>

      {/* 競合（kz2B6）：ほかの人の保存と食い違った。板の頭のすぐ下に、幅いっぱいで出す。 */}
      {conflict && (
        <div className={styles.conflictWrap}>
          <div className={styles.conflictBar} data-design-node="kz2B6" role="alert">
            <CircleAlert className={styles.conflictIcon} aria-hidden />
            <div className={styles.conflictText}>
              <p className={styles.conflictTitle}>
                {conflictLatest
                  ? `ほかの人が ${formatClock(conflictLatest.updatedAt)} にシナリオ「${conflictLatest.name}」を保存しました`
                  : 'ほかの人がこのシナリオを保存しました'}
              </p>
              <p className={styles.conflictBody}>
                あなたが直した所はまだ保存されていません。このまま保存すると、ほかの人の変更が消えます。
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={() => setCompareOpen(true)} disabled={!conflictLatest}>
              <GitCompareArrows aria-hidden />
              違いを比べる
            </Button>
            <Button type="button" variant="primary" onClick={() => void acceptLatestAndContinue()}>
              <RefreshCw aria-hidden />
              最新を読み込んで続ける
            </Button>
          </div>
        </div>
      )}

      <div className={styles.body} data-design="Body">
        <div className={styles.left}>
          {!canEdit ? (
            <div className={styles.viewerBand} role="status">
              <Eye aria-hidden />
              <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
            </div>
          ) : null}

          {/* 始めた直後の知らせ（nMSiE）。始めた記録への行き先を添える。 */}
          {justStarted && (
            <div className={styles.startedBand} role="status">
              <CircleCheck aria-hidden />
              <span className={styles.startedText}>
                {`配信を始めました。予約中の ${formatNumber(stats?.activeNow ?? simulation?.audience.newStartPlanned ?? 0)} 人へ、条件を満たした人から順に送ります`}
              </span>
              <Link href={`/scenarios/results?id=${id}`} className={styles.startedLink}>
                始めた記録を見る
              </Link>
            </div>
          )}

          {error ? <Notice tone="danger" message={error} /> : null}

          {/* 複製が途中で止まって残った作りかけの知らせ（SCENARIO-09）。 */}
          {duplicateRemainder && (
            <div className={styles.remainderBand}>
              <p>前回の複製が途中で止まり、作りかけのコピーが残っています</p>
              <p className={styles.remainderDetail}>
                「{duplicateRemainder.copyName}」は{duplicateRemainder.stage}の途中で止まりました。
                続きからやり直すか、作りかけのコピーを削除してください。
              </p>
              <div className={styles.remainderActions}>
                <button type="button" disabled={duplicating} onClick={() => void handleDuplicate()}>
                  {duplicating ? '複製中…' : '続きからやり直す'}
                </button>
                <Link href={`/scenarios/detail?id=${duplicateRemainder.copyId}`}>コピーを確認する</Link>
                <button
                  type="button"
                  className={styles.dangerLink}
                  disabled={discardingDuplicate}
                  onClick={() => {
                    setDiscardDuplicateError('')
                    setDiscardDuplicateOpen(true)
                  }}
                >
                  作りかけのコピーを削除する
                </button>
              </div>
            </div>
          )}

          {/* 上の3つの箱：保存・開始のきっかけ・配信。ボタンは箱の下にそろう。 */}
          <div className={styles.stageCards}>
            <section className={styles.stageCard}>
              <p className={styles.stageHead}>
                <span className={styles.stageNum} aria-hidden>1</span>
                <span className={styles.stageTitle}>保存</span>
              </p>
              <p className={styles.stageMain}>
                {editDirty ? '未保存の変更があります' : `保存済み ${formatSavedAt(scenario.updatedAt)}`}
              </p>
              <p className={styles.stageNote}>保存しただけでは誰にも届きません</p>
            </section>

            <section className={styles.stageCard}>
              <p className={styles.stageHead}>
                <span className={styles.stageNum} aria-hidden>2</span>
                <span className={styles.stageTitle}>開始のきっかけ</span>
              </p>
              <p className={styles.stageMain}>{triggerHeadline}</p>
              <p className={styles.stageNote}>{`対象：${audienceConditionLabel}。きっかけが来た人から始まります`}</p>
              {canEdit ? (
                <div className={styles.stageAction}>
                  <Button variant="secondary" onClick={() => setTriggerOpen(true)}>
                    <SlidersHorizontal aria-hidden />
                    設定を変える
                  </Button>
                </div>
              ) : null}
            </section>

            <section className={styles.stageCard}>
              <p className={styles.stageHead}>
                <span className={styles.stageNum} aria-hidden>3</span>
                <span className={styles.stageTitle}>配信</span>
              </p>
              <div className={styles.stageState}>
                <StatusChip status={scenario.isActive ? 'running' : 'paused'} />
                <span className={styles.stageStateText}>{scenario.isActive ? '送っています' : '止めています'}</span>
              </div>
              <p className={styles.stageNote}>
                {scenario.isActive ? '止めても、途中の人の記録は残ります' : '再開すると、止めたところから続きを送ります'}
              </p>
              {canEdit ? (
                <div className={styles.stageAction}>
                  {scenario.isActive ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setStopError('')
                        setStopOpen(true)
                      }}
                    >
                      <Pause aria-hidden />
                      一時停止する
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() => {
                        setStartError('')
                        setStartConfirmed(false)
                        setStartOpen(true)
                      }}
                      disabled={sortedSteps.length === 0}
                      title={sortedSteps.length === 0 ? '配る内容がまだありません' : undefined}
                    >
                      <Play aria-hidden />
                      配信を再開する
                    </Button>
                  )}
                </div>
              ) : null}
            </section>
          </div>

          {/* 数の帯：購読中・読み終えた・始まる見込み・離脱が多い所。 */}
          <div className={styles.kpis} data-design="KPIs">
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>購読中</p>
              <p className={styles.kpiValue}>
                <span className={styles.kpiNum}>{stats ? formatNumber(stats.activeNow) : '—'}</span>
                <span className={styles.kpiUnit}>人</span>
              </p>
              <p className={styles.kpiDetail}>いま途中にいる人</p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>読み終えた</p>
              <p className={styles.kpiValue}>
                <span className={styles.kpiNum}>{stats ? formatNumber(stats.completed) : '—'}</span>
                <span className={styles.kpiUnit}>人</span>
              </p>
              <p className={styles.kpiDetail}>最後の1通まで届いた人</p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>始まる見込み（試算）</p>
              <p className={styles.kpiValue}>
                <span className={styles.kpiNum}>
                  {simulation ? formatNumber(simulation.audience.newStartPlanned) : '—'}
                </span>
                <span className={styles.kpiUnit}>人</span>
              </p>
              <p className={styles.kpiDetail}>きっかけが来たら始まる見込み。確定ではない</p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>離脱が多い所</p>
              <p className={styles.kpiValue}>
                <span className={styles.kpiNumWide}>
                  {biggestDrop ? `${biggestDrop.fromOrder}→${biggestDrop.toOrder}通目` : '—'}
                </span>
              </p>
              <p className={styles.kpiDetail}>
                {biggestDrop
                  ? `${biggestDrop.fromOrder}通目で ${formatNumber(biggestDrop.lost)}人（${Math.round(biggestDrop.rate * 100)}%）が離れています`
                  : '大きく離れている所はまだありません'}
              </p>
            </div>
          </div>

          {/* 最後の1通の後（行）。変える入口はこの行の右。 */}
          <div className={styles.onComplete}>
            <p className={styles.onCompleteLabel}>最後の1通の後</p>
            <p className={styles.onCompleteValue}>
              {ON_COMPLETE_SENTENCE[(scenario.onCompleteMode ?? 'pause') as OnCompleteMode]}
            </p>
            <p className={styles.onCompleteNote}>読み終えた人を次のシナリオへ送ることもできます</p>
            {canEdit ? (
              <Button variant="text" onClick={() => setOnCompleteOpen(true)}>
                <Pencil aria-hidden />
                変える
              </Button>
            ) : null}
          </div>

          {/* メッセージの行。選んだ通が右の欄に出る。 */}
          <h2 className={styles.sectionTitle}>{`メッセージ（${sortedSteps.length}通）`}</h2>
          {sortedSteps.length === 0 ? (
            <p className={styles.emptyNote}>
              まだ配るものがありません。下の「メッセージを追加する」から1通目を作ってください。
            </p>
          ) : (
            <ol className={styles.stepList}>
              {sortedSteps.map((step, index) => {
                const tpl = step.templateId
                  ? templates.find((t) => t.id === step.templateId) ?? null
                  : null
                const kindLabel = stepKindShort(step, tpl?.name ?? null)
                const title = stepRowTitle(step, tpl?.name ?? null)
                const isShown = step.id === shownStepId
                return (
                  <Fragment key={step.id}>
                    {index > 0 && (
                      <li className={styles.insertRow}>
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => openInsertStep(sortedSteps[index - 1].stepOrder)}
                            title={`${sortedSteps[index - 1].stepOrder}通目と${step.stepOrder}通目のあいだに足します`}
                          >
                            ＋ ここに挿入
                          </button>
                        ) : (
                          <span className={styles.insertSpacer} aria-hidden />
                        )}
                      </li>
                    )}
                    <li
                      className={isShown ? styles.stepRowSelected : styles.stepRow}
                      onClick={() => setSelectedStepId(step.id)}
                    >
                      <span className={styles.stepNo}>{`${step.stepOrder}通目`}</span>
                      <span className={styles.stepWhen}>
                        <span className={styles.stepWhenMain}>{stepWhenLabel(deliveryMode, step, index)}</span>
                        {previewLabels[step.stepOrder] ? (
                          <span className={styles.stepWhenSub}>{previewLabels[step.stepOrder]}</span>
                        ) : null}
                      </span>
                      {canEdit ? (
                        <button
                          type="button"
                          className={styles.stepTitle}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (editingStepId === step.id) {
                              closeStepForm()
                            } else {
                              openEditStep(step)
                            }
                          }}
                          title="この通を編集する"
                        >
                          {title}
                        </button>
                      ) : (
                        <span className={styles.stepTitle}>{title}</span>
                      )}
                      {step.isDraft === true && <StatusChip status="draft" />}
                      <span className={styles.kindChip}>{kindLabel}</span>
                      {canEdit ? (
                        <span className={styles.stepOps}>
                          <button
                            type="button"
                            className={styles.iconButton}
                            aria-label={`${step.stepOrder}通目を上へ`}
                            disabled={index === 0}
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleMoveStep(step.id, 'up')
                            }}
                          >
                            <ArrowUp aria-hidden />
                          </button>
                          <button
                            type="button"
                            className={styles.iconButton}
                            aria-label={`${step.stepOrder}通目を下へ`}
                            disabled={index === sortedSteps.length - 1}
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleMoveStep(step.id, 'down')
                            }}
                          >
                            <ArrowDown aria-hidden />
                          </button>
                          <span className={styles.menuBox} onClick={(e) => e.stopPropagation()}>
                            <RowMenu
                              appearance="plain"
                              label={`${step.stepOrder}通目のその他操作`}
                              menuLabel={`${step.stepOrder}通目の操作`}
                              open={stepMenuId === step.id}
                              onOpenChange={(next) => setStepMenuId(next ? step.id : null)}
                              items={[
                                { id: 'edit', label: '編集', onSelect: () => openEditStep(step) },
                                { id: 'preview', label: 'プレビュー', onSelect: () => setSelectedStepId(step.id) },
                                {
                                  id: 'test',
                                  label: 'テスト',
                                  onSelect: () => setTestSend({ stepId: step.id, label: `${step.stepOrder}通目` }),
                                },
                                /* この通を送ったあとに動かすアクション。件数を出すのは、設定済みを忘れて二重に足すのを防ぐため。 */
                                {
                                  id: 'action',
                                  label: `アクション${actionCounts[step.id] ? ` ${actionCounts[step.id]}` : ''}`,
                                  onSelect: () =>
                                    setActionTarget({
                                      hook: 'step_sent',
                                      stepId: step.id,
                                      choiceIndex: null,
                                      title: `${step.stepOrder}通目を送ったあと`,
                                    }),
                                },
                                {
                                  id: 'duplicate',
                                  label: duplicatingStepId === step.id ? '複製中…' : 'この通を複製',
                                  disabled: duplicatingStepId === step.id,
                                  disabledReason: 'この通を複製しています',
                                  onSelect: () => {
                                    void handleDuplicateStep(step)
                                  },
                                },
                                {
                                  id: 'delete',
                                  label: 'この通を削除',
                                  tone: 'danger' as const,
                                  dividerBefore: true,
                                  onSelect: () => {
                                    setDeleteStepError('')
                                    setDeleteStepTarget(step)
                                  },
                                },
                              ]}
                            />
                          </span>
                        </span>
                      ) : null}
                    </li>
                    {editingStepId === step.id && <li className={styles.stepEdit}>{renderStepForm()}</li>}
                  </Fragment>
                )
              })}
            </ol>
          )}
          {/* 新規に足すときのフォーム（編集中の行の下ではなく、追加用）。 */}
          {showStepForm && <div className={styles.stepEdit}>{renderStepForm()}</div>}

          {/* 通ごとの数：配信対象・届いた数・配信後。行を見比べられるようにする。 */}
          {sortedSteps.length > 0 && (
            <section className={styles.statPanel}>
              <h2 className={styles.statPanelTitle}>通ごとの数</h2>
              <ol className={styles.statList}>
                {sortedSteps.map((step) => {
                  const stat = stats?.steps.find((v) => v.stepOrder === step.stepOrder)
                  const pct = scenarioReachPercent(stat?.reachRate)
                  const reachBarWidth = scenarioReachBarWidth(pct)
                  const after = describeAfterSend(step.afterSend)
                  const reachTag = step.onReachTagId
                    ? tags.find((t) => t.id === step.onReachTagId)?.name ?? null
                    : null
                  const audience = describeStepAudience(step.targetCondition, tags)
                  return (
                    <li key={step.id} className={styles.statRow}>
                      <span className={styles.statNo}>{`${step.stepOrder}通目`}</span>
                      <span className={styles.statAudience} title={audience}>
                        {audience}
                      </span>
                      <span className={styles.statBarCell}>
                        {step.isDraft === true ? (
                          <StatusChip status="draft" />
                        ) : (
                          <span className={styles.statBar} aria-hidden>
                            <span className={styles.statBarFill} style={{ width: `${reachBarWidth}%` }} />
                          </span>
                        )}
                      </span>
                      <span className={styles.statReachText}>
                        {step.isDraft === true || !stat
                          ? '—'
                          : `到達 ${scenarioReachCountLabel(stat.reachedCount)}${pct !== null ? `・${scenarioReachPercentLabel(pct)}` : ''}`}
                      </span>
                      <span className={after.paused && !reachTag ? styles.statAfterPause : styles.statAfter}>
                        {reachTag ? `到達タグ：${reachTag}` : after.label}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </section>
          )}

          {/* 行の下の文字ボタン 3 つ。押すと追加フォームが開く。閲覧のみには置かない。 */}
          {canEdit ? (
            <div className={styles.addRow}>
              <Button variant="text" onClick={openAddStep}>
                <Plus aria-hidden />
                メッセージを追加する
              </Button>
              <Button variant="text" onClick={openAddTemplateStep}>
                <FilePlus2 aria-hidden />
                テンプレートを追加する
              </Button>
              <Button
                variant="text"
                onClick={openAddQuestionStep}
                title="質問メッセージを足します。選択肢ごとにタグ・友だち情報・シナリオを動かせます"
              >
                <GitBranch aria-hidden />
                分岐を追加する
              </Button>
            </div>
          ) : null}
        </div>

        {/* 右の欄：選んだ通のスマホ。 */}
        <aside className={styles.right}>
          <h2 className={styles.rightTitle}>
            {`選んだ通（${shownStep ? `${shownStep.stepOrder}通目` : '—'}）の見え方`}
          </h2>
          <div className={styles.phoneSlot}>
            <LinePreview
              accountName={startAccountLabel === '全アカウント共通' ? '公式アカウント' : startAccountLabel}
              caption={
                shownStep
                  ? previewLabels[shownStep.stepOrder] ?? formatScheduleLabel(deliveryMode, shownStep)
                  : undefined
              }
              empty={shownStep ? false : '配る内容がまだありません'}
            >
              {shownStep
                ? (() => {
                    const t = shownTpl ? shownTpl.messageType : shownStep.messageType
                    const c = shownTpl ? shownTpl.messageContent : shownStep.messageContent
                    if (t === 'flex') return <FlexPreview content={c} />
                    if (t === 'image') {
                      try {
                        const parsed = JSON.parse(c)
                        const url = parsed.previewImageUrl || parsed.originalContentUrl
                        return url ? (
                          <img src={url} alt="配信画像の見え方" className={styles.talkImage} />
                        ) : (
                          <p className={styles.talkBubble}>画像（プレビューなし）</p>
                        )
                      } catch {
                        return <p className={styles.talkBubble}>画像</p>
                      }
                    }
                    if (shownStep.question) {
                      const q = shownStep.question as { text?: string; choices?: { label?: string }[] }
                      return (
                        <div className={styles.talkBubble}>
                          {q.text ?? shownStep.messageContent}
                          {(q.choices ?? []).map((choice, i) => (
                            <span key={i} className={styles.talkChoice}>
                              {choice.label ?? `選択肢${i + 1}`}
                            </span>
                          ))}
                        </div>
                      )
                    }
                    return <div className={styles.talkBubble}>{c}</div>
                  })()
                : null}
            </LinePreview>
          </div>
        </aside>
      </div>

      {/* 下の帯（追従・常に画面の下）：左端に削除、中央に「キャンセル・複製する・保存する」。 */}
      <div className={styles.footer}>
        <StickyBar
          destructive={
            canEdit ? (
              <Button
                variant="danger"
                onClick={() => {
                  setDeleteScenarioError('')
                  setDeleteScenarioOpen(true)
                }}
              >
                このシナリオを削除する
              </Button>
            ) : undefined
          }
          actions={
            <>
              <Button variant="secondary" onClick={handleCancel} disabled={saving}>
                キャンセル
              </Button>
              {canEdit ? (
                <Button variant="secondary" onClick={openDuplicateDialog} disabled={duplicating}>
                  <Copy aria-hidden />
                  複製する
                </Button>
              ) : null}
              {canEdit ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    if (conflict) {
                      setCompareOpen(true)
                    } else {
                      void handleSaveScenario()
                    }
                  }}
                  disabled={saving || !editForm.name.trim()}
                  busy={saving}
                  done={saveDone}
                >
                  {conflict ? <GitCompareArrows aria-hidden /> : <Check aria-hidden />}
                  {conflict ? '比べてから保存' : '保存する'}
                </Button>
              ) : null}
            </>
          }
        />
      </div>

      {/* 名前・説明・置き場を変える鉛筆の小窓。 */}
      <Dialog
        open={renameOpen}
        busy={saving}
        title="名前・説明・置き場を変える"
        description="ここで変えた内容は、下の「保存する」で確定します。"
        onCancel={() => {
          if (scenario) {
            setEditForm({
              name: scenario.name,
              description: scenario.description ?? '',
              triggerType: scenario.triggerType,
              isActive: scenario.isActive,
              allowConcurrent: scenario.allowConcurrent !== false,
              folderId: scenario.folderId ?? '',
            })
          }
          setRenameOpen(false)
        }}
        footer={
          <>
            <Button
              disabled={saving}
              onClick={() => {
                if (scenario) {
                  setEditForm({
                    name: scenario.name,
                    description: scenario.description ?? '',
                    triggerType: scenario.triggerType,
                    isActive: scenario.isActive,
                    allowConcurrent: scenario.allowConcurrent !== false,
                    folderId: scenario.folderId ?? '',
                  })
                }
                setRenameOpen(false)
              }}
            >
              閉じる
            </Button>
            <Button variant="primary" onClick={() => void handleSaveScenario()} disabled={!editForm.name.trim() || saving} busy={saving}>
              この内容で保存する
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-xs font-medium">シナリオ名</span>
            <TextField
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              maxLength={80}
              required
              aria-label="シナリオ名"
            />
          </label>
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-xs font-medium">説明（任意）</span>
            <TextArea
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              rows={3}
              maxLength={500}
              aria-label="説明"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-ink-secondary text-xs font-semibold">置き場（フォルダ）</span>
            <FolderSelect
              value={editForm.folderId}
              onChange={(value) => setEditForm({ ...editForm, folderId: value })}
              aria-label="置き場（フォルダ）"
              folders={folders.map(folderById)}
              // 一覧の左の列の「フォルダを追加」と同じ口（シナリオのフォルダは共有）。
              onCreate={canEdit
                ? folderCreator((name, color) => api.folders.create({ kind: 'scenario', name, color }), folderById, (created) => setFolders((current) => [...current, created]))
                : undefined}
            />
            {folderState === 'error' && (
              <p className="text-status-danger text-xs">フォルダ一覧を読み込めませんでした。</p>
            )}
            {editFolderMissing && (
              <p className="text-warning text-xs">
                いま入っているフォルダが見つかりません（削除されたか、別アカウントのものです）。
              </p>
            )}
          </div>
          <Checkbox
            checked={editForm.allowConcurrent}
            onCheckedChange={(checked) => setEditForm({ ...editForm, allowConcurrent: checked })}
          >
            同時購読を許可する（ほかのシナリオが動いている人にも並行して流す）
          </Checkbox>
        </div>
      </Dialog>

      {/* ★V8 `kz2B6`「違いを比べる」の窓。最新と入力中の設定の要約を比べる。 */}
      <Dialog
        open={compareOpen}
        title="違いを比べる"
        description="ほかの人が保存した最新の内容と、あなたが直している内容を比べます。"
        cancelLabel="閉じる"
        onCancel={() => setCompareOpen(false)}
        footer={
          <Button type="button" variant="primary" onClick={() => void acceptLatestAndContinue()}>
            最新を読み込んで続ける
          </Button>
        }
      >
        <VersionCompare before={latestSummary} after={currentSummary} />
      </Dialog>

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="シナリオの名前・説明などの変更" onConfirm={confirmLeave} onCancel={cancelLeave} />

      {/* 配信を始める前の確認（F1LK4e）。試算と運用記録は画面の持つ実データ。 */}
      <ConfirmDialog
        open={startOpen}
        title="配信をはじめますか"
        description="始める前の最終確認です。はじめると、条件に合う人から順に届きます。"
        designNode="F1LK4e"
        confirmLabel="この内容ではじめる"
        busy={startBusy}
        error={startError}
        onConfirm={preflightLoading || preflightFailed ? undefined : () => void handleStart()}
        onCancel={() => {
          if (startBusy) return
          setStartOpen(false)
          setStartError('')
        }}
      >
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-ink-faint text-xs">シナリオ</p>
            <p className="text-ink text-sm font-semibold">{scenario.name}</p>
          </div>
          <div>
            <p className="text-ink-faint text-xs">LINEアカウント</p>
            <p className="text-ink text-sm font-semibold">{startAccountLabel}</p>
          </div>
          <div>
            <p className="text-ink-faint text-xs">開始対象</p>
            <p className="text-ink text-sm font-semibold">
              きっかけ：{triggerHeadline}
              {simulation
                ? ` → 対象：${formatNumber(simulation.audience.newStartPlanned)}人`
                : preflightLoading
                  ? ' → 対象：試算中…'
                  : ' → 対象：まだ分かりません'}
            </p>
          </div>
          <div>
            <p className="text-ink-faint text-xs">通数・終了後</p>
            <p className="text-ink text-sm font-semibold">
              {sortedSteps.length}通・最後の1通のあと「{startCompleteSummary}」
            </p>
          </div>
        </div>

        <ul className="mt-4 space-y-2">
          {preflightLoading ? (
            <li className="text-ink-faint text-xs">開始前の実データを確認しています…</li>
          ) : null}
          {preflightFailed ? (
            <li className="text-status-danger flex items-center gap-2 text-xs">
              <span>対象人数を試算できなかったため、開始はできません。</span>
              <button
                type="button"
                className="text-action font-semibold hover:underline"
                onClick={() => setSimRetry((n) => n + 1)}
              >
                読み直す
              </button>
            </li>
          ) : null}
          {startChecks.map((item) => (
            <li key={item.label} className={styles.checkRow}>
              <span
                aria-hidden
                className={`${styles.checkMark} ${
                  item.state === 'ok'
                    ? styles.checkOk
                    : item.state === 'warn'
                      ? styles.checkWarn
                      : styles.checkUnknown
                }`}
              >
                {item.state === 'ok' ? '✓' : item.state === 'warn' ? '!' : '—'}
              </span>
              <span>
                <span className="text-ink block font-medium">{item.label}</span>
                <span className="text-ink-faint block text-xs">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <Notice tone="warn" className="mt-4">
          始めると取り消せません。止めた人には、再開すると続きから届きます。
        </Notice>
        <div className="mt-3">
          <Checkbox
            checked={startConfirmed}
            disabled={preflightLoading || preflightFailed}
            onCheckedChange={setStartConfirmed}
          >
            内容と対象を確かめました
          </Checkbox>
        </div>
        {!startConfirmed && !preflightLoading && !preflightFailed && (
          <p className="text-ink-faint mt-2 text-xs">
            上のチェックを入れるまで「この内容ではじめる」は押せません。
          </p>
        )}
      </ConfirmDialog>

      {/* 一時停止の確認（OPGU2）。板の「止める理由（任意）」は受け口（保存先）が API に無いので置かない（BEHAVIOR.md）。
          絵：幅 560・余白 24・間 12。題の左と実行ボタンに印は無い。説明は題の行（×の 36）の下 12。
          ボタンは窓の帯ではなく本文の続き（上に線・間 14・右寄せ）。 */}
      <Dialog
        open={stopOpen}
        title="配信を止めますか"
        tone="destructive"
        confirmation
        designNode="OPGU2"
        designWidth={560}
        designTop={37}
        designHeaderPadding="24px 24px 0"
        designHeaderHeight={48}
        busy={stopBusy}
        error={stopError}
        onCancel={() => {
          if (stopBusy) return
          setStopOpen(false)
          setStopError('')
        }}
      >
        <div className={styles.stopBody}>
          <p className={styles.stopDesc}>止めても、途中の人の記録は残ります。再開すると止めたところから続きを送ります。</p>
          <dl className={styles.stopRow}>
            <dt>いま途中の人</dt>
            <dd>
              {stats?.activeNow === undefined
                ? '確認できません'
                : `${formatNumber(stats.activeNow)}人（止まっているあいだ、新しい人は入りません）`}
            </dd>
          </dl>
          <div className={styles.stopFooter}>
            <Button type="button" onClick={() => { setStopOpen(false); setStopError('') }} disabled={stopBusy}>キャンセル</Button>
            <Button type="button" variant="danger" onClick={() => void handleStop()} disabled={stopBusy} busy={stopBusy} busyLabel="処理中…">一時停止する</Button>
          </div>
        </div>
      </Dialog>

      {/* 複製（Al4Ek）。通・アクション・きっかけを写し、止めた状態で作る。名前は本人が決める。 */}
      <Dialog
        open={duplicateOpen}
        designWidth={600}
        /* 絵の窓は上から300。共通の窓は題の上の余白が絵（24＋題の段28の中央）より5少ないので、題の位置を絵に合わせて305で置く。 */
        designTop={305}
        designNode="Al4Ek"
        title="このシナリオを複製する"
        busy={duplicating}
        onCancel={() => {
          if (duplicating) return
          setDuplicateOpen(false)
        }}
      >
        <div className={styles.dupBody}>
          <label className={styles.dupField}>
            <span className={styles.dupLabel}>新しい名前</span>
            <TextField
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
              maxLength={80}
              required
              aria-label="新しい名前"
            />
          </label>
          <div className={styles.dupBox}>
            <p className={styles.dupBoxTitle}>引き継ぐもの</p>
            <p className={styles.dupBoxBody}>
              {`・メッセージ ${sortedSteps.length}通${sortedSteps.some((s) => s.question) ? '（質問を含む）' : ''}・開始のきっかけ・アクション・配信対象の条件・最後の1通の後・配信方式（${modeLabel}）・フォルダ`}
            </p>
          </div>
          <div className={styles.dupBox}>
            <p className={styles.dupBoxTitle}>引き継がないもの</p>
            <p className={styles.dupBoxBody}>・購読中の人・配信の記録</p>
          </div>
          <p className={styles.dupNote}>
            <ShieldCheck aria-hidden />
            <span>複製は「停止中」で作られます。開始のきっかけも写しますが、配信を始めるまで誰にも届きません。</span>
          </p>
          {/* 絵（Al4Ek）は操作が真ん中。共通の窓の右寄せの操作の段は使わず、本文の続きに置く。 */}
          <div className={styles.dupActions}>
            <Button variant="secondary" onClick={() => setDuplicateOpen(false)} disabled={duplicating}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleDuplicate(duplicateName)}
              disabled={duplicating || !duplicateName.trim()}
              busy={duplicating}
              busyLabel="複製中…"
            >
              <Copy aria-hidden />
              複製する
            </Button>
          </div>
        </div>
      </Dialog>

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
    </PageFrame>
  )
}
