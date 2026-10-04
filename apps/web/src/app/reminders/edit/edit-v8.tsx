'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  CircleUser,
  ListChecks,
  Power,
  Send,
  SlidersHorizontal,
  Trash2,
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
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { TextArea, TextInput } from '@/components/shared/form-controls'
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
} from '../basics-form-v8'
import { ChoiceCardV8, PhoneAsideV8, SummaryCardV8, WizardFooterV8, WizardHeadV8 } from '../wizard-v8-ui'
import { describeReminderDiff } from './reminder-conflict-diff'
import styles from '../wizard-v8.module.css'
import { formatNumber } from '@/lib/format'

/*
 * ★V8 リマインダを作る・手順2〜5と完了。
 * 板：YChR6（対象者と止める条件）/ p5YuP（通知の中身）/ T0nis（配信予定）/
 *     ltAaq（確認＝設定確認・テスト送信・有効化前チェック）/ hjNpJ（有効化完了）。
 *
 * URL の ?stage= との対応（V7 の stage 名をそのまま使う）：
 *   basics → 手順1の直し / target → 手順2 / （なし）→ 手順3 /
 *   preview → 手順4 / test・confirm → 手順5（テスト送信は確認の中）/
 *   done → 完了。
 * 「data-theme="v8"」の下だけで描く。V7 の reminder-publish-flow は触らない。
 */

type V8Stage = 'basics' | 'target' | 'messages' | 'schedule' | 'confirm' | 'done'

function stageFor(raw: string | null): V8Stage {
  switch (raw) {
    case 'basics':
      return 'basics'
    case 'target':
      return 'target'
    case 'preview':
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

/** 「10月2日(木) 14:00」の形。 */
function formatJpDay(value: Date): string {
  return `${value.getMonth() + 1}月${value.getDate()}日(${WEEKDAYS_JA[value.getDay()]})`
}

/** 届く日時の例に使う見本の基準日。3日後の14:00（JST相当の端末時計）。 */
function sampleBaseDate(): Date {
  const base = new Date()
  base.setDate(base.getDate() + 3)
  base.setHours(14, 0, 0, 0)
  return base
}

/** 届く時刻を計算する。入力の片付け（時間だけ・日だけ）は resolveReminderSendAt が従来の分に落とす。 */
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

/*
 * 1152 幅の板の印（V8.pen の地図）。板が 1100px を切ったら（画面幅で約 1352px
 * 未満）、手順③の外枠に 1152 の板 ID を付ける。数える側は印で数える。
 */
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

export default function ReminderEditV8({ reminderId, stage }: { reminderId: string; stage: string | null }) {
  const v8stage = stageFor(stage)
  /* 手順③だけ：1152 幅なら板 `r1l0bT`。ほかの手順は今の印のまま。 */
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
   * 基本設定の入力値は段ローカルに持たせずここで持つ。
   * basicsToDraft は保存の直前にだけ通す（trim が打鍵を消すため、
   * 打つたびに settings へ戻すと空白が入らなくなる）。dirty 判定は
   * 「いまの value」対「保存済み下書きから戻した value」で取る。
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
  // 編集の競合（`k32cn`）。入力は捨てず、比べる・読み込むを選んでもらう。
  const [compareTarget, setCompareTarget] = useState<ReminderDraftSettings | null>(null)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareError, setCompareError] = useState('')
  const [testConfirm, setTestConfirm] = useState(false)
  const requestSeq = useRef(0)

  // テスト送信の口は確認の段だけ開く。ほかの段で余計なGETを打たない。
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

  // `k32cn`「最新を読み込んで続ける」。入力中の内容は最新の版で置き換わる。
  const reloadAfterConflict = async () => {
    setCompareTarget(null)
    setCompareError('')
    setError('')
    await loadDraft()
  }

  // `k32cn`「違いを比べる」。最新を取って比べるだけで、画面は書き換えない。
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

  // 配信予定は「これから」の段と「完了」の段で読む。
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

  // 公開前チェックは対象・確認・完了の段で読む。
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

  /*
   * R145 監査：入力欄を持つ段（基本・対象・通知）は書きかけを
   * 「未保存の変更あり」として守る。読むだけの段では番兵は寝かせる。
   */
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

  /** 下書きを保存する。409 は読み直し導線へ出す。 */
  async function saveSettings(next: ReminderDraftSettings): Promise<boolean> {
    setBusy(true)
    setError('')
    setConflict(false)
    try {
      const response = await api.reminders.saveDraft(
        reminderId,
        next,
        // R148 監査：開いたときの版IDと版時刻を送り、別画面の先勝ちは止める。
        draft ? { expectedVersionId: draft.versionId, expectedUpdatedAt: draft.updatedAt } : {},
      )
      if (!response.success) throw new Error(response.error)
      setDraft(response.data)
      setSettings(response.data.settings)
      setBasics(basicsFromDraft(response.data.settings))
      return true
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setConflict(true)
        setError('この下書きは別の画面で先に更新されました。最新の内容を読み直してください。')
      } else {
        setError('保存できませんでした。')
      }
      return false
    } finally {
      setBusy(false)
    }
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
    // 確定失敗・結果不明は窓を開いたままにし、エラーは窓の中に出す。
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

  const currentKey = v8stage === 'done' ? 'done' as const
    : v8stage === 'basics' ? 'basics' as const
      : v8stage === 'target' ? 'target' as const
        : v8stage === 'messages' ? 'messages' as const
          : v8stage === 'schedule' ? 'schedule' as const
            : 'confirm' as const

  // 外枠に板 ID を持たせる（見本と突き合わせる目印）。
  // 手順③（通知の中身）は 1152 幅なら板 `r1l0bT`。
  const designNode = v8stage === 'basics' ? 'VE1u5'
    : v8stage === 'target' ? 'YChR6'
      : v8stage === 'messages' ? (narrowBoard ? 'r1l0bT' : 'p5YuP')
        : v8stage === 'schedule' ? 'T0nis'
          : v8stage === 'confirm' ? 'ltAaq'
            : 'hjNpJ'

  return (
    <div className={styles.page} data-design-node={designNode} data-reminder-v8-stage={v8stage}>
      <WizardHeadV8
        title="リマインダを作る"
        current={currentKey}
        reminderId={reminderId}
      />
      <p className={styles.subline}>
        {v8stage === 'done' ? `名前：${subjectSettings.name}` : `名前：${subjectSettings.name}・いまは下書きです`}
      </p>
      {conflict ? (
        <div className="border-accent bg-accent-soft rounded-card flex flex-wrap items-center gap-3 border p-4" data-design-node="k32cn" role="alert">
          <p className="text-ink min-w-0 flex-1 text-sm">
            ほかの人が先に保存しました。
            <span className="text-ink-secondary mt-0.5 block text-xs">
              あなたが直した所はまだ保存されていません。このまま保存すると、相手の変更が消えます。
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void openCompare()} disabled={compareBusy}>
              {compareBusy ? '比べています...' : '違いを比べる'}
            </Button>
            <Button type="button" variant="primary" onClick={() => void reloadAfterConflict()}>
              最新を読み込んで続ける
            </Button>
          </div>
        </div>
      ) : (error || (!testConfirm && testIssue && v8stage === 'confirm')) ? (
        <Notice tone="danger">
          {error || testIssue}
        </Notice>
      ) : null}

      {v8stage === 'basics' ? (
        <BasicsStageV8
          value={basics ?? basicsFromDraft(subjectSettings)}
          onChange={setBasics}
          stepCount={subjectSettings.steps.length}
          busy={busy}
          onSave={async (value) => {
            const saved = await saveSettings(basicsToDraft(subjectSettings, value))
            if (saved) go('target')
          }}
          onSaveDraft={async (value) => { await saveSettings(basicsToDraft(subjectSettings, value)) }}
          onCancel={() => router.push('/reminders')}
        />
      ) : null}

      {v8stage === 'target' ? (
        <TargetStageV8
          reminderId={reminderId}
          settings={subjectSettings}
          validation={validation}
          validationFailed={validationState === 'error'}
          onRetryValidation={retryValidation}
          onChange={setSettings}
          busy={busy}
          onNext={async () => {
            // REMINDER-09: 保存したら通知の中身（手順3）へ。配信予定は通知のあと。
            const saved = await saveSettings(subjectSettings)
            if (saved) go(null)
          }}
          onSaveDraft={async () => { await saveSettings(subjectSettings) }}
          onCancel={() => router.push('/reminders')}
        />
      ) : null}

      {v8stage === 'messages' ? (
        <MessagesStageV8
          settings={subjectSettings}
          onChange={setSettings}
          busy={busy}
          onNext={async () => {
            const saved = await saveSettings(subjectSettings)
            if (saved) go('preview')
          }}
          onSaveDraft={async () => { await saveSettings(subjectSettings) }}
          onCancel={() => router.push('/reminders')}
        />
      ) : null}

      {v8stage === 'schedule' ? (
        <ScheduleStageV8
          reminderId={reminderId}
          settings={subjectSettings}
          preview={preview}
          previewFailed={previewState === 'error'}
          onRetryPreview={retryPreview}
          onNext={() => go('confirm')}
          onSaveDraft={async () => { await saveSettings(subjectSettings) }}
          busy={busy}
          onCancel={() => router.push('/reminders')}
        />
      ) : null}

      {v8stage === 'confirm' ? (
        <ConfirmStageV8
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
          onSaveDraft={async () => { await saveSettings(subjectSettings) }}
          onCancel={() => router.push('/reminders')}
        />
      ) : null}

      {v8stage === 'done' ? (
        <DoneStageV8
          reminderId={reminderId}
          settings={subjectSettings}
          published={published}
          preview={preview}
        />
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
            <p className="text-ink-secondary mt-3 text-sm">違いは見つかりませんでした。そのまま読み込めます。</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {lines.map((line, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span aria-hidden className="text-accent-deep font-bold">・</span>
                  <span className="text-ink">{line}</span>
                </li>
              ))}
            </ul>
          )
        })()}
      </ConfirmDialog>
    </div>
  )
}

/* ---------------- 手順1の直し（基本設定を編集する） ---------------- */

function BasicsStageV8({
  value,
  onChange,
  stepCount,
  busy,
  onSave,
  onSaveDraft,
  onCancel,
}: {
  value: BasicsValue
  onChange: (value: BasicsValue) => void
  /** 右欄の「通知 ○通」に出す、いまの下書きの通数。 */
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
    <>
      <div className={styles.cols}>
        <div className={styles.main}>
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
        </div>
        <aside className={styles.side}>
          <SummaryCardV8
            rows={[
              { key: '基準日', value: basicsBaseSummary(value, dateFields, events) },
              { key: '対象者', value: '手順2で決める' },
              { key: '通知', value: `${stepCount}通` },
              { key: '状態', value: '下書き' },
            ]}
          />
        </aside>
      </div>
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
    </>
  )
}

/* ---------------- 手順2：対象者と止める条件（YChR6） ---------------- */

function TargetStageV8({
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

  // R15: 未保存の条件で数え直した人数。条件が空なら保存済みの検査結果を出す。
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

  const allLabel = settings.triggerType === 'friend_field'
    ? '基準日が入っている人すべて'
    : settings.triggerType === 'event'
      ? '予約がある人すべて'
      : '予約がある人すべて'
  const allNote = settings.triggerType === 'friend_field'
    ? '情報欄に日付が入った人'
    : '予約日時が入った人'

  const firstStep = settings.steps[0] ?? null

  return (
    <>
      <div className={styles.cols}>
        <div className={styles.main}>
          <section className={styles.card}>
            <div>
              <h2 className={styles.cardTitle}>対象者</h2>
              <p className={styles.cardNote}>{allNote}の友だちに送ります</p>
            </div>
            <div className={`${styles.choiceGrid} ${styles.choiceGrid2}`} role="radiogroup" aria-label="対象者">
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
                icon={<SlidersHorizontal size={18} />}
                title="条件に合う人だけ"
                note="タグ・友だち情報などで絞る"
              />
            </div>
            {mode === 'condition' ? (
              <ConditionBuilder
                value={condition}
                showCount={false}
                onChange={(next) => onChange({ ...settings, targetCondition: next })}
              />
            ) : null}
            <div className={styles.countRow}>
              <div className={styles.countItem}>
                <span className={styles.countLabel}>当てはまる人</span>
                <strong className={styles.countValue}>
                  {counting ? '…' : total == null ? '—' : formatNumber(total)}
                  <span className={styles.countValueUnit}>人</span>
                </strong>
              </div>
              <div className={styles.countItem}>
                <span className={styles.countLabel}>送る予定（ブロックを除く）</span>
                <strong className={styles.countValue}>
                  {counting ? '…' : matched == null ? '—' : formatNumber(matched)}
                  <span className={styles.countValueUnit}>人</span>
                </strong>
              </div>
              <div className={styles.countActions}>
                <button type="button" className={styles.linkButton} onClick={openFaces} disabled={counting}>顔ぶれを見る</button>
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={counting}
                  onClick={() => (mode === 'condition' ? setRecountRetryToken((value) => value + 1) : onRetryValidation?.())}
                >
                  数え直す
                </button>
                <span className={styles.countNote}>数秒〜1分（1,000人ごとに約10秒）</span>
              </div>
            </div>
            {recountError ? <p className={styles.fieldNote}>対象者を数え直せませんでした。保存済みの人数を表示しています。</p> : null}
            {validationFailed ? <p className={styles.fieldNote}>公開前チェックを実行できませんでした。人数は未取得のままです。</p> : null}
            <p className={styles.fieldNote}>基準日が登録・変更されたときに、対象かどうかを自動で見直します。</p>
          </section>

          <section className={styles.card}>
            <div>
              <h2 className={styles.cardTitle}>止める条件</h2>
              <p className={styles.cardNote}>当てはまったら、その人への残りの通知を止めます</p>
            </div>
            <div className={styles.stopList}>
              <div className={styles.stopRow}>
                <span className={styles.stopText}>
                  <span className={styles.stopTitle}>予約がキャンセルされた</span>
                  <span className={styles.stopNote}>すぐ止める</span>
                </span>
                <Toggle
                  label="予約がキャンセルされたら止める"
                  checked={stop.bookingCancelled}
                  onChange={(next) => onChange({ ...settings, stopConditions: { ...stop, bookingCancelled: next } })}
                />
              </div>
              <div className={styles.stopRow}>
                <span className={styles.stopText}>
                  <span className={styles.stopTitle}>対応マークが「完了」になった</span>
                  <span className={styles.stopNote}>残りを止める</span>
                </span>
                <Toggle
                  label="対応マークが完了になったら止める"
                  checked={stop.supportMarkCompleted}
                  onChange={(next) => onChange({ ...settings, stopConditions: { ...stop, supportMarkCompleted: next } })}
                />
              </div>
              <div className={styles.stopRow}>
                <span className={styles.stopText}>
                  <span className={styles.stopTitle}>基準日を7日過ぎた</span>
                  <span className={styles.stopNote}>自動で終わる</span>
                </span>
                <Toggle
                  label="基準日を7日過ぎたら自動で終わる"
                  checked={stop.daysAfterTarget != null}
                  onChange={(next) => onChange({ ...settings, stopConditions: { ...stop, daysAfterTarget: next ? 7 : null } })}
                />
              </div>
              <div className={styles.stopRow}>
                <span className={styles.stopText}>
                  <span className={styles.stopTitle}>友だちがブロックした</span>
                  <span className={styles.stopNote}>すぐ止める（変えられません）</span>
                </span>
                {/* ブロックはLINE側で止まる。切っても届かないので、変えられない入口として出す。 */}
                <Toggle label="友だちがブロックしたら止める" checked locked />
              </div>
            </div>
          </section>

          <section className={styles.card}>
            <div>
              <h2 className={styles.cardTitle}>いつも守る決まり</h2>
            </div>
            <ul className={styles.ruleList}>
              <li>基準日が空欄の人には始めない</li>
              <li>過去の日時になった通知は送らない</li>
              <li>同じ時刻に重なった通知は1通にまとめる</li>
            </ul>
          </section>
        </div>

        <aside className={styles.side}>
          <SummaryCardV8
            rows={[
              { key: '基準日', value: reminderTriggerLabel(settings.triggerType) },
              { key: '対象者', value: matched == null ? '—' : `${formatNumber(matched)}人に送る予定` },
              { key: '通知', value: settings.steps.length > 0 ? `${settings.steps.length}通` : '手順3で作る' },
              { key: '状態', value: '下書き' },
            ]}
          />
          <PhoneAsideV8
            accountName={selectedAccount?.name ?? 'LINE公式アカウント'}
            chip={firstStep ? '1通目の通知' : '通知は手順3で作ります'}
            empty={!firstStep}
            message={firstStep ? renderReminderBodySample(firstStep.messageContent || '本文はまだありません') : undefined}
          />
        </aside>
      </div>
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
              : <ul>{faces.sample.map((friend) => <li key={friend.id}>{friend.displayName}</li>)}</ul>}
      </Dialog>
    </>
  )
}

/* ---------------- 手順3：通知の中身（p5YuP） ---------------- */

const MAX_STEPS = 10
const BODY_LIMIT = 5000

function MessagesStageV8({
  settings,
  onChange,
  busy,
  onNext,
  onSaveDraft,
  onCancel,
}: {
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

  const moveStep = (stableStepId: string, direction: -1 | 1) => {
    const index = settings.steps.findIndex((step) => step.stableStepId === stableStepId)
    const next = index + direction
    if (index < 0 || next < 0 || next >= settings.steps.length) return
    const steps = [...settings.steps]
    const [moved] = steps.splice(index, 1)
    steps.splice(next, 0, moved)
    onChange({ ...settings, steps })
  }

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

  return (
    <>
      <div className={styles.cols}>
        <div className={styles.main}>
          <section className={styles.card}>
            <div>
              <h2 className={styles.cardTitle}>通知</h2>
              <p className={styles.cardNote}>基準日に近い順に並びます。最大 {MAX_STEPS} 通</p>
            </div>
            {settings.steps.length === 0 ? (
              <p className={styles.fieldNote}>通知はまだありません。「通知を足す」で1通目を作成してください。本文が入るまで次へは進めません。</p>
            ) : null}
            {settings.steps.map((step, index) => {
              const open = step.stableStepId === (selectedStep?.stableStepId ?? null)
              return (
                <div key={step.stableStepId} className={`${styles.stepCard} ${open ? styles.stepCardOpen : ''}`}>
                  <div className={styles.stepHead}>
                    <span className={styles.stepNum}>{index + 1}</span>
                    <button type="button" className={styles.stepTiming} style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }} onClick={() => setSelectedStepId(open ? null : step.stableStepId)}>
                      {stepShortTiming(step, settings.deliveryMode)}
                    </button>
                    <span className={styles.stepActions}>
                      <button type="button" className={styles.stepAction} disabled={index === 0} onClick={() => moveStep(step.stableStepId, -1)}>
                        <ArrowUp size={13} aria-hidden="true" />前へ
                      </button>
                      <button type="button" className={styles.stepAction} disabled={index === settings.steps.length - 1} onClick={() => moveStep(step.stableStepId, 1)}>
                        <ArrowDown size={13} aria-hidden="true" />後ろへ
                      </button>
                      <button type="button" className={styles.stepAction} disabled={settings.steps.length <= 1} onClick={() => removeStep(step.stableStepId)}>
                        <Trash2 size={13} aria-hidden="true" />消す
                      </button>
                    </span>
                  </div>
                  {open ? (
                    <>
                      <TimingEditor
                        step={step}
                        mode={settings.deliveryMode}
                        base={sampleBase.current}
                        onChange={(patch) => updateStep(step.stableStepId, patch)}
                      />
                      <TextArea
                        ref={bodyRef}
                        className={styles.bodyArea}
                        value={step.messageContent}
                        maxLength={BODY_LIMIT}
                        placeholder="友だちに届く本文を書きます"
                        onChange={(event) => updateStep(step.stableStepId, { messageContent: event.target.value })}
                      />
                      <div className={styles.insertRow}>
                        <span className={styles.insertLabel}>差し込む</span>
                        <button type="button" className={styles.chip} onClick={() => insertToken('{{name}}')}>
                          <CircleUser size={13} aria-hidden="true" />名前
                        </button>
                        <button type="button" className={styles.chip} onClick={() => insertToken('{{date}}')}>
                          <CalendarClock size={13} aria-hidden="true" />予約日時
                        </button>
                        <button type="button" className={styles.chip} onClick={() => insertToken('{{meet_url}}')}>
                          <Video size={13} aria-hidden="true" />Google Meet の URL
                        </button>
                        <Select
                          value=""
                          onChange={(next) => {
                            const field = fields.find((item) => item.id === next)
                            if (field) insertToken(`{{field.${field.fieldKey}}}`)
                          }}
                          aria-label="友だち情報を差し込む"
                          options={[
                            { value: '', label: '友だち情報' },
                            ...fields.map((field) => ({ value: field.id, label: field.name })),
                          ]}
                        />
                        <span className={styles.charCount}>{formatNumber(step.messageContent.length)} / {formatNumber(BODY_LIMIT)}</span>
                      </div>
                    </>
                  ) : (
                    <p className={styles.stepPreview} onClick={() => setSelectedStepId(step.stableStepId)}>
                      {step.messageContent || '本文はまだありません'}
                    </p>
                  )}
                </div>
              )
            })}
            <button type="button" className={styles.addStep} onClick={addStep} disabled={settings.steps.length >= MAX_STEPS}>
              ＋ 通知を足す
            </button>
          </section>
        </div>

        <aside className={styles.side}>
          <section className={styles.card} aria-label="届く日時の例">
            <div>
              <h2 className={styles.cardTitle}>届く日時の例</h2>
              <p className={styles.cardNote}>{formatJpDay(sampleBase.current)} {String(sampleBase.current.getHours()).padStart(2, '0')}:{String(sampleBase.current.getMinutes()).padStart(2, '0')} に{settings.triggerType === 'friend_field' ? '基準日がある' : '予約した'}人</p>
            </div>
            <div className={styles.exampleRows}>
              {settings.steps.map((step, index) => (
                <div key={step.stableStepId} className={styles.exampleRow}>
                  <span className={styles.exampleKey}>{index + 1}通目</span>
                  <span className={styles.exampleVal}>{formatMd(exampleSendAt(step, settings.deliveryMode, sampleBase.current))}</span>
                </div>
              ))}
              {settings.steps.length === 0 ? <p className={styles.fieldNote}>通知を足すと、ここに届く日時の例が出ます。</p> : null}
            </div>
          </section>
          <PhoneAsideV8
            accountName={selectedAccount?.name ?? 'LINE公式アカウント'}
            chip={selectedStep ? formatMd(exampleSendAt(selectedStep, settings.deliveryMode, sampleBase.current)) : '通知はまだありません'}
            empty={!selectedStep}
            message={selectedStep ? (selectedStep.messageContent ? renderReminderBodySample(selectedStep.messageContent) : '本文を入力すると、ここに表示例が出ます。') : undefined}
          />
        </aside>
      </div>
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
    </>
  )
}

/** 「基準日の [1] 日 [前] の [18:00]」の入力行。配信方式で形を分ける。 */
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
  /*
   * 「○日前の●時」の形で書かれている通だけ日の入力にする。
   * 「1時間前」のひな形のように分で書かれた通は、time 方式でも
   * 分の入力に出す（中身が分のまま保存される実装に合わせる）。
   */
  const dayWritten = step.offsetDays != null && step.sendAtTime != null
  if (mode === 'time' && dayWritten) {
    const days = Math.abs(step.offsetDays ?? 0)
    const after = (step.offsetDays ?? 0) > 0
    return (
      <div className={styles.timingRow}>
        <span>基準日の</span>
        <TextInput
          type="number"
          min={0}
          max={365}
          aria-label="基準日からの日数"
          style={{ width: 64 }}
          value={String(days)}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isInteger(next) && next >= 0) onChange({ offsetDays: after ? next : -next })
          }}
        />
        <span>日</span>
        <Select
          value={after ? 'after' : 'before'}
          onChange={(next) => onChange({ offsetDays: next === 'after' ? days : -days })}
          aria-label="基準日の前か後か"
          options={[{ value: 'before', label: '前' }, { value: 'after', label: '後' }]}
        />
        <span>の</span>
        <TextInput
          type="time"
          aria-label="送る時刻"
          style={{ width: 110 }}
          value={step.sendAtTime ?? ''}
          onChange={(event) => onChange({ sendAtTime: event.target.value || null })}
        />
        <span className={styles.timingExample}>
          例：{formatMd(base)} の基準日 → {formatMd(exampleSendAt({ ...step, offsetDays: after ? days : -days }, 'time', base))} に届く
        </span>
      </div>
    )
  }
  // countdown：「基準日の [n] [分/時間/日] [前/後]」
  const abs = Math.abs(step.offsetMinutes ?? 0)
  const unit: 'min' | 'hour' | 'day' = abs % 1440 === 0 ? 'day' : abs % 60 === 0 ? 'hour' : 'min'
  const amount = unit === 'day' ? abs / 1440 : unit === 'hour' ? abs / 60 : abs
  const before = (step.offsetMinutes ?? 0) <= 0
  const toMinutes = (n: number, u: 'min' | 'hour' | 'day', dir: 'before' | 'after') => {
    const minutes = u === 'day' ? n * 1440 : u === 'hour' ? n * 60 : n
    return dir === 'before' ? -minutes : minutes
  }
  const direction = before ? 'before' : 'after'
  return (
    <div className={styles.timingRow}>
      <span>基準日の</span>
      <TextInput
        type="number"
        min={0}
        aria-label="基準日からの時間"
        style={{ width: 72 }}
        value={String(amount)}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isInteger(next) && next >= 0) onChange({ offsetMinutes: toMinutes(next, unit, direction) })
        }}
      />
      <Select
        value={unit}
        onChange={(next) => onChange({ offsetMinutes: toMinutes(amount, next as 'min' | 'hour' | 'day', direction) })}
        aria-label="単位"
        options={[{ value: 'min', label: '分' }, { value: 'hour', label: '時間' }, { value: 'day', label: '日' }]}
      />
      <Select
        value={direction}
        onChange={(next) => onChange({ offsetMinutes: toMinutes(amount, unit, next as 'before' | 'after') })}
        aria-label="基準日の前か後か"
        options={[{ value: 'before', label: '前' }, { value: 'after', label: '後' }]}
      />
      <span className={styles.timingExample}>
        例：{formatMd(base)} の基準日 → {formatMd(exampleSendAt(step, 'countdown', base))} に届く
      </span>
    </div>
  )
}

/* ---------------- 手順4：配信予定（T0nis） ---------------- */

function ScheduleStageV8({
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
  const duplicateGroups = new Map<string, number>()
  for (const item of items) duplicateGroups.set(item.scheduledAt, (duplicateGroups.get(item.scheduledAt) ?? 0) + 1)
  const now = Date.now()
  const rows = items.filter((item) => {
    if (range === 'conflict') return (duplicateGroups.get(item.scheduledAt) ?? 0) > 1
    const at = Date.parse(item.scheduledAt)
    return at > now && at <= now + (range === '7d' ? 7 : 30) * 86_400_000
  })
  const rangeCount = range === '7d' ? preview?.summary.next7Days ?? null : range === '30d' ? preview?.summary.next30Days ?? null : preview ? preview.summary.duplicateCount : null
  const nextItem = items.find((item) => item.state === 'scheduled') ?? null
  const messagesHref = `/reminders/edit?id=${encodeURIComponent(reminderId)}`

  return (
    <>
      <div className={styles.cols}>
        <div className={styles.main}>
          <section className={styles.card}>
            <div>
              <h2 className={styles.cardTitle}>これから送る予定</h2>
              <p className={styles.cardNote}>有効にしたら、この予定で送ります。予約が変わると予定も変わります。</p>
            </div>
            <div className={styles.previewHead}>
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
              <span className={styles.previewCount}>
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
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>送る日時</th>
                    <th>友だち</th>
                    <th>通知</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.stableStepId} className={item.state === 'duplicate' ? styles.rowWarn : undefined}>
                      <td>{formatMd(item.scheduledAt)}</td>
                      <td>
                        <span className={styles.cellMain}>対象になる人 全員</span>
                        <span className={styles.cellSub}>{countLabel(preview.summary.audience, '人')}</span>
                      </td>
                      <td>
                        <span className={styles.cellMain}>{item.stepNumber}通目</span>
                        <span className={styles.cellSub}>{settings.name}</span>
                      </td>
                      <td>
                        {item.state === 'duplicate'
                          ? <span className={styles.stateWarn}>重なり→1通にまとめる</span>
                          : item.state === 'past'
                            ? <span className={styles.stateOk}>基準日が過去</span>
                            : <span className={styles.stateOk}>送る予定</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {preview && preview.summary.duplicateCount > 0 ? (
              <p className={styles.mergeNote}>
                <ListChecks size={14} aria-hidden="true" />
                同じ時刻に送る通知は、止めずに1通にまとめて送ります（{formatNumber(preview.summary.duplicateCount)}件）。まとめたくないときは時刻をずらしてください。
              </p>
            ) : null}
          </section>
        </div>

        <aside className={styles.side}>
          <SummaryCardV8
            rows={[
              { key: '基準日', value: reminderTriggerLabel(settings.triggerType) },
              { key: '対象者', value: preview ? countLabel(preview.summary.audience, '人') : '—' },
              { key: '通知', value: `${settings.steps.length}通` },
              { key: '状態', value: '下書き' },
            ]}
          />
          <PhoneAsideV8
            accountName={selectedAccount?.name ?? 'LINE公式アカウント'}
            chip={nextItem ? formatMd(nextItem.scheduledAt) : '送信予定はまだありません'}
            empty={!nextItem}
            message={nextItem ? renderReminderBodySample(firstReminderStepMessage(settings, nextItem.stableStepId) || '本文はまだありません') : undefined}
          />
        </aside>
      </div>
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
    </>
  )
}

/* ---------------- 手順5：確認（ltAaq）＝ 設定の確認・テスト送信・有効化前チェック ---------------- */

/** 確認の各行から、直す手順への URL。 */
function editHref(reminderId: string, stage: 'basics' | 'target' | 'preview' | null): string {
  return `/reminders/edit?id=${encodeURIComponent(reminderId)}${stage ? `&stage=${stage}` : ''}`
}

function ConfirmStageV8({
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

  return (
    <>
      <div className={styles.cols}>
        <div className={styles.main}>
          <section className={styles.card}>
            <div>
              <h2 className={styles.cardTitle}>設定の確認</h2>
            </div>
            <div className={styles.confirmRows}>
              <div className={styles.confirmRow}>
                <span className={styles.confirmKey}>名前・フォルダ</span>
                <span className={styles.confirmVal}>{settings.name}{folderName ? `・${folderName}` : ''}</span>
                <Button variant="secondary" size="field" href={editHref(reminderId, 'basics')}>変える</Button>
              </div>
              <div className={styles.confirmRow}>
                <span className={styles.confirmKey}>基準日</span>
                <span className={styles.confirmVal}>{reminderTriggerLabel(settings.triggerType)}</span>
                <Button variant="secondary" size="field" href={editHref(reminderId, 'basics')}>変える</Button>
              </div>
              <div className={styles.confirmRow}>
                <span className={styles.confirmKey}>対象者</span>
                <span className={styles.confirmVal}>
                  {pruneCondition(settings.targetCondition as SegmentCondition | null) ? '条件に合う人だけ' : '基準日がある人すべて'}
                  {validation?.audience.matched != null ? `（${formatNumber(validation.audience.matched)}人に送る予定）` : ''}
                </span>
                <Button variant="secondary" size="field" href={editHref(reminderId, 'target')}>変える</Button>
              </div>
              <div className={styles.confirmRow}>
                <span className={styles.confirmKey}>止める条件</span>
                <span className={styles.confirmVal}>{reminderStopSummary(settings.stopConditions)}</span>
                <Button variant="secondary" size="field" href={editHref(reminderId, 'target')}>変える</Button>
              </div>
              <div className={styles.confirmRow}>
                <span className={styles.confirmKey}>通知</span>
                <span className={styles.confirmVal}>{reminderStepTimings(settings)}</span>
                <Button variant="secondary" size="field" href={editHref(reminderId, null)}>変える</Button>
              </div>
              <div className={styles.confirmRow}>
                <span className={styles.confirmKey}>配信予定</span>
                <span className={styles.confirmVal}>
                  {preview
                    ? `今後7日 ${countLabel(preview.summary.next7Days, '通')}${preview.summary.duplicateCount > 0 ? `（重なり ${formatNumber(preview.summary.duplicateCount)}件はまとめる）` : ''}`
                    : previewFailed ? '読み込めませんでした' : '確認中'}
                </span>
                <Button variant="secondary" size="field" href={editHref(reminderId, 'preview')}>変える</Button>
              </div>
            </div>
          </section>

          <section className={styles.card}>
            <div>
              <h2 className={styles.cardTitle}>テストを送る</h2>
              <p className={styles.cardNote}>{testRecipientNote(recipientView, sentKind)}</p>
            </div>
            <div className={styles.testRow}>
              <span className={styles.input} style={{ flex: 1, color: 'var(--color-ink-secondary)' }} aria-label="送り先">
                送り先：{destination}
              </span>
              <Button variant="secondary" onClick={onSend} disabled={sendBusy || recipientView.kind !== 'ready'} busy={sendBusy} busyLabel="送信中…">
                <Send size={14} aria-hidden="true" />テストを送る
              </Button>
            </div>
            {testedLabel ? <p className={styles.testResult}>{testedLabel}</p> : null}
            <TestRecipientGuidance view={recipientView} accountId={settings.lineAccountId} onRecheck={onRecipientRecheck} />
          </section>

          <section className={styles.card}>
            <div>
              <h2 className={styles.cardTitle}>有効にする前の確認</h2>
            </div>
            {!validation ? (
              validationFailed ? (
                <ListState kind="error" title="有効化前チェックを実行できませんでした" description="チェックが通るまで有効にはできません。通信を確認して、もう一度お試しください。" onRetry={onRetryValidation} />
              ) : (
                <ListState kind="loading" title="有効化前チェックを実行しています" />
              )
            ) : (
              <div>
                <div className={styles.checkRow}>
                  <span className={`${styles.checkIcon} ${draft.lastTestStatus === 'succeeded' ? styles.checkIconOk : styles.checkIconWarn}`}>
                    {draft.lastTestStatus === 'succeeded' ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
                  </span>
                  <span className={styles.checkText}>
                    <span className={styles.checkTitle}>テストを送った</span>
                    <span className={styles.checkNote}>
                      {draft.lastTestStatus === 'succeeded'
                        ? `1通目を${sentKind === 'self' ? '自分' : sentKind === 'registered' ? '登録済みテスト宛先' : 'テスト送信先'}に送れました`
                        : 'まだ送れていません。上の「テストを送る」から送ってください'}
                    </span>
                  </span>
                </div>
                <div className={styles.checkRow}>
                  <span className={`${styles.checkIcon} ${validation.audience.matched != null ? styles.checkIconOk : styles.checkIconWarn}`}>
                    {validation.audience.matched != null ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
                  </span>
                  <span className={styles.checkText}>
                    <span className={styles.checkTitle}>対象者を数えた</span>
                    <span className={styles.checkNote}>
                      {validation.audience.matched != null ? `${formatNumber(validation.audience.matched)}人に送る予定` : '対象者を数えられませんでした'}
                    </span>
                  </span>
                  <Button variant="secondary" size="field" href={editHref(reminderId, 'target')}>見直す</Button>
                </div>
                {validation.checks.filter((check) => check.key !== 'test_send').map((check) => (
                  <div key={check.key} className={styles.checkRow}>
                    <span className={`${styles.checkIcon} ${check.status === 'passed' ? styles.checkIconOk : styles.checkIconWarn}`}>
                      {check.status === 'passed' ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
                    </span>
                    <span className={styles.checkText}>
                      <span className={styles.checkTitle}>{check.label}</span>
                      <span className={styles.checkNote}>{check.message}</span>
                    </span>
                    {check.status !== 'passed' ? (
                      <Button variant="secondary" size="field" href={editHref(reminderId, checkStageFor(check.key))}>編集</Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className={styles.side}>
          <SummaryCardV8
            rows={[
              { key: '基準日', value: reminderTriggerLabel(settings.triggerType) },
              { key: '対象者', value: validation?.audience.matched != null ? `${formatNumber(validation.audience.matched)}人` : '—' },
              { key: '通知', value: `${settings.steps.length}通` },
              { key: '状態', value: '下書き → 有効にする', strong: true },
            ]}
          />
          <PhoneAsideV8
            accountName={selectedAccount?.name ?? 'LINE公式アカウント'}
            chip={firstStep ? `1通目は ${describeReminderTiming(firstStep, settings.deliveryMode)}に届きます` : '通知ステップがありません'}
            empty={!firstStep}
            message={firstStep ? renderReminderBodySample(firstStep.messageContent || '本文はまだありません') : undefined}
          />
        </aside>
      </div>
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
    </>
  )
}

/* ---------------- 完了（hjNpJ） ---------------- */

function DoneStageV8({
  reminderId,
  settings,
  published,
  preview,
}: {
  reminderId: string
  settings: ReminderDraftSettings
  published: ReminderPublishResult | null
  preview: ReminderPreviewResult | null
}) {
  const nextScheduledAt = published?.nextScheduledAt
    ?? preview?.items.find((item) => item.state === 'scheduled')?.scheduledAt
    ?? null
  const next7 = preview?.summary.next7Days ?? published?.plannedDeliveries ?? null

  return (
    <div className={styles.done}>
      <span className={styles.doneIcon}>
        <CheckCircle2 size={30} aria-hidden="true" />
      </span>
      <h2 className={styles.doneTitle}>「{settings.name}」を有効にしました</h2>
      <p className={styles.doneNote}>
        これから{settings.triggerType === 'friend_field' ? '基準日が入った人' : '予約が入った人'}にも、自動で予定が作られます。止めたいときは、詳細の「一時停止する」から止められます。
      </p>
      <dl className={styles.doneFacts}>
        <div className={styles.kvRow}>
          <dt className={styles.kvKey}>最初に送る</dt>
          <dd className={styles.kvVal}>{nextScheduledAt ? formatMd(nextScheduledAt) : '予定なし'}</dd>
        </div>
        <div className={styles.kvRow}>
          <dt className={styles.kvKey}>今後7日</dt>
          <dd className={styles.kvVal}>{countLabel(next7, '通')}</dd>
        </div>
      </dl>
      <div className={styles.doneActions}>
        <Button href="/reminders">一覧へ戻る</Button>
        <Button variant="secondary" href={`/reminders/detail?id=${encodeURIComponent(reminderId)}&status=planned`}>配信予定を見る</Button>
        <Button variant="primary" href={`/reminders/detail?id=${encodeURIComponent(reminderId)}`}>
          詳細を見る<ArrowRight size={15} aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
