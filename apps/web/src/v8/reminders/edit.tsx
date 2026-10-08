'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Filter,
  GitCompare,
  GripVertical,
  IdCard,
  Layers,
  List,
  Plus,
  Power,
  RefreshCw,
  Send,
  Smartphone,
  Trash2,
  TriangleAlert,
  User,
  Users,
  Video,
} from 'lucide-react'
import {
  describeReminderTiming,
  resolveReminderSendAt,
  type FriendField,
  type ReminderDraftSettings,
  type ReminderDraftStep,
  type ReminderDraftVersion,
  type ReminderPreviewResult,
  type ReminderPublishResult,
  type ReminderValidationResult,
} from '@line-crm/shared'
import { ApiError, api, type EventListItem } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { formatNumber } from '@/lib/format'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useDraftAutosave } from '@/v8/autosave/use-draft-autosave'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import ReorderHandle, { useReorder } from '@/components/shared/reorder-handle'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Dialog from '@/components/shared/dialog'
import DetailPanel from '@/components/shared/detail-panel'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { TextArea, TextField } from '@/components/shared/text-field'
import { TimeField } from '@/components/shared/date-time-field'
import ConditionBuilder, { pruneCondition, type SegmentCondition } from '@/components/shared/condition-builder'
import { firstReminderStepMessage, reminderStepTimings, reminderStopSummary, reminderTriggerLabel, renderReminderBodySample } from '@/components/reminders/reminder-labels'
import { useReminderTestRecipient } from '@/components/reminders/use-reminder-test-recipient'
import { useReminderTestSend } from '@/components/reminders/use-reminder-test-send'
import { TestRecipientGuidance, testRecipientDestinationLabel, testRecipientNote, testSendConfirmDescription } from '@/components/reminders/test-recipient-guidance'
import {
  basicsFromDraft,
  basicsToDraft,
  basicsBaseSummary,
  reminderTemplatesV8,
  ReminderBasicsFormV8,
  type BasicsValue,
  type ReminderTemplateV8,
} from './basics-form'
import { describeReminderDiff } from './conflict-diff'
import { BackToReminders, ChoiceCardV8, PhoneV8, ReminderV8Stepper, SummaryCardV8, WizardFooterV8, type ReminderV8StepKey } from './ui'
import styles from './edit.module.css'

/*
 * ★V8 リマインダを作る・手順1の直し〜5と完了（src/v8 に一から書いた版）。
 * 板：k32cn（手順1の直し・競合）/ YChR6（対象者と止める条件）/
 *     p5YuP・r1l0bT（通知の中身 1440・1152）/ T0nis（配信予定）/
 *     ltAaq（確認）/ hjNpJ（有効にした）。
 * 画面の枠は型（CreatePage）が持つ。動き（API・保存・競合・テスト送信・有効化）は
 * 今の画面（app/reminders/edit/edit-v8.tsx）と同じ。BEHAVIOR.md に一覧がある。
 */

type V8Stage = 'basics' | 'target' | 'messages' | 'schedule' | 'confirm' | 'done'

/** URL の ?stage= → 手順（今の画面と同じ名前）。 */
export function stageFor(raw: string | null): V8Stage {
  switch (raw) {
    case 'basics':
      return 'basics'
    case 'target':
      return 'target'
    case 'preview':
    case 'schedule':
      return 'schedule'
    case 'test':
    case 'confirm':
      return 'confirm'
    case 'done':
      return 'done'
    default:
      return 'messages'
  }
}

function countLabel(value: number | null, unit: string): string {
  return value == null ? `—${unit}` : `${formatNumber(value)}${unit}`
}

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土']

/** 「10/1（水）18:00」の形。 */
function formatMd(value: Date | string | null): string {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1}/${date.getDate()}（${WEEKDAYS_JA[date.getDay()]}）${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 「10/1 18:00」の形（例の文の短い日時）。 */
function formatShort(value: Date): string {
  return `${value.getMonth() + 1}/${value.getDate()} ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

/** 「10月2日(木) 14:00」の形。 */
function formatJpDay(value: Date): string {
  return `${value.getMonth() + 1}月${value.getDate()}日(${WEEKDAYS_JA[value.getDay()]}) ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

/** 届く日時の例に使う見本の基準日。3日後の14:00（端末の時計）。 */
function sampleBaseDate(): Date {
  const base = new Date()
  base.setDate(base.getDate() + 3)
  base.setHours(14, 0, 0, 0)
  return base
}

function exampleSendAt(step: ReminderDraftStep, mode: ReminderDraftSettings['deliveryMode'], base: Date): Date {
  return resolveReminderSendAt(base, {
    offsetDays: step.offsetDays ?? null,
    sendAtTime: step.sendAtTime ?? null,
    offsetMinutes: step.offsetMinutes ?? 0,
  }, mode)
}

/** ステップの短い呼び名。「1日前 18:00」「1時間前」。 */
function stepShortTiming(step: ReminderDraftStep, mode: ReminderDraftSettings['deliveryMode']): string {
  if (mode === 'time' && step.offsetDays != null && step.sendAtTime) {
    const days = step.offsetDays
    const dayLabel = days === 0 ? '当日' : days < 0 ? `${-days}日前` : `${days}日後`
    return `${dayLabel} ${step.sendAtTime}`
  }
  return describeReminderTiming(step, mode)
}

/** 板が 1100px を切ったら（画面幅で約 1352px 未満）、通知の中身は 1152 の板 `r1l0bT` の形。 */
function useNarrowBoard() {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 1351px)')
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}

/** 各手順が型（CreatePage）へ渡す頭の部分。 */
type StageFrame = {
  boardId: string
  title: string
  identity: ReactNode
  steps: ReactNode
  description: ReactNode
  /** 下の帯の左の文（下書きの自動保存の状態）。 */
  status?: ReactNode
}

export default function ReminderEditV8({ reminderId, stage }: { reminderId: string; stage: string | null }) {
  const v8stage = stageFor(stage)
  const narrowBoard = useNarrowBoard()
  usePageTitle(
    v8stage === 'basics' ? 'リマインダを作成・基本設定'
      : v8stage === 'target' ? 'リマインダを作成・対象者と止める条件'
        : v8stage === 'messages' ? 'リマインダを作成・通知の中身'
          : v8stage === 'schedule' ? 'リマインダを作成・配信予定'
            : v8stage === 'confirm' ? 'リマインダを作成・確認'
              : 'リマインダ・有効化完了',
  )
  const router = useRouter()
  const [draft, setDraft] = useState<ReminderDraftVersion | null>(null)
  const [settings, setSettings] = useState<ReminderDraftSettings | null>(null)
  /*
   * 基本設定の入力値はここで持つ。basicsToDraft は保存の直前にだけ通す
   * （trim が打鍵を消すため）。dirty は「いまの値」対「保存済みから戻した値」。
   */
  const [basics, setBasics] = useState<BasicsValue | null>(null)
  const [preview, setPreview] = useState<ReminderPreviewResult | null>(null)
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [previewRetryToken, setPreviewRetryToken] = useState(0)
  const [validation, setValidation] = useState<ReminderValidationResult | null>(null)
  const [validationState, setValidationState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [validationRetryToken, setValidationRetryToken] = useState(0)
  const [published, setPublished] = useState<ReminderPublishResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadMissing, setLoadMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [compareTarget, setCompareTarget] = useState<ReminderDraftSettings | null>(null)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareError, setCompareError] = useState('')
  const [testConfirm, setTestConfirm] = useState(false)
  const requestSeq = useRef(0)

  // テスト送信の口は確認の段だけ開く。ほかの段で余計な GET を打たない。
  const testRecipient = useReminderTestRecipient(v8stage === 'confirm' ? reminderId : null)
  const testSend = useReminderTestSend(v8stage === 'confirm' ? reminderId : null)

  const go = useCallback(
    (next: string | null) => router.push(`/reminders/edit?id=${encodeURIComponent(reminderId)}${next ? `&stage=${next}` : ''}`),
    [reminderId, router],
  )

  const loadDraft = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError('')
    setLoadMissing(false)
    try {
      const response = await api.reminders.getDraft(reminderId)
      if (seq !== requestSeq.current) return
      if (!response.success) throw new Error(response.error)
      if (response.data.reminderId !== reminderId) throw new Error('下書きを読み込めませんでした。')
      setDraft(response.data)
      setSettings(response.data.settings)
      setBasics(basicsFromDraft(response.data.settings))
      setConflict(false)
    } catch (caught) {
      if (seq !== requestSeq.current) return
      if (caught instanceof ApiError && caught.status === 404) setLoadMissing(true)
      else setError('下書きを読み込めませんでした。')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [reminderId])

  useEffect(() => {
    setDraft(null)
    setSettings(null)
    setBasics(null)
    setPreview(null)
    setValidation(null)
    setPublished(null)
    setTestConfirm(false)
    setPreviewState('idle')
    setValidationState('idle')
    void loadDraft()
  }, [loadDraft])

  // 競合「最新を読み込んで続ける」。入力中の内容は最新の版で置き換わる。
  const reloadAfterConflict = async () => {
    setCompareTarget(null)
    setCompareError('')
    setError('')
    await loadDraft()
  }

  // 競合「違いを比べる」。最新を取って比べるだけで、画面は書き換えない。
  const openCompare = async () => {
    if (compareBusy) return
    setCompareBusy(true)
    setCompareError('')
    try {
      const response = await api.reminders.getDraft(reminderId)
      if (!response.success || response.data.reminderId !== reminderId) {
        setCompareError('最新の内容を取れませんでした。もう一度お試しください。')
        return
      }
      setCompareTarget(response.data.settings)
    } catch {
      setCompareError('最新の内容を取れませんでした。もう一度お試しください。')
    } finally {
      setCompareBusy(false)
    }
  }

  // 配信予定は「配信予定」「確認」「完了」で読む。
  useEffect(() => {
    if (!settings || (v8stage !== 'schedule' && v8stage !== 'confirm' && v8stage !== 'done')) return
    let active = true
    setPreviewState('loading')
    void api.reminders.previewDraft(reminderId).then((response) => {
      if (!active) return
      if (response.success) {
        setPreview(response.data)
        setPreviewState('ready')
      } else {
        setPreviewState('error')
      }
    }).catch(() => { if (active) setPreviewState('error') })
    return () => { active = false }
  }, [reminderId, settings, v8stage, previewRetryToken])

  // 公開前チェックは対象・確認・完了で読む。
  useEffect(() => {
    if (!settings || (v8stage !== 'target' && v8stage !== 'confirm' && v8stage !== 'done')) return
    let active = true
    setValidationState('loading')
    void api.reminders.validateDraft(reminderId).then((response) => {
      if (!active) return
      if (response.success) {
        setValidation(response.data)
        setValidationState('ready')
      } else {
        setValidationState('error')
      }
    }).catch(() => { if (active) setValidationState('error') })
    return () => { active = false }
  }, [reminderId, settings, v8stage, validationRetryToken])

  const retryPreview = useCallback(() => setPreviewRetryToken((value) => value + 1), [])
  const retryValidation = useCallback(() => setValidationRetryToken((value) => value + 1), [])

  // 入力を持つ段（基本・対象・通知）は書きかけを「未保存の変更あり」として守る。
  const basicsDirty = v8stage === 'basics'
    && draft !== null && basics !== null
    && JSON.stringify(basics) !== JSON.stringify(basicsFromDraft(draft.settings))
  const settingsDirty = (v8stage === 'target' || v8stage === 'messages')
    && draft !== null && settings !== null
    && JSON.stringify(settings) !== JSON.stringify(draft.settings)
  const dirty = basicsDirty || settingsDirty
  const draftRef = useRef(draft)
  draftRef.current = draft
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty,
    busy,
    onDiscard: () => {
      const saved = draftRef.current
      if (saved) {
        setSettings(saved.settings)
        setBasics(basicsFromDraft(saved.settings))
      }
    },
  })

  /*
   * 自動保存と手の保存が重なると、同じ版を2回送って競合に見える。
   * 送っている途中の保存を待ち、最新の版（draftRef）で送る。
   */
  const saveInFlight = useRef<Promise<unknown> | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const basicsRef = useRef(basics)
  basicsRef.current = basics

  /**
   * 下書きを保存する。409 は読み直しの帯へ出す。
   * silent は自動保存：押せない印・赤い帯は出さない。保存中に打ち足した入力は
   * 応答で上書きせず、そのまま残す（次の自動保存で追って送る）。
   */
  async function saveSettings(next: ReminderDraftSettings, { silent = false }: { silent?: boolean } = {}): Promise<boolean> {
    if (!silent) {
      setBusy(true)
      setError('')
      setConflict(false)
    }
    while (saveInFlight.current) await saveInFlight.current.catch(() => undefined)
    const base = draftRef.current
    const sentSettings = settingsRef.current
    const sentBasics = basicsRef.current
    const request = api.reminders.saveDraft(
      reminderId,
      next,
      // 開いたときの版 ID と版の時刻を送り、別の画面の先勝ちを止める。
      base ? { expectedVersionId: base.versionId, expectedUpdatedAt: base.updatedAt } : {},
    )
    saveInFlight.current = request
    try {
      const response = await request
      if (!response.success) throw new Error(response.error)
      draftRef.current = response.data
      setDraft(response.data)
      setConflict(false)
      const untouched = settingsRef.current === sentSettings && basicsRef.current === sentBasics
      if (!silent || untouched) {
        setSettings(response.data.settings)
        setBasics(basicsFromDraft(response.data.settings))
      }
      return true
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setConflict(true)
      } else if (!silent) {
        setError('保存できませんでした。')
      }
      return false
    } finally {
      if (saveInFlight.current === request) saveInFlight.current = null
      if (!silent) setBusy(false)
    }
  }

  /*
   * 入力を持つ段（基本・対象・通知）は、入力が止まって2秒で下書きへ静かに保存する
   * （一斉配信と同じ）。下書きなので有効中の配信は変わらない。閲覧のみの人には動かさない。
   */
  const role = useStaffRole()
  const autosave = useDraftAutosave({
    fingerprint: JSON.stringify(v8stage === 'basics' ? basics : settings),
    dirty,
    active: role === null || canManageRole(role),
    enabled: !loading && !conflict && draft !== null && settings !== null
      && (v8stage !== 'basics' || Boolean(basics?.name.trim())),
    paused: leaveTarget !== null || busy,
    save: async () => {
      const current = settingsRef.current
      if (!current) return false
      const currentBasics = basicsRef.current
      return saveSettings(v8stage === 'basics' && currentBasics ? basicsToDraft(current, currentBasics) : current, { silent: true })
    },
  })
  /** 手で「下書きを保存」したとき。保存できたら帯を「保存済み」にする。 */
  async function saveDraftByHand(next: ReminderDraftSettings) {
    if (await saveSettings(next)) autosave.markSaved()
  }

  async function sendTest() {
    const outcome = await testSend.send()
    if (outcome.kind === 'succeeded') {
      setDraft((current) => current ? { ...current, lastTestStatus: 'succeeded', lastTestedAt: outcome.testedAt } : current)
      setTestConfirm(false)
      return
    }
    if (outcome.kind === 'failed' && outcome.recipientFault) {
      void testRecipient.reload()
      setTestConfirm(false)
    }
    // 確定した失敗・結果不明は窓を開いたままにし、エラーは窓の中に出す。
  }

  async function publishDraft() {
    if (!validation?.valid || draft?.lastTestStatus !== 'succeeded') return
    setBusy(true)
    try {
      const response = await api.reminders.publishDraft(reminderId)
      if (!response.success) throw new Error(response.error)
      setPublished(response.data)
      go('done')
    } catch {
      setError('リマインダを有効化できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const subjectDraft = draft && draft.reminderId === reminderId ? draft : null
  const subjectSettings = subjectDraft ? settings : null

  if (loading) return <ListState kind="loading" title="下書きを読み込んでいます" />
  if (loadMissing) {
    return (
      <ListState kind="empty" title="このリマインダは見つかりません" description="削除されたか、別の記録です。一覧から選び直してください。" action={<Button href="/reminders">リマインダ一覧へ戻る</Button>} />
    )
  }
  if (!subjectDraft || !subjectSettings) {
    return <ListState kind="error" title="下書きを表示できませんでした" description={error || '下書きを読み込めませんでした。'} action={<Button onClick={() => void loadDraft()}>再読み込み</Button>} />
  }

  const testIssue = testSend.phase.kind === 'failed' || testSend.phase.kind === 'unknown' ? testSend.phase.message : ''
  const sendBusy = testSend.phase.kind === 'sending'
  const sentName = testSend.phase.kind === 'succeeded' ? testSend.phase.recipientName : null
  const sentKind = testSend.phase.kind === 'succeeded' ? testSend.phase.recipientKind : null

  const currentKey: ReminderV8StepKey | 'done' = v8stage

  // 外枠に板 ID を持たせる（見本と突き合わせる目印）。
  const designNode = conflict ? 'k32cn'
    : v8stage === 'basics' ? 'VE1u5'
      : v8stage === 'target' ? 'YChR6'
        : v8stage === 'messages' ? (narrowBoard ? 'r1l0bT' : 'p5YuP')
          : v8stage === 'schedule' ? 'T0nis'
            : v8stage === 'confirm' ? 'ltAaq'
              : 'hjNpJ'

  /*
   * 競合（k32cn）の帯は頭の線の下・本文の上、板の幅いっぱい。型の頭の説明の
   * 段（最後の行）に入れ、帯の上下の間は自分の CSS で絵の位置に合わせる。
   */
  const conflictBand = conflict ? (
    <div className={styles.conflictBand} role="alert">
      <TriangleAlert size={18} aria-hidden="true" className={styles.conflictIcon} />
      <div className={styles.conflictText}>
        <p className={styles.conflictTitle}>ほかの人が先にリマインダ「{subjectSettings.name}」を保存しました</p>
        <p className={styles.conflictNote}>あなたが直した所はまだ保存されていません。このまま保存すると、相手の変更が消えます。</p>
      </div>
      <Button type="button" variant="secondary" onClick={() => void openCompare()} disabled={compareBusy}>
        <GitCompare size={15} aria-hidden="true" />{compareBusy ? '比べています…' : '違いを比べる'}
      </Button>
      <Button type="button" variant="primary" onClick={() => void reloadAfterConflict()}>
        <RefreshCw size={15} aria-hidden="true" />最新を読み込んで続ける
      </Button>
    </div>
  ) : null

  const frame: StageFrame = {
    boardId: designNode,
    title: 'リマインダを作る',
    identity: <BackToReminders />,
    steps: <ReminderV8Stepper current={currentKey} reminderId={reminderId} />,
    description: (
      <>
        {v8stage === 'basics'
          ? 'いまは下書きとして作ります。最後の「確認」で有効にします。'
          : v8stage === 'done'
            ? `名前：${subjectSettings.name}`
            : `名前：${subjectSettings.name}・いまは下書きです`}
        {conflictBand}
      </>
    ),
    status: autosave.label ? <span aria-live="polite" data-autosave-status>{autosave.label}</span> : undefined,
  }

  const stageError = (error || (!testConfirm && testIssue && v8stage === 'confirm'))
    ? <Notice tone="danger">{error || testIssue}</Notice>
    : null

  return (
    <>
      {v8stage === 'basics' ? (
        <BasicsStageV8
          frame={frame}
          notice={stageError}
          value={basics ?? basicsFromDraft(subjectSettings)}
          onChange={setBasics}
          stepCount={subjectSettings.steps.length}
          busy={busy}
          onSave={async (value) => {
            const saved = await saveSettings(basicsToDraft(subjectSettings, value))
            if (saved) go('target')
          }}
          onSaveDraft={async (value) => { await saveDraftByHand(basicsToDraft(subjectSettings, value)) }}
          onCancel={() => router.push('/reminders')}
        />
      ) : null}

      {v8stage === 'target' ? (
        <TargetStageV8
          frame={frame}
          notice={stageError}
          reminderId={reminderId}
          settings={subjectSettings}
          validation={validation}
          validationFailed={validationState === 'error'}
          onRetryValidation={retryValidation}
          onChange={setSettings}
          busy={busy}
          onNext={async () => {
            // 保存したら通知の中身（手順3）へ。配信予定は通知のあと。
            const saved = await saveSettings(subjectSettings)
            if (saved) go(null)
          }}
          onSaveDraft={async () => { await saveDraftByHand(subjectSettings) }}
          onCancel={() => router.push('/reminders')}
        />
      ) : null}

      {v8stage === 'messages' ? (
        <MessagesStageV8
          frame={frame}
          notice={stageError}
          narrow={narrowBoard}
          settings={subjectSettings}
          onChange={setSettings}
          busy={busy}
          onNext={async () => {
            const saved = await saveSettings(subjectSettings)
            if (saved) go('preview')
          }}
          onSaveDraft={async () => { await saveDraftByHand(subjectSettings) }}
          onCancel={() => router.push('/reminders')}
        />
      ) : null}

      {v8stage === 'schedule' ? (
        <ScheduleStageV8
          frame={frame}
          notice={stageError}
          reminderId={reminderId}
          settings={subjectSettings}
          preview={preview}
          previewFailed={previewState === 'error'}
          onRetryPreview={retryPreview}
          onNext={() => go('confirm')}
          onSaveDraft={async () => { await saveDraftByHand(subjectSettings) }}
          busy={busy}
          onCancel={() => router.push('/reminders')}
        />
      ) : null}

      {v8stage === 'confirm' ? (
        <ConfirmStageV8
          frame={frame}
          notice={stageError}
          reminderId={reminderId}
          draft={subjectDraft}
          settings={subjectSettings}
          validation={validation}
          validationFailed={validationState === 'error'}
          onRetryValidation={retryValidation}
          preview={preview}
          previewFailed={previewState === 'error'}
          recipientView={testRecipient.view}
          onRecipientRecheck={() => void testRecipient.reload()}
          sentName={sentName}
          sentKind={sentKind}
          sendBusy={sendBusy}
          onSend={() => { testSend.beginAttempt(); setTestConfirm(true) }}
          busy={busy}
          publishReady={Boolean(validation?.valid) && subjectDraft.lastTestStatus === 'succeeded'}
          onPublish={() => void publishDraft()}
          onSaveDraft={async () => { await saveDraftByHand(subjectSettings) }}
          onCancel={() => router.push('/reminders')}
        />
      ) : null}

      {v8stage === 'done' ? (
        <DoneStageV8 frame={frame} reminderId={reminderId} settings={subjectSettings} published={published} preview={preview} />
      ) : null}

      <ConfirmDialog
        open={testConfirm && v8stage === 'confirm'}
        title="テスト送信しますか？"
        description={testSend.phase.kind === 'unknown' ? '前回の送信結果を確認できていません。再試行しても二重には送られません。' : testSendConfirmDescription(testRecipient.view, sentName, sentKind)}
        confirmLabel={testIssue ? 'もう一度送信' : 'テスト送信'}
        cancelLabel="閉じる"
        busy={sendBusy}
        error={testIssue}
        onConfirm={() => void sendTest()}
        onCancel={() => setTestConfirm(false)}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="この手順への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
      <ConfirmDialog
        open={compareTarget !== null || compareError !== ''}
        title="最新の保存と比べる"
        description="あなたの下書きと、相手が保存した最新の内容の違いです。読み込むまでは画面は変わりません。"
        confirmLabel="最新を読み込んで続ける"
        busy={compareBusy}
        error={compareError || undefined}
        onConfirm={() => void reloadAfterConflict()}
        onCancel={() => {
          setCompareTarget(null)
          setCompareError('')
        }}
      >
        {compareTarget && settings && (() => {
          const mine = basics ? basicsToDraft(settings, basics) : settings
          const lines = describeReminderDiff(mine, compareTarget)
          return lines.length === 0 ? (
            <p className={styles.fieldNote}>違いは見つかりませんでした。そのまま読み込めます。</p>
          ) : (
            <ul className={styles.diffList}>
              {lines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )
        })()}
      </ConfirmDialog>
    </>
  )
}

/* ---------------- 手順1の直し（基本設定・競合 k32cn） ---------------- */

function BasicsStageV8({
  frame,
  notice,
  value,
  onChange,
  stepCount,
  busy,
  onSave,
  onSaveDraft,
  onCancel,
}: {
  frame: StageFrame
  notice: ReactNode
  value: BasicsValue
  onChange: (value: BasicsValue) => void
  stepCount: number
  busy: boolean
  onSave: (value: BasicsValue) => void
  onSaveDraft: (value: BasicsValue) => void
  onCancel: () => void
}) {
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<ReminderTemplateV8 | null>(null)
  const [pendingFieldMatch, setPendingFieldMatch] = useState<string | null>(null)
  const [dateFields, setDateFields] = useState<FriendField[]>([])
  const [events, setEvents] = useState<EventListItem[]>([])
  const [fieldsState, setFieldsState] = useState<'loading' | 'ready' | 'error'>('ready')
  const [eventsState, setEventsState] = useState<'loading' | 'ready' | 'error'>('ready')

  const onFieldsReady = useCallback((fields: FriendField[], state: 'loading' | 'ready' | 'error') => {
    setDateFields(fields)
    setFieldsState(state)
  }, [])
  const onEventsReady = useCallback((items: EventListItem[], state: 'loading' | 'ready' | 'error') => {
    setEvents(items)
    setEventsState(state)
  }, [])

  const appliedTemplate = reminderTemplatesV8.find((template) => template.id === appliedTemplateId) ?? null

  function requestTemplate(template: ReminderTemplateV8) {
    const hasInputsToReplace =
      (appliedTemplateId !== null && appliedTemplateId !== template.id) ||
      value.triggerFieldId !== '' ||
      value.triggerEventId !== '' ||
      value.repeatYearly
    if (hasInputsToReplace) setPendingTemplate(template)
    else applyTemplate(template)
  }

  function applyTemplate(template: ReminderTemplateV8) {
    setAppliedTemplateId(template.id)
    onChange({
      ...value,
      triggerType: template.triggerType,
      repeatYearly: Boolean(template.repeatYearly),
      triggerFieldId: '',
      triggerEventId: '',
    })
    setPendingFieldMatch(template.triggerType === 'friend_field' ? template.fieldNameMatch ?? null : null)
  }

  function handleChange(next: BasicsValue) {
    if (appliedTemplate && appliedTemplate.triggerType !== next.triggerType) setAppliedTemplateId(null)
    if (next.triggerType !== 'friend_field') setPendingFieldMatch(null)
    onChange(next)
  }

  const candidatesPending =
    (value.triggerType === 'friend_field' && fieldsState !== 'ready') ||
    (value.triggerType === 'event' && eventsState !== 'ready')

  return (
    <CreatePage
      {...frame}
      preview={(
        <>
          <SummaryCardV8
            rows={[
              { key: '基準日', value: basicsBaseSummary(value, dateFields, events) },
              { key: '対象者', value: '手順2で決める' },
              { key: '通知', value: stepCount > 0 ? `${stepCount}通` : '手順3で作る' },
              { key: '状態', value: '下書き' },
            ]}
          />
          <p className={styles.sideHint}>LINEでの見え方は、届けるメッセージを決める手順から右に出ます。</p>
        </>
      )}
      footerActions={(
        <WizardFooterV8
          onCancel={onCancel}
          cancelDisabled={busy}
          onDraft={() => onSaveDraft(value)}
          draftBusy={busy}
          nextLabel="次へ：対象者と止める条件"
          nextIcon={<ArrowRight size={15} aria-hidden="true" />}
          onNext={() => onSave(value)}
          nextDisabled={candidatesPending || busy || !value.name.trim()}
        />
      )}
    >
      {notice}
      <ReminderBasicsFormV8
        value={value}
        onChange={handleChange}
        appliedTemplateId={appliedTemplateId}
        onRequestTemplate={requestTemplate}
        pendingFieldMatch={pendingFieldMatch}
        onFieldMatchHandled={() => setPendingFieldMatch(null)}
        onFieldsReady={onFieldsReady}
        onEventsReady={onEventsReady}
      />
      <ConfirmDialog
        open={pendingTemplate !== null}
        title="ひな形の内容で上書きしますか？"
        description="いま選んでいる基準日や繰り返しの設定は、ひな形の内容に置き換わります。"
        confirmLabel="このひな形を使う"
        onConfirm={() => {
          if (pendingTemplate) applyTemplate(pendingTemplate)
          setPendingTemplate(null)
        }}
        onCancel={() => setPendingTemplate(null)}
      />
    </CreatePage>
  )
}

/* ---------------- 手順2：対象者と止める条件（YChR6） ---------------- */

function TargetStageV8({
  frame,
  notice,
  reminderId,
  settings,
  validation,
  validationFailed = false,
  onRetryValidation,
  onChange,
  busy,
  onNext,
  onSaveDraft,
  onCancel,
}: {
  frame: StageFrame
  notice: ReactNode
  reminderId: string
  settings: ReminderDraftSettings
  validation: ReminderValidationResult | null
  validationFailed?: boolean
  onRetryValidation?: () => void
  onChange: (value: ReminderDraftSettings) => void
  busy: boolean
  onNext: () => void
  onSaveDraft: () => void
  onCancel: () => void
}) {
  const { selectedAccount } = useAccount()
  const stop = settings.stopConditions
  const condition = (settings.targetCondition ?? null) as SegmentCondition | null
  const mode = pruneCondition(condition) ? 'condition' : 'all'

  // 保存前の条件で数え直した人数。条件が空なら保存済みの検査結果を出す。
  const [recount, setRecount] = useState<{ matched: number; excluded: number; sample: Array<{ id: string; displayName: string }> } | null>(null)
  const [counting, setCounting] = useState(false)
  const [recountError, setRecountError] = useState('')
  const [recountRetryToken, setRecountRetryToken] = useState(0)
  const [facesOpen, setFacesOpen] = useState(false)
  const [faces, setFaces] = useState<{ loading: boolean; error: string; sample: Array<{ id: string; displayName: string }>; matched: number | null } | null>(null)

  useEffect(() => {
    const pruned = pruneCondition(condition)
    if (!pruned) {
      setRecount(null)
      setRecountError('')
      setCounting(false)
      return
    }
    setCounting(true)
    setRecountError('')
    let active = true
    const timer = setTimeout(() => {
      void api.reminders.audience(reminderId, pruned).then((response) => {
        if (!active) return
        setCounting(false)
        if (response.success) setRecount(response.data)
        else setRecountError(response.error)
      }).catch(() => {
        if (!active) return
        setCounting(false)
        setRecountError('対象者を数え直せませんでした。')
      })
    }, 400)
    return () => {
      active = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderId, JSON.stringify(condition), recountRetryToken])

  const matched = recount ? recount.matched : validation?.audience.matched ?? null
  const total = recount
    ? recount.matched + recount.excluded
    : validation?.audience.matched != null && validation.audience.excluded != null
      ? validation.audience.matched + validation.audience.excluded
      : null

  function openFaces() {
    if (recount) {
      setFaces({ loading: false, error: '', sample: recount.sample, matched: recount.matched })
    } else {
      setFaces({ loading: true, error: '', sample: [], matched: null })
      void api.reminders.audience(reminderId).then((response) => {
        if (response.success) setFaces({ loading: false, error: '', sample: response.data.sample, matched: response.data.matched })
        else setFaces({ loading: false, error: response.error, sample: [], matched: null })
      }).catch(() => setFaces({ loading: false, error: '対象者を確認できませんでした。', sample: [], matched: null }))
    }
    setFacesOpen(true)
  }

  const allLabel = settings.triggerType === 'friend_field' ? '基準日が入っている人すべて' : '予約がある人すべて'
  const allNote = settings.triggerType === 'friend_field' ? '情報欄に日付が入った人' : '予約日時が入った人'
  const audienceNote = settings.triggerType === 'friend_field' ? '基準日が入っている友だちに送ります' : '予約日時が入っている友だちに送ります'
  const firstStep = settings.steps[0] ?? null

  const stopRows: Array<{ key: string; title: string; note: string; label: string; checked: boolean; locked?: boolean; onChange?: (next: boolean) => void }> = [
    { key: 'cancel', title: '予約がキャンセルされた', note: 'すぐ止める', label: '予約がキャンセルされたら止める', checked: stop.bookingCancelled, onChange: (next) => onChange({ ...settings, stopConditions: { ...stop, bookingCancelled: next } }) },
    { key: 'done', title: '対応マークが「完了」になった', note: '残りを止める', label: '対応マークが完了になったら止める', checked: stop.supportMarkCompleted, onChange: (next) => onChange({ ...settings, stopConditions: { ...stop, supportMarkCompleted: next } }) },
    { key: 'days', title: '基準日を7日過ぎた', note: '自動で終わる', label: '基準日を7日過ぎたら自動で終わる', checked: stop.daysAfterTarget != null, onChange: (next) => onChange({ ...settings, stopConditions: { ...stop, daysAfterTarget: next ? 7 : null } }) },
    // ブロックは LINE 側で止まる。切っても届かないので、変えられない入口として出す。
    { key: 'block', title: '友だちがブロックした', note: 'すぐ止める（変えられません）', label: '友だちがブロックしたら止める', checked: true, locked: true },
  ]

  return (
    <CreatePage
      {...frame}
      preview={(
        <>
          <SummaryCardV8
            rows={[
              { key: '基準日', value: reminderTriggerLabel(settings.triggerType) },
              { key: '対象者', value: matched == null ? '—' : `${formatNumber(matched)}人に送る予定` },
              { key: '通知', value: settings.steps.length > 0 ? `${settings.steps.length}通` : '手順3で作る' },
              { key: '状態', value: '下書き' },
            ]}
          />
          <PhoneV8
            accountName={selectedAccount?.name ?? 'LINE公式アカウント'}
            chip={firstStep ? '1通目の通知' : '通知は手順3で作ります'}
            empty={!firstStep}
            message={firstStep ? renderReminderBodySample(firstStep.messageContent || '本文はまだありません') : undefined}
          />
        </>
      )}
      footerActions={(
        <WizardFooterV8
          onCancel={onCancel}
          cancelDisabled={busy}
          onDraft={onSaveDraft}
          draftBusy={busy}
          nextLabel="次へ：通知の中身"
          nextIcon={<ArrowRight size={15} aria-hidden="true" />}
          onNext={onNext}
          nextDisabled={busy}
        />
      )}
    >
      {notice}
      <section className={styles.card} aria-labelledby="rm-target-title">
        <div className={styles.cardHead}>
          <h2 id="rm-target-title" className={styles.cardTitle}>対象者</h2>
          <p className={styles.cardNote}>{audienceNote}</p>
        </div>
        <div className={styles.choiceRow} role="radiogroup" aria-label="対象者">
          <ChoiceCardV8
            name="reminder-v8-audience"
            value="all"
            checked={mode === 'all'}
            onChange={() => onChange({ ...settings, targetCondition: null })}
            icon={<Users size={18} />}
            title={allLabel}
            note={allNote}
          />
          <ChoiceCardV8
            name="reminder-v8-audience"
            value="condition"
            checked={mode === 'condition'}
            onChange={() => onChange({ ...settings, targetCondition: condition ?? { operator: 'AND', rules: [], groups: [] } })}
            icon={<Filter size={18} />}
            title="条件に合う人だけ"
            note="タグ・友だち情報などで絞る"
          />
        </div>
        {mode === 'condition' ? (
          <ConditionBuilder value={condition} showCount={false} onChange={(next) => onChange({ ...settings, targetCondition: next })} />
        ) : null}
        <div className={styles.countBand}>
          <div className={styles.countItem}>
            <span className={styles.countLabel}>当てはまる人</span>
            <strong className={styles.countValue}>{`${counting ? '…' : total == null ? '—' : formatNumber(total)} 人`}</strong>
          </div>
          <div className={styles.countItem}>
            <span className={styles.countLabel}>送る予定（ブロックを除く）</span>
            <strong className={styles.countValue}>{`${counting ? '…' : matched == null ? '—' : formatNumber(matched)} 人`}</strong>
          </div>
          <span className={styles.spacer} aria-hidden="true" />
          <Button type="button" variant="text" onClick={openFaces} disabled={counting}>
            <Users size={15} aria-hidden="true" />顔ぶれを見る
          </Button>
          <Button
            type="button"
            variant="text"
            disabled={counting}
            onClick={() => (mode === 'condition' ? setRecountRetryToken((value) => value + 1) : onRetryValidation?.())}
          >
            <RefreshCw size={15} aria-hidden="true" />数え直す
          </Button>
          <span className={styles.countNote}>数秒〜1分（1,000人ごとに約10秒）</span>
        </div>
        {recountError ? <p className={styles.fieldNote}>対象者を数え直せませんでした。保存済みの人数を表示しています。</p> : null}
        {validationFailed ? <p className={styles.fieldNote}>公開前チェックを実行できませんでした。人数は未取得のままです。</p> : null}
        <p className={styles.cardNote}>基準日が登録・変更されたときに、対象かどうかを自動で見直します。</p>
      </section>

      <section className={styles.card} aria-labelledby="rm-stop-title">
        <div className={styles.cardHead}>
          <h2 id="rm-stop-title" className={styles.cardTitle}>止める条件</h2>
          <p className={styles.cardNote}>当てはまったら、その人への残りの通知を止めます</p>
        </div>
        <div className={styles.stopList}>
          {stopRows.map((row) => (
            <div key={row.key} className={styles.stopRow}>
              <span className={styles.stopText}>
                <span className={styles.stopTitle}>{row.title}</span>
                <span className={styles.stopNote}>{row.note}</span>
              </span>
              {row.locked
                ? <Toggle label={row.label} checked locked />
                : <Toggle label={row.label} checked={row.checked} onChange={(next) => row.onChange?.(next)} />}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.card} aria-labelledby="rm-rule-title">
        <div className={styles.cardHead}>
          <h2 id="rm-rule-title" className={styles.cardTitle}>いつも守る決まり</h2>
          <p className={styles.ruleText}>
            ・基準日が空欄の人には始めない<br />
            ・過去の日時になった通知は送らない<br />
            ・同じ時刻に重なった通知は1通にまとめる
          </p>
        </div>
      </section>

      <Dialog
        open={facesOpen}
        title="対象者を確認"
        description={faces?.matched != null ? `送る予定 ${countLabel(faces.matched, '人')}の先頭${faces.sample.length}人です。` : undefined}
        onCancel={() => setFacesOpen(false)}
      >
        {!faces || faces.loading
          ? <p className={styles.fieldNote}>数えています…</p>
          : faces.error
            ? <p className={styles.fieldNote}>{faces.error}</p>
            : faces.sample.length === 0
              ? <p className={styles.fieldNote}>条件に当てはまる人がまだいません。条件をゆるめるとここに出ます。</p>
              : <ul className={styles.diffList}>{faces.sample.map((friend) => <li key={friend.id}>{friend.displayName}</li>)}</ul>}
      </Dialog>
    </CreatePage>
  )
}

/* ---------------- 手順3：通知の中身（p5YuP・1152 は r1l0bT） ---------------- */

const MAX_STEPS = 10
const BODY_LIMIT = 5000

function MessagesStageV8({
  frame,
  notice,
  narrow,
  settings,
  onChange,
  busy,
  onNext,
  onSaveDraft,
  onCancel,
}: {
  frame: StageFrame
  notice: ReactNode
  /** 1152 の板（r1l0bT）：右の列は「LINEでの見え方を見る」と例だけにし、スマホは横から出す。 */
  narrow: boolean
  settings: ReminderDraftSettings
  onChange: (value: ReminderDraftSettings) => void
  busy: boolean
  onNext: () => void
  onSaveDraft: () => void
  onCancel: () => void
}) {
  const { selectedAccount, selectedAccountId } = useAccount()
  const [selectedStepId, setSelectedStepId] = useState<string | null>(settings.steps[0]?.stableStepId ?? null)
  const [fields, setFields] = useState<FriendField[]>([])
  const [phoneOpen, setPhoneOpen] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const sampleBase = useRef<Date>(sampleBaseDate())

  useEffect(() => {
    if (!selectedAccountId) return
    const accountId = selectedAccountId
    void api.friendFields.list(accountId).then((res) => {
      if (res.success) setFields(res.data)
    }).catch(() => undefined)
  }, [selectedAccountId])

  const selectedIndex = settings.steps.findIndex((step) => step.stableStepId === selectedStepId)
  const selectedStep = (selectedIndex >= 0 ? settings.steps[selectedIndex] : settings.steps[0]) ?? null
  const allStepsHaveContent = settings.steps.length > 0
    && settings.steps.every((step) => Boolean(step.templateId || step.messageContent.trim()))

  const updateStep = (stableStepId: string, patch: Partial<ReminderDraftStep>) => {
    onChange({
      ...settings,
      steps: settings.steps.map((step) => step.stableStepId === stableStepId ? { ...step, ...patch } : step),
    })
  }

  const addStep = () => {
    const step: ReminderDraftStep = {
      stableStepId: crypto.randomUUID(),
      offsetMinutes: 0,
      offsetDays: 0,
      sendAtTime: '09:00',
      messageType: 'text',
      messageContent: '',
    }
    onChange({ ...settings, steps: [...settings.steps, step] })
    setSelectedStepId(step.stableStepId)
  }

  const removeStep = (stableStepId: string) => {
    if (settings.steps.length <= 1) return
    onChange({ ...settings, steps: settings.steps.filter((step) => step.stableStepId !== stableStepId) })
    if (selectedStepId === stableStepId) setSelectedStepId(null)
  }

  /*
   * 通知の並べ替え（共通の並び替え）。つまみのドラッグ・上下キー・「前へ／後ろへ」は
   * どれも同じ入口で並びを変える。
   */
  const stepOrder = useReorder({
    items: settings.steps,
    idOf: (step) => step.stableStepId,
    disabledReason: settings.steps.length < 2 ? '通知が1つのときは並び替えできません' : null,
    onReorder: ({ ids }) => {
      const byId = new Map(settings.steps.map((step) => [step.stableStepId, step]))
      const steps = ids.map((id) => byId.get(id)).filter((step): step is typeof settings.steps[number] => Boolean(step))
      if (steps.length === settings.steps.length) onChange({ ...settings, steps })
    },
  })

  /** 差し込みをカーソルの位置に入れる。 */
  const insertToken = (token: string) => {
    if (!selectedStep) return
    const area = bodyRef.current
    const value = selectedStep.messageContent
    const start = area?.selectionStart ?? value.length
    const end = area?.selectionEnd ?? value.length
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`.slice(0, BODY_LIMIT)
    updateStep(selectedStep.stableStepId, { messageContent: next })
    requestAnimationFrame(() => {
      area?.focus()
      const caret = Math.min(start + token.length, next.length)
      area?.setSelectionRange(caret, caret)
    })
  }

  const phone = (
    <PhoneV8
      accountName={selectedAccount?.name ?? 'LINE公式アカウント'}
      chip={selectedStep ? formatMd(exampleSendAt(selectedStep, settings.deliveryMode, sampleBase.current)) : '通知はまだありません'}
      empty={!selectedStep}
      message={selectedStep ? (selectedStep.messageContent ? renderReminderBodySample(selectedStep.messageContent) : '本文を入力すると、ここに表示例が出ます。') : undefined}
    />
  )

  const examples = (
    <section className={styles.sideBox} aria-label="届く日時の例">
      <h2 className={styles.sideBoxTitle}>届く日時の例</h2>
      <p className={styles.sideBoxNote}>{formatJpDay(sampleBase.current)} に{settings.triggerType === 'friend_field' ? '基準日がある' : '予約した'}人</p>
      <dl className={styles.sideRows}>
        {settings.steps.map((step, index) => (
          <div key={step.stableStepId} className={styles.sideRow}>
            <dt>{index + 1}通目</dt>
            <dd>{formatMd(exampleSendAt(step, settings.deliveryMode, sampleBase.current))}</dd>
          </div>
        ))}
      </dl>
      {settings.steps.length === 0 ? <p className={styles.sideBoxNote}>通知を足すと、ここに届く日時の例が出ます。</p> : null}
    </section>
  )

  return (
    <>
      <CreatePage
        {...frame}
        preview={narrow ? (
          <div className={styles.narrowSide}>
            <Button type="button" className={styles.wideButton} onClick={() => setPhoneOpen(true)}>
              <Smartphone size={15} aria-hidden="true" />LINEでの見え方を見る
            </Button>
            {examples}
          </div>
        ) : (
          <>
            {examples}
            {phone}
          </>
        )}
        footerActions={(
          <WizardFooterV8
            onCancel={onCancel}
            cancelDisabled={busy}
            onDraft={onSaveDraft}
            draftBusy={busy}
            nextLabel="次へ：配信予定"
            nextIcon={<ArrowRight size={15} aria-hidden="true" />}
            onNext={onNext}
            nextDisabled={busy || !allStepsHaveContent}
          />
        )}
      >
        {notice}
        <section className={styles.card} aria-labelledby="rm-steps-title">
          <div className={styles.cardHead}>
            <h2 id="rm-steps-title" className={styles.cardTitle}>通知</h2>
            <p className={styles.cardNote}>基準日に近い順に並びます。最大 {MAX_STEPS} 通</p>
          </div>
          {settings.steps.length === 0 ? (
            <p className={styles.fieldNote}>通知はまだありません。「通知を足す」で1通目を作成してください。本文が入るまで次へは進めません。</p>
          ) : null}
          {stepOrder.shown.map((step, index) => {
            const open = step.stableStepId === (selectedStep?.stableStepId ?? null)
            return (
              <div key={step.stableStepId} className={styles.stepCard} data-open={open || undefined} {...stepOrder.rowProps(step.stableStepId)}>
                <div className={styles.stepHead}>
                  <ReorderHandle
                    look="bare"
                    className={styles.grip}
                    label={`${index + 1}通目の通知`}
                    {...stepOrder.handle(step.stableStepId)}
                    {...stepOrder.handleProps(step.stableStepId)}
                  >
                    <GripVertical size={16} aria-hidden="true" />
                  </ReorderHandle>
                  <span className={styles.stepNum}>{index + 1}</span>
                  <button
                    type="button"
                    className={styles.stepTiming}
                    aria-expanded={open}
                    onClick={() => setSelectedStepId(open ? null : step.stableStepId)}
                  >
                    {stepShortTiming(step, settings.deliveryMode)}
                  </button>
                  <span className={styles.spacer} aria-hidden="true" />
                  <Button type="button" variant="text" disabled={!stepOrder.canMoveBy(step.stableStepId, -1)} onClick={() => stepOrder.moveBy(step.stableStepId, -1, 'menu')}>
                    <ArrowUp size={15} aria-hidden="true" />前へ
                  </Button>
                  <Button type="button" variant="text" disabled={!stepOrder.canMoveBy(step.stableStepId, 1)} onClick={() => stepOrder.moveBy(step.stableStepId, 1, 'menu')}>
                    <ArrowDown size={15} aria-hidden="true" />後ろへ
                  </Button>
                  <Button type="button" variant="text" disabled={settings.steps.length <= 1} onClick={() => removeStep(step.stableStepId)}>
                    <Trash2 size={15} aria-hidden="true" />消す
                  </Button>
                </div>
                {open ? (
                  <>
                    <TimingEditor
                      step={step}
                      mode={settings.deliveryMode}
                      base={sampleBase.current}
                      onChange={(patch) => updateStep(step.stableStepId, patch)}
                    />
                    <div className={styles.bodyBox}>
                      <TextArea
                        ref={bodyRef}
                        className={styles.bodyArea}
                        value={step.messageContent}
                        maxLength={BODY_LIMIT}
                        aria-label={`${index + 1}通目の本文`}
                        placeholder="友だちに届く本文を書きます"
                        onChange={(event) => updateStep(step.stableStepId, { messageContent: event.target.value })}
                      />
                      <span className={styles.bodyGap} aria-hidden="true" />
                      <div className={styles.insertRow}>
                        <span className={styles.insertLabel}>差し込む</span>
                        <Button type="button" variant="text" onClick={() => insertToken('{{name}}')}>
                          <User size={15} aria-hidden="true" />名前
                        </Button>
                        <Button type="button" variant="text" onClick={() => insertToken('{{date}}')}>
                          <CalendarDays size={15} aria-hidden="true" />予約日時
                        </Button>
                        <Button type="button" variant="text" onClick={() => insertToken('{{meet_url}}')}>
                          <Video size={15} aria-hidden="true" />Google Meet の URL
                        </Button>
                        {narrow ? null : (
                          <>
                            <FieldInsert fields={fields} onInsert={insertToken} />
                            <span className={styles.spacer} aria-hidden="true" />
                            <span className={styles.charCount}>{formatNumber(step.messageContent.length)} / {formatNumber(BODY_LIMIT)}</span>
                          </>
                        )}
                      </div>
                      {narrow ? (
                        <div className={styles.insertRow}>
                          <FieldInsert fields={fields} onInsert={insertToken} />
                          <span className={styles.spacer} aria-hidden="true" />
                          <span className={styles.charCount}>{formatNumber(step.messageContent.length)} / {formatNumber(BODY_LIMIT)}</span>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <button type="button" className={styles.stepPreview} onClick={() => setSelectedStepId(step.stableStepId)}>
                    {(step.messageContent || '本文はまだありません').split('\n')[0]}…
                  </button>
                )}
              </div>
            )
          })}
          <div>
            <Button type="button" variant="text" onClick={addStep} disabled={settings.steps.length >= MAX_STEPS}>
              <Plus size={15} aria-hidden="true" />通知を足す
            </Button>
          </div>
        </section>
      </CreatePage>
      <DetailPanel open={phoneOpen} title="LINEでの見え方" onClose={() => setPhoneOpen(false)}>{phone}</DetailPanel>
    </>
  )
}

/** 「友だち情報」を差し込む。押すと情報欄の一覧から選ぶ（ボタン＋メニュー）。 */
function FieldInsert({ fields, onInsert }: { fields: FriendField[]; onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const items: ActionMenuItem[] = fields.length > 0
    ? fields.map((field) => ({ id: field.id, label: field.name, onSelect: () => { onInsert(`{{field.${field.fieldKey}}}`); setOpen(false) } }))
    : [{ id: 'none', label: '友だち情報欄がありません', disabled: true, disabledReason: '友だち情報欄を作ると差し込めます', onSelect: () => {} }]
  return (
    <span ref={anchorRef} className={styles.fieldInsert}>
      <Button type="button" variant="text" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <IdCard size={15} aria-hidden="true" />友だち情報
      </Button>
      <ActionMenu open={open} onClose={() => setOpen(false)} ariaLabel="差し込む友だち情報" items={items} anchorRef={anchorRef} />
    </span>
  )
}

type TimingUnit = 'day' | 'hour' | 'min'

/**
 * 「基準日の [1] [日] [前] の [18:00]」の入力行（絵 p5YuP・r1l0bT）。
 * 日で書く通（○日前の●時）と、時間・分で書く通（1時間前など）を単位で切り替える。
 * 日 → 時間・分にすると時刻は外れ、分の数で持つ。逆は 9:00 を入れる。
 */
function TimingEditor({
  step,
  mode,
  base,
  onChange,
}: {
  step: ReminderDraftStep
  mode: ReminderDraftSettings['deliveryMode']
  base: Date
  onChange: (patch: Partial<ReminderDraftStep>) => void
}) {
  const dayWritten = mode === 'time' && step.offsetDays != null && step.sendAtTime != null
  const minutes = step.offsetMinutes ?? 0
  const abs = Math.abs(minutes)
  const unit: TimingUnit = dayWritten ? 'day' : abs % 1440 === 0 && abs > 0 ? 'day' : abs % 60 === 0 ? 'hour' : 'min'
  const amount = dayWritten ? Math.abs(step.offsetDays ?? 0) : unit === 'day' ? abs / 1440 : unit === 'hour' ? abs / 60 : abs
  const after = dayWritten ? (step.offsetDays ?? 0) > 0 : minutes > 0
  const sign = (value: number, isAfter: boolean) => (isAfter ? value : -value)

  /** 数・単位・前後から、保存する形（日で書く／分で書く）を作る。 */
  const build = (n: number, u: TimingUnit, isAfter: boolean): Partial<ReminderDraftStep> => {
    if (mode === 'time' && u === 'day') {
      return { offsetDays: sign(n, isAfter), sendAtTime: step.sendAtTime ?? '09:00', offsetMinutes: 0 }
    }
    const per = u === 'day' ? 1440 : u === 'hour' ? 60 : 1
    return { offsetDays: null, sendAtTime: null, offsetMinutes: sign(n * per, isAfter) }
  }

  const example = exampleSendAt(step, mode, base)

  return (
    <div className={styles.timingRow}>
      <span className={styles.timingWord}>基準日の</span>
      <TextField
        type="number"
        min={0}
        max={unit === 'day' ? 365 : undefined}
        aria-label="基準日からの数"
        className={styles.timingDays}
        value={String(amount)}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isInteger(next) && next >= 0) onChange(build(next, unit, after))
        }}
      />
      <Select
        value={unit}
        onChange={(next) => onChange(build(amount, next as TimingUnit, after))}
        aria-label="単位"
        width={72}
        options={[{ value: 'day', label: '日' }, { value: 'hour', label: '時間' }, { value: 'min', label: '分' }]}
      />
      <Select
        value={after ? 'after' : 'before'}
        onChange={(next) => onChange(build(amount, unit, next === 'after'))}
        aria-label="基準日の前か後か"
        width={72}
        options={[{ value: 'before', label: '前' }, { value: 'after', label: '後' }]}
      />
      {dayWritten ? (
        <>
          <span className={styles.timingWord}>の</span>
          <TimeField
            aria-label="送る時刻"
            className={styles.timingTime}
            value={step.sendAtTime ?? ''}
            onChange={(next) => onChange({ sendAtTime: next || null })}
          />
        </>
      ) : null}
      <span className={styles.spacer} aria-hidden="true" />
      <span className={styles.timingExample}>{`例：${formatShort(base)} の予約 → ${formatShort(example)} に届く`}</span>
    </div>
  )
}

/* ---------------- 手順4：配信予定（T0nis） ---------------- */

function ScheduleStageV8({
  frame,
  notice,
  reminderId,
  settings,
  preview,
  previewFailed = false,
  onRetryPreview,
  onNext,
  onSaveDraft,
  busy,
  onCancel,
}: {
  frame: StageFrame
  notice: ReactNode
  reminderId: string
  settings: ReminderDraftSettings
  preview: ReminderPreviewResult | null
  previewFailed?: boolean
  onRetryPreview?: () => void
  onNext: () => void
  onSaveDraft: () => void
  busy: boolean
  onCancel: () => void
}) {
  const { selectedAccount } = useAccount()
  const [range, setRange] = useState<'7d' | '30d' | 'conflict'>('7d')
  const items = preview?.items ?? []
  const now = Date.now()
  const rows = items.filter((item) => {
    if (range === 'conflict') return item.state === 'duplicate'
    const at = Date.parse(item.scheduledAt)
    return at > now && at <= now + (range === '7d' ? 7 : 30) * 86_400_000
  })
  const rangeCount = range === '7d' ? preview?.summary.next7Days ?? null : range === '30d' ? preview?.summary.next30Days ?? null : preview ? preview.summary.duplicateCount : null
  const nextItem = items.find((item) => item.state === 'scheduled') ?? null
  const messagesHref = `/reminders/edit?id=${encodeURIComponent(reminderId)}`

  return (
    <CreatePage
      {...frame}
      preview={(
        <>
          <SummaryCardV8
            rows={[
              { key: '基準日', value: reminderTriggerLabel(settings.triggerType) },
              { key: '対象者', value: preview ? countLabel(preview.summary.audience, '人') : '—' },
              { key: '通知', value: `${settings.steps.length}通` },
              { key: '状態', value: '下書き' },
            ]}
          />
          <PhoneV8
            accountName={selectedAccount?.name ?? 'LINE公式アカウント'}
            chip={nextItem ? formatMd(nextItem.scheduledAt) : '送信予定はまだありません'}
            empty={!nextItem}
            message={nextItem ? renderReminderBodySample(firstReminderStepMessage(settings, nextItem.stableStepId) || '本文はまだありません') : undefined}
          />
        </>
      )}
      footerActions={(
        <WizardFooterV8
          onCancel={onCancel}
          cancelDisabled={busy}
          onDraft={onSaveDraft}
          draftBusy={busy}
          nextLabel="次へ：確認"
          nextIcon={<ArrowRight size={15} aria-hidden="true" />}
          onNext={onNext}
          nextDisabled={busy || settings.steps.length === 0}
        />
      )}
    >
      {notice}
      <section className={styles.card} aria-labelledby="rm-schedule-title">
        <div className={styles.cardHead}>
          <h2 id="rm-schedule-title" className={styles.cardTitle}>これから送る予定</h2>
          <p className={styles.cardNote}>有効にしたら、この予定で送ります。予約が変わると予定も変わります。</p>
        </div>
        <div className={styles.rangeRow}>
          <SegmentedControl
            aria-label="予定の範囲"
            options={[
              { value: '7d', label: '今後7日' },
              { value: '30d', label: '今後30日' },
              { value: 'conflict', label: '重なりだけ' },
            ]}
            value={range}
            onChange={setRange}
          />
          <span className={styles.spacer} aria-hidden="true" />
          <span className={styles.rangeCount}>
            {range === 'conflict' ? `重なり ${countLabel(rangeCount, '件')}` : `${range === '7d' ? '今後7日' : '今後30日'} ${countLabel(rangeCount, '通')}`}
          </span>
        </div>
        {settings.steps.length === 0 ? (
          <ListState kind="empty" title="送る通知がまだありません" description="通知の中身（手順3）で本文を作成してから、配信予定を確認してください。" action={<Button href={messagesHref}>通知の中身へ</Button>} />
        ) : previewFailed ? (
          <ListState kind="error" title="配信予定を確認できませんでした" description="通信または権限を確認して、もう一度お試しください。" onRetry={onRetryPreview} />
        ) : !preview ? (
          <ListState kind="loading" title="配信予定を確認しています" />
        ) : rows.length === 0 ? (
          <ListState kind="empty" title="条件に合う送信予定はありません" />
        ) : (
          <div className={styles.planTable} role="table" aria-label="これから送る予定">
            <div className={styles.planHead} role="row">
              <span role="columnheader" className={styles.colWhen}>送る日時</span>
              <span role="columnheader" className={styles.colWho}>友だち</span>
              <span role="columnheader" className={styles.colStep}>通知</span>
              <span role="columnheader" className={styles.colState}>状態</span>
            </div>
            {rows.map((item, index) => (
              <div key={`${item.stableStepId}-${index}`} role="row" className={styles.planRow} data-warn={item.state === 'duplicate' || undefined}>
                <span role="cell" className={styles.colWhen}>{formatMd(item.scheduledAt)}</span>
                <span role="cell" className={`${styles.colWho} ${styles.planWho}`} title={`対象になる人 全員（${countLabel(preview.summary.audience, '人')}）`}>
                  {`対象になる人 全員（${countLabel(preview.summary.audience, '人')}）`}
                </span>
                <span role="cell" className={styles.colStep}>{item.stepNumber}通目</span>
                <span role="cell" className={styles.colState} data-tone={item.state === 'duplicate' ? 'warn' : undefined}>
                  {item.state === 'duplicate' ? '重なり→1通にまとめる' : item.state === 'past' ? '基準日が過去' : '送る予定'}
                </span>
              </div>
            ))}
          </div>
        )}
        {preview && preview.summary.duplicateCount > 0 ? (
          <p className={styles.infoBand}>
            <Layers size={16} aria-hidden="true" />
            同じ時刻に送る通知は、止めずに1通にまとめて送ります（{formatNumber(preview.summary.duplicateCount)}件）。まとめたくないときは時刻をずらしてください。
          </p>
        ) : null}
      </section>
    </CreatePage>
  )
}

/* ---------------- 手順5：確認（ltAaq）＝ 設定の確認・テスト送信・有効にする前の確認 ---------------- */

function editHref(reminderId: string, stage: 'basics' | 'target' | 'preview' | null): string {
  return `/reminders/edit?id=${encodeURIComponent(reminderId)}${stage ? `&stage=${stage}` : ''}`
}

function ConfirmStageV8({
  frame,
  notice,
  reminderId,
  draft,
  settings,
  validation,
  validationFailed = false,
  onRetryValidation,
  preview,
  previewFailed = false,
  recipientView,
  onRecipientRecheck,
  sentName,
  sentKind,
  sendBusy,
  onSend,
  busy,
  publishReady,
  onPublish,
  onSaveDraft,
  onCancel,
}: {
  frame: StageFrame
  notice: ReactNode
  reminderId: string
  draft: ReminderDraftVersion
  settings: ReminderDraftSettings
  validation: ReminderValidationResult | null
  validationFailed?: boolean
  onRetryValidation?: () => void
  preview: ReminderPreviewResult | null
  previewFailed?: boolean
  recipientView: ReturnType<typeof useReminderTestRecipient>['view']
  onRecipientRecheck: () => void
  sentName: string | null
  sentKind: 'self' | 'registered' | null
  sendBusy: boolean
  onSend: () => void
  busy: boolean
  publishReady: boolean
  onPublish: () => void
  onSaveDraft: () => void
  onCancel: () => void
}) {
  const { selectedAccount } = useAccount()
  const [folderName, setFolderName] = useState<string>('')

  // フォルダ名の解決だけ。一覧は確認の段でしか要らない。
  useEffect(() => {
    if (!settings.folderId) {
      setFolderName('')
      return
    }
    let active = true
    void api.folders.list('reminder').then((res) => {
      if (!active) return
      if (res.success) setFolderName(res.data.find((folder) => folder.id === settings.folderId)?.name ?? '')
    }).catch(() => undefined)
    return () => { active = false }
  }, [settings.folderId])

  const destination = testRecipientDestinationLabel(recipientView, sentName, sentKind)
  const firstStep = settings.steps[0] ?? null
  const testedLabel = draft.lastTestStatus === 'succeeded' && draft.lastTestedAt
    ? `前回：${formatMd(draft.lastTestedAt)} に送れました（1通目）`
    : null

  const checkStageFor = (key: string): 'basics' | 'target' | 'preview' | null => {
    if (key === 'steps' || key === 'messages' || key === 'duplicate_schedule') return null
    if (key === 'stop_conditions') return 'target'
    return 'basics'
  }

  const confirmRows: Array<{ key: string; value: string; stage: 'basics' | 'target' | 'preview' | null }> = [
    { key: '名前・フォルダ', value: `${settings.name}${folderName ? `・${folderName}` : ''}`, stage: 'basics' },
    { key: '基準日', value: reminderTriggerLabel(settings.triggerType), stage: 'basics' },
    {
      key: '対象者',
      value: `${pruneCondition(settings.targetCondition as SegmentCondition | null) ? '条件に合う人だけ' : '基準日がある人すべて'}${validation?.audience.matched != null ? `（${formatNumber(validation.audience.matched)}人に送る予定）` : ''}`,
      stage: 'target',
    },
    { key: '止める条件', value: reminderStopSummary(settings.stopConditions), stage: 'target' },
    { key: '通知', value: reminderStepTimings(settings), stage: null },
    {
      key: '配信予定',
      value: preview
        ? `今後7日 ${countLabel(preview.summary.next7Days, '通')}${preview.summary.duplicateCount > 0 ? `（重なり ${formatNumber(preview.summary.duplicateCount)}件はまとめる）` : ''}`
        : previewFailed ? '読み込めませんでした' : '確認中',
      stage: 'preview',
    },
  ]

  return (
    <CreatePage
      {...frame}
      preview={(
        <>
          <SummaryCardV8
            rows={[
              { key: '基準日', value: reminderTriggerLabel(settings.triggerType) },
              { key: '対象者', value: validation?.audience.matched != null ? `${formatNumber(validation.audience.matched)}人` : '—' },
              { key: '通知', value: `${settings.steps.length}通` },
              { key: '状態', value: '下書き → 有効にする' },
            ]}
          />
          <PhoneV8
            accountName={selectedAccount?.name ?? 'LINE公式アカウント'}
            chip={firstStep ? `1通目は ${describeReminderTiming(firstStep, settings.deliveryMode)}に届きます` : '通知ステップがありません'}
            empty={!firstStep}
            message={firstStep ? renderReminderBodySample(firstStep.messageContent || '本文はまだありません') : undefined}
          />
        </>
      )}
      footerActions={(
        <WizardFooterV8
          onCancel={onCancel}
          cancelDisabled={busy}
          draftLabel="下書きのまま保存"
          onDraft={onSaveDraft}
          draftBusy={busy}
          nextLabel="有効にする"
          nextIcon={<Power size={15} aria-hidden="true" />}
          onNext={onPublish}
          nextDisabled={busy || !publishReady}
          nextBusy={busy}
        />
      )}
    >
      {notice}
      <section className={styles.card} aria-labelledby="rm-confirm-title">
        <div className={styles.cardHead}>
          <h2 id="rm-confirm-title" className={styles.cardTitle}>設定の確認</h2>
        </div>
        <div className={styles.confirmRows}>
          {confirmRows.map((row) => (
            <div key={row.key} className={styles.confirmRow}>
              <span className={styles.confirmKey}>{row.key}</span>
              <span className={styles.confirmVal} title={row.value}>{row.value}</span>
              <Button variant="text" href={editHref(reminderId, row.stage)}>変える</Button>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.card} aria-labelledby="rm-test-title">
        <div className={styles.cardHead}>
          <h2 id="rm-test-title" className={styles.cardTitle}>テストを送る</h2>
          <p className={styles.cardNote}>{testRecipientNote(recipientView, sentKind)}</p>
        </div>
        <div className={styles.testRow}>
          <span className={styles.testDestination} aria-label="送り先">送り先：{destination}</span>
          <Button variant="secondary" onClick={onSend} disabled={sendBusy || recipientView.kind !== 'ready'} busy={sendBusy} busyLabel="送信中…">
            <Send size={15} aria-hidden="true" />テストを送る
          </Button>
        </div>
        {testedLabel ? <p className={styles.testResult}>{testedLabel}</p> : null}
        <TestRecipientGuidance view={recipientView} accountId={settings.lineAccountId} onRecheck={onRecipientRecheck} />
      </section>

      <section className={styles.card} aria-labelledby="rm-check-title">
        <div className={styles.cardHead}>
          <h2 id="rm-check-title" className={styles.cardTitle}>有効にする前の確認</h2>
        </div>
        {!validation ? (
          validationFailed ? (
            <ListState kind="error" title="有効化前チェックを実行できませんでした" description="チェックが通るまで有効にはできません。通信を確認して、もう一度お試しください。" onRetry={onRetryValidation} />
          ) : (
            <ListState kind="loading" title="有効化前チェックを実行しています" />
          )
        ) : (
          <div className={styles.checkList}>
            <CheckRow
              ok={draft.lastTestStatus === 'succeeded'}
              title="テストを送った"
              note={draft.lastTestStatus === 'succeeded'
                ? `1通目を${sentKind === 'self' ? '自分' : sentKind === 'registered' ? '登録済みテスト宛先' : 'テスト送信先'}に送れました`
                : 'まだ送れていません。上の「テストを送る」から送ってください'}
            />
            <CheckRow
              ok={validation.audience.matched != null}
              title="対象者を数えた"
              note={validation.audience.matched != null ? `${formatNumber(validation.audience.matched)}人に送る予定` : '対象者を数えられませんでした'}
              action={<Button variant="text" href={editHref(reminderId, 'target')}>見直す</Button>}
            />
            {validation.checks.filter((check) => check.key !== 'test_send').map((check) => (
              <CheckRow
                key={check.key}
                ok={check.status === 'passed'}
                title={check.label}
                note={check.message}
                action={check.status !== 'passed' ? <Button variant="text" href={editHref(reminderId, checkStageFor(check.key))}>直す</Button> : undefined}
              />
            ))}
          </div>
        )}
      </section>
    </CreatePage>
  )
}

function CheckRow({ ok, title, note, action }: { ok: boolean; title: string; note: string; action?: ReactNode }) {
  return (
    <div className={styles.checkRow}>
      <span className={styles.checkIcon} data-ok={ok || undefined}>
        {ok ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
      </span>
      <span className={styles.checkText}>
        <span className={styles.checkTitle}>{title}</span>
        <span className={styles.checkNote}>{note}</span>
      </span>
      {action}
    </div>
  )
}

/* ---------------- 完了（hjNpJ） ---------------- */

function DoneStageV8({
  frame,
  reminderId,
  settings,
  published,
  preview,
}: {
  frame: StageFrame
  reminderId: string
  settings: ReminderDraftSettings
  published: ReminderPublishResult | null
  preview: ReminderPreviewResult | null
}) {
  const nextScheduledAt = published?.nextScheduledAt
    ?? preview?.items.find((item) => item.state === 'scheduled')?.scheduledAt
    ?? null
  const next7 = preview?.summary.next7Days ?? published?.plannedDeliveries ?? null
  const { boardId, ...heading } = frame

  // 完了には下の帯が無い（絵 hjNpJ）。型の枠と頭はそのまま使い、本文だけ真ん中のカードにする。
  return (
    <PageFrame kind="create" boardId={boardId}>
      <PageHeading {...heading} />
      <div className={styles.doneBody}>
        <div className={styles.doneCard}>
          <span className={styles.doneIcon}>
            <CheckCircle2 size={24} aria-hidden="true" />
          </span>
          <h2 className={styles.doneTitle}>「{settings.name}」を有効にしました</h2>
          <p className={styles.doneNote}>
            これから{settings.triggerType === 'friend_field' ? '基準日が入った人' : '予約が入った人'}にも、自動で予定が作られます。止めたいときは、詳細の「一時停止する」から止められます。
          </p>
          <dl className={styles.doneFacts}>
            <div className={styles.doneFact}>
              <dt>最初に送る</dt>
              <dd>{nextScheduledAt ? formatMd(nextScheduledAt) : '予定なし'}</dd>
            </div>
            <div className={styles.doneFact}>
              <dt>今後7日</dt>
              <dd>{countLabel(next7, '通')}</dd>
            </div>
          </dl>
          <div className={styles.doneActions}>
            <Button href="/reminders"><List size={15} aria-hidden="true" />一覧へ戻る</Button>
            <Button variant="secondary" href={`/reminders/detail?id=${encodeURIComponent(reminderId)}&status=planned`}>
              <CalendarClock size={15} aria-hidden="true" />配信予定を見る
            </Button>
            <Button variant="primary" href={`/reminders/detail?id=${encodeURIComponent(reminderId)}`}>
              <ArrowRight size={15} aria-hidden="true" />詳細を見る
            </Button>
          </div>
        </div>
      </div>
    </PageFrame>
  )
}
