'use client'

/*
 * ★V8-B 運用状態の緊急コントロール（板 `OHwbU`）。
 *
 * v7 の制御タブ（`page.tsx` 内の EmergencyControlPanel）とは別の部品として持つ。
 * データの口・確認の言葉（停止／復旧）・本人確認（6桁かパスワード）・
 * 二重押し防止（実行中ロック＋冪等キー）・競合の戻し方・権限の扱いは同じ。
 * 違いは置き場と見せ方だけ——上に4枚の数の帯、何を止めますか・
 * 止めるアカウントのカード、止めているときの赤い帯、止めるとどうなるか・
 * 止めたあとにすること、止めた・戻した記録の表。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8-B 完成までの二重管理）。
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import Link from 'next/link'
import { Eye, PauseCircle, ShieldCheck, Tag, Timer } from 'lucide-react'
import type { LineAccount } from '@line-crm/shared'
import {
  api,
  ApiError,
  type OperationCapability,
  type OperationControl,
  type OperationHistoryEntry,
  type OperationImpactPreview,
  type OperationRestoreDrift,
} from '@/lib/api'
import { operationImpactText, type EmergencyStopTarget } from '@/lib/operation-impact'
import { formatOperationDate } from '@/lib/operation-status'
import { formatMinutesRough } from '@/lib/format-duration'
import { formatNumber } from '@/lib/format'
import { readSessionSnapshot } from '@/lib/session-snapshot'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import Select from '@/components/shared/select'
import OtpInput from '@/components/shared/otp-input'
import StepUpDialog from '@/components/shared/step-up-dialog'
import SaveConflictBar from '@/components/shared/save-conflict-bar'
import { CAPABILITY_LABEL, describeRestoreBlockers, describeRestoreDrift, describeRestoreResult } from './restore-drift'
import { SendPathCoveragePanel } from './send-path-coverage-panel'
import releaseLog from '@/generated/release-log-summary.json'
import type { UpdateRelease } from './update-history'
import styles from './control-v8.module.css'

type StopTarget = 'broadcasts' | 'scenarios' | 'reminders' | 'automations'

/*
 * 画面の並びと、口が返す名前の対応。画面は `broadcasts`、口は
 * `broadcast_dispatch` と呼ぶ。**どちらかに寄せない**（page.tsx と同じ約束）。
 */
const IMPACT_KEY: Record<StopTarget, EmergencyStopTarget> = {
  broadcasts: 'broadcast_dispatch',
  scenarios: 'scenario_dispatch',
  reminders: 'reminder_dispatch',
  automations: 'automation_actions',
}

const TARGET_CAPABILITIES: Record<StopTarget, OperationCapability[]> = {
  broadcasts: ['broadcast_dispatch'],
  scenarios: ['scenario_dispatch'],
  reminders: ['reminder_dispatch'],
  automations: ['automation_actions', 'auto_reply_dispatch'],
}

/* 止められない理由の機械コード。口の応答と1対1に対応する。 */
const BLOCKED_CODES = {
  controlForbidden: 'EMERGENCY_CONTROL_FORBIDDEN',
  scopeForbidden: 'EMERGENCY_SCOPE_FORBIDDEN',
} as const

function blockedText(code: string | null | undefined): string | null {
  if (code === BLOCKED_CODES.scopeForbidden) return 'この範囲を操作する権限がありません。対象アカウントを選び直すか、オーナーに確認してください。'
  if (code === BLOCKED_CODES.controlForbidden) return '緊急停止を実行する権限がありません。オーナーに権限付与を依頼してください。'
  return null
}

/*
 * 403・409（版競合）以外で落ちたときの理由。口の `error` は
 * 400/409/422/428 でだけ運用者向け文言として保証される。429・5xx では
 * `ApiError.message` が内部向けの作り置きに落ちるため、固定の案内文へ倒す。
 */
function failureText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message && !/^API error: \d+$/.test(error.message)) {
    return error.message
  }
  return fallback
}

type Feedback = { tone: 'success' | 'warning' | 'danger'; text: string } | null

const HISTORY_FETCH_LIMIT = 200
/** 記録の表に出す件数。全部は更新履歴のタブで見る。 */
const RECORD_LIMIT = 10

/** 「8/14」の形。記録の表のいつ・いちばん長かった停止の注に使う。 */
function formatMonthDay(value: string | null): string {
  if (!value) return '日時不明'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '日時不明'
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`
}

/** 「8/14 19:02〜19:40」の形。終わりが無ければ始まりだけ出す。 */
function formatStopRange(start: string | null, end: string | null): string {
  if (!start) return '日時不明'
  if (!end) return formatOperationDate(start)
  return `${formatOperationDate(start)}〜${formatOperationDate(end)}`
}

function stopMinutes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const diff = Math.round((Date.parse(end) - Date.parse(start)) / 60_000)
  return Number.isFinite(diff) && diff >= 0 ? diff : null
}

export type EmergencyControlV8Handle = { openStop: () => void }

const EmergencyControlV8 = (
  { accounts }: { accounts: LineAccount[] },
  ref: React.Ref<EmergencyControlV8Handle>,
) => {
  const [targetAccountId, setTargetAccountId] = useState('all')
  const [targets, setTargets] = useState<Record<StopTarget, boolean>>({ broadcasts: true, scenarios: true, reminders: true, automations: false })
  const [reason, setReason] = useState('')
  const [reasonDetail, setReasonDetail] = useState('')
  const [stopCode, setStopCode] = useState('')
  const [stopPassword, setStopPassword] = useState('')

  const [impact, setImpact] = useState<OperationImpactPreview | null>(null)
  const [impactFailed, setImpactFailed] = useState(false)
  const [control, setControl] = useState<OperationControl | null>(null)
  const [canControl, setCanControl] = useState(false)
  const [blockedCode, setBlockedCode] = useState<string | null>(null)
  const [calculatedAt, setCalculatedAt] = useState<string | null>(null)

  const [entries, setEntries] = useState<OperationHistoryEntry[]>([])
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>('loading')

  const [feedback, setFeedback] = useState<Feedback>(null)
  const [needsReload, setNeedsReload] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [running, setRunning] = useState(false)

  /* 確認の窓（停止／復旧の言葉）→ 本人確認の窓（6桁かパスワード）の順に進む。 */
  const [confirmMode, setConfirmMode] = useState<'stop' | 'restore' | null>(null)
  const [confirmWord, setConfirmWord] = useState('')
  const [stepUpMode, setStepUpMode] = useState<'stop' | 'restore' | null>(null)
  const [stepUpError, setStepUpError] = useState('')
  const [requestKey, setRequestKey] = useState('')

  const [restoreDrift, setRestoreDrift] = useState<OperationRestoreDrift | null>(null)

  /* V-1: 2段階認証を使っている人は6桁、無い人はパスワードで確認する。 */
  const stepUpMethod = readSessionSnapshot()?.stepUpMethod ?? 'totp'

  const previewGeneration = useRef(0)
  const mutationLocked = needsReload || running

  const requestPreview = useCallback(async (accountId: string | null) => {
    const response = await api.operations.preview(accountId)
    if (!response.success) throw new Error(response.error)
    if (response.data?.impact && response.data?.control && response.data?.permissions) {
      return response.data
    }
    throw new Error('invalid preview')
  }, [])

  const loadPreview = useCallback(async (accountId: string | null, generation: number) => {
    try {
      const preview = await requestPreview(accountId)
      if (previewGeneration.current !== generation) return
      setImpact(preview.impact)
      setImpactFailed(false)
      setControl(preview.control)
      setCanControl(preview.permissions.canControl)
      setBlockedCode((preview.permissions as { canControl: boolean; reasonCode?: string | null }).reasonCode ?? null)
      setCalculatedAt(preview.calculatedAt)
    } catch (error) {
      if (previewGeneration.current !== generation) return
      setImpact(null)
      setImpactFailed(true)
      setControl(null)
      setCanControl(false)
      setBlockedCode(error instanceof ApiError ? (error.code ?? null) : null)
    }
  }, [requestPreview])

  const clearPreview = useCallback(() => {
    previewGeneration.current += 1
    setImpact(null)
    setImpactFailed(false)
    setControl(null)
    setCanControl(false)
    setBlockedCode(null)
    setCalculatedAt(null)
  }, [])

  useEffect(() => {
    const generation = ++previewGeneration.current
    setNeedsReload(false)
    setReloading(false)
    setConfirmMode(null)
    setConfirmWord('')
    setStepUpMode(null)
    setStepUpError('')
    setRequestKey('')
    void loadPreview(targetAccountId === 'all' ? null : targetAccountId, generation)
    return () => {
      if (previewGeneration.current === generation) previewGeneration.current += 1
    }
  }, [loadPreview, targetAccountId])

  const reloadControl = useCallback(async () => {
    const generation = ++previewGeneration.current
    setNeedsReload(false)
    setReloading(true)
    await loadPreview(targetAccountId === 'all' ? null : targetAccountId, generation)
    if (previewGeneration.current === generation) {
      setReloading(false)
    }
  }, [loadPreview, targetAccountId])

  /* 止めた・戻した記録と、いまの版。タブをまたいで同じ口・同じ数え方を使う。 */
  useEffect(() => {
    let cancelled = false
    setHistoryState('loading')
    api.operations.history(HISTORY_FETCH_LIMIT)
      .then((response) => {
        if (cancelled) return
        if (response.success && Array.isArray(response.data)) {
          setEntries(response.data)
          setHistoryState('ready')
        } else {
          setHistoryState('error')
        }
      })
      .catch(() => {
        if (!cancelled) setHistoryState('error')
      })
    return () => { cancelled = true }
  }, [])

  /* 停止中の incident が確定したら復旧前検査を取り、確認画面へ出す。 */
  const activeIncidentId = control?.activeIncidentId ?? null
  useEffect(() => {
    if (!activeIncidentId) {
      setRestoreDrift(null)
      return
    }
    let cancelled = false
    void api.operations.restorePreview(activeIncidentId)
      .then((response) => {
        if (!cancelled && response.success) setRestoreDrift(response.data.drift)
      })
      .catch(() => {
        if (!cancelled) setRestoreDrift(null)
      })
    return () => { cancelled = true }
  }, [activeIncidentId])

  const operations = entries.filter((item) => item.historyKind !== 'incident' || true)
    .filter((item) => item.historyKind !== 'deployment')
  const cutoff90 = Date.now() - 90 * 24 * 60 * 60 * 1000
  const recent90 = operations.filter((item) => Number.isFinite(Date.parse(item.createdAt)) && Date.parse(item.createdAt) >= cutoff90)
  const longest = operations.reduce<{ minutes: number; entry: OperationHistoryEntry | null }>(
    (best, item) => {
      const minutes = stopMinutes(item.stoppedAt, item.resolvedAt)
      return minutes !== null && minutes > best.minutes ? { minutes, entry: item } : best
    },
    { minutes: 0, entry: null },
  )
  const deployments = entries.filter((item) => item.historyKind === 'deployment' && item.deployment)
  const releases = (releaseLog as { releases?: UpdateRelease[] }).releases ?? []
  const deployedVersion = deployments.find((item) => item.deployment?.phase === 'succeeded' && item.deployment.version)?.deployment?.version
  const currentVersion = deployedVersion ?? releases.find((item) => item.released)?.version ?? null
  const latestReleaseAt = releases.find((item) => item.released)?.released ?? null

  const selectedTargets = (Object.keys(targets) as StopTarget[]).filter((key) => targets[key])
  const selectedCapabilities = selectedTargets.flatMap((key) => TARGET_CAPABILITIES[key])
  const isStopped = Boolean(control?.activeIncidentId)
  const accountName = targetAccountId === 'all'
    ? 'すべてのアカウント'
    : accounts.find((account) => account.id === targetAccountId)?.name ?? '選択したアカウント'
  const previewSettled = impact !== null || impactFailed

  const targetLabels: Record<StopTarget, { label: string; note: string }> = {
    broadcasts: { label: '予約中の一斉配信', note: '予約を下書きに戻します' },
    scenarios: { label: 'シナリオ配信', note: '稼働中のものを止めます' },
    reminders: { label: 'リマインダ', note: '稼働中のものを止めます' },
    automations: { label: '自動処理', note: 'オートメーションと自動応答を止めます' },
  }

  const impactText = (key: StopTarget) => {
    if (impactFailed) return '影響を確認できません'
    if (key !== 'automations') return operationImpactText(IMPACT_KEY[key], impact)
    return `オートメーション ${operationImpactText('automation_actions', impact)}／自動応答 ${operationImpactText('auto_reply_dispatch', impact)}`
  }

  const openStopConfirm = useCallback(() => {
    if (needsReload) {
      setFeedback({ tone: 'warning', text: '最新の状態を読み直してから、もう一度確認してください。' })
      return
    }
    if (!control || impactFailed || !impact) {
      setFeedback({ tone: 'warning', text: '停止状態と影響を確認できるまで実行できません。' })
      return
    }
    if (!canControl) {
      setFeedback({ tone: 'warning', text: '緊急停止を実行する権限がありません。' })
      return
    }
    if (selectedTargets.length === 0) {
      setFeedback({ tone: 'warning', text: '停止する配信を1つ以上選んでください。' })
      return
    }
    setConfirmWord('')
    setStepUpError('')
    setRequestKey(crypto.randomUUID())
    setConfirmMode('stop')
  }, [canControl, control, impact, impactFailed, needsReload, selectedTargets.length])

  useImperativeHandle(ref, () => ({ openStop: () => openStopConfirm() }), [openStopConfirm])

  const openRestoreConfirm = () => {
    if (needsReload) {
      setFeedback({ tone: 'warning', text: '最新の状態を読み直してから、もう一度確認してください。' })
      return
    }
    if (!control?.activeIncidentId) {
      setFeedback({ tone: 'warning', text: 'いまは止めていません。復旧できるものはありません。' })
      return
    }
    if (!canControl) {
      setFeedback({ tone: 'warning', text: '復旧を実行する権限がありません。' })
      return
    }
    setConfirmWord('')
    setStepUpError('')
    setRequestKey(crypto.randomUUID())
    setConfirmMode('restore')
  }

  /** 確認の言葉が合ったら本人確認へ進む。二重押しは実行中ロックで止める。 */
  const proceedToStepUp = () => {
    if (mutationLocked || !confirmMode) return
    if (confirmWord !== (confirmMode === 'stop' ? '停止' : '復旧')) return
    setStepUpMode(confirmMode)
    setConfirmMode(null)
    setConfirmWord('')
  }

  /** 板 `EA8rM`（1枚の確認窓）で止められる条件。理由・言葉・番号の1つでも欠けたら止まる。 */
  const stopCodeOk = stepUpMethod === 'none'
    ? true
    : stepUpMethod === 'password'
      ? stopPassword.length > 0
      : /^\d{6}$/.test(stopCode)
  const canRunStop = confirmMode === 'stop'
    && !mutationLocked && !running
    && reason.trim().length > 0
    && confirmWord === '停止'
    && stopCodeOk

  const closeConfirm = () => {
    if (mutationLocked || running) return
    setConfirmMode(null)
    setConfirmWord('')
    setStopCode('')
    setStopPassword('')
  }

  /** 確認の窓の足（右寄せの2ボタン）。2段に書くと直書き扱いが増えるので1つにまとめる。 */
  const ConfirmActions = ({ children }: { children: React.ReactNode }) => (
    <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
  )

  const runStop = async (code: string) => {
    if (needsReload || !control || !requestKey || stepUpMethod === 'none') return
    setRunning(true)
    setStepUpError('')
    setFeedback(null)
    try {
      const grant = await api.operations.stepUp({ method: stepUpMethod === 'password' ? 'password' : 'totp', value: code })
      if (!grant.success) throw new Error(grant.error)
      const response = await api.operations.stop({
        lineAccountId: targetAccountId === 'all' ? null : targetAccountId,
        capabilities: selectedCapabilities,
        reason: reason.trim(),
        detail: null,
        confirmation: '停止',
        expectedVersion: control.version,
      }, grant.data.token, requestKey)
      if (!response.success) throw new Error(response.error)
      setControl(response.data.control)
      setNeedsReload(false)
      setFeedback({ tone: 'success', text: 'サーバー共通の停止状態を更新しました。別の端末にも同じ状態が表示されます。' })
      setStepUpMode(null)
      setConfirmWord('')
      setStopCode('')
      setStopPassword('')
      setRequestKey('')
      void reloadControl()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === 'VERSION_CONFLICT') {
        setStepUpMode(null)
        setNeedsReload(true)
        setFeedback({ tone: 'warning', text: 'ほかの人が先に操作しました。最新の状態を読み直してから、もう一度確認してください。' })
      } else if (error instanceof ApiError && error.status === 403) {
        setStepUpMode(null)
        setCanControl(false)
        setBlockedCode(error.code ?? null)
        setFeedback({ tone: 'warning', text: blockedText(error.code) ?? 'この操作を行う権限がありません。オーナーに確認してください。' })
      } else {
        setStepUpMode(null)
        setFeedback({ tone: 'danger', text: failureText(error, '緊急停止を保存できませんでした。最新の停止状態を読み直して、もう一度確認してください。') })
      }
    } finally {
      setRunning(false)
    }
  }

  const runRestore = async (code: string) => {
    if (needsReload || !control?.activeIncidentId || !requestKey || stepUpMethod === 'none') return
    setRunning(true)
    setStepUpError('')
    setFeedback(null)
    try {
      const grant = await api.operations.stepUp({ method: stepUpMethod === 'password' ? 'password' : 'totp', value: code })
      if (!grant.success) throw new Error(grant.error)
      const response = await api.operations.restore(control.activeIncidentId, {
        confirmation: '復旧',
        expectedVersion: control.version,
      }, grant.data.token, requestKey)
      if (!response.success) throw new Error(response.error)
      setControl(response.data.control)
      setNeedsReload(false)
      const report = response.data.report
        ? describeRestoreResult(response.data.report)
        : { tone: 'success' as const, text: 'サーバー共通の停止状態を復旧しました。' }
      setFeedback({ tone: report.tone === 'warning' ? 'warning' : 'success', text: report.text })
      setStepUpMode(null)
      setRequestKey('')
      void reloadControl()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === 'VERSION_CONFLICT') {
        setStepUpMode(null)
        setNeedsReload(true)
        setFeedback({ tone: 'warning', text: 'ほかの人が先に操作しました。最新の状態を読み直してから、もう一度確認してください。' })
      } else if (error instanceof ApiError && error.status === 409 && error.code === 'OPERATION_RESTORE_BLOCKED') {
        const report = (error.data as { report?: { drift?: OperationRestoreDrift } } | undefined)?.report
        const reasons = report?.drift ? describeRestoreBlockers(report.drift) : []
        setStepUpMode(null)
        setFeedback({
          tone: 'danger',
          text: [failureText(error, '停止中の変更があるため復旧を止めました。'), ...reasons].join(' '),
        })
      } else if (error instanceof ApiError && error.status === 403) {
        setStepUpMode(null)
        setCanControl(false)
        setBlockedCode(error.code ?? null)
        setFeedback({ tone: 'warning', text: blockedText(error.code) ?? 'この操作を行う権限がありません。オーナーに確認してください。' })
      } else {
        setStepUpMode(null)
        setFeedback({ tone: 'danger', text: failureText(error, '復旧できませんでした。最新の停止状態を読み直して、もう一度確認してください。') })
      }
    } finally {
      setRunning(false)
    }
  }

  /*
   * 止められない理由は黙ってボタンを薄くするだけにしない。理由ごとに
   * 運用者向け文言と次の行動を出す。初回の取得が終わるまでは出さない。
   */
  type StopBlocker = 'unavailable' | 'forbidden' | 'scope' | 'empty' | 'stopped'
  const stopBlockers: StopBlocker[] = []
  if (previewSettled) {
    if (impactFailed) {
      stopBlockers.push(blockedCode === BLOCKED_CODES.scopeForbidden ? 'scope' : 'unavailable')
    } else if (!canControl) {
      stopBlockers.push(blockedCode === BLOCKED_CODES.scopeForbidden ? 'scope' : 'forbidden')
    }
    if (!impactFailed && selectedTargets.length === 0) stopBlockers.push('empty')
    if (isStopped) stopBlockers.push('stopped')
  }
  const blockerText: Record<StopBlocker, string> = {
    unavailable: '停止状態を確認できないため、停止・復旧を実行できません。',
    forbidden: '緊急停止を実行する権限がありません。オーナーに権限付与を依頼してください。',
    scope: 'この範囲を操作する権限がありません。対象アカウントを選び直すか、オーナーに確認してください。',
    empty: '停止する配信を1つ以上選んでください。',
    stopped: 'いまは止めています。戻すときは「復旧する」を使います。',
  }

  const stopIncident = operations.find((item) => item.id === control?.activeIncidentId) ?? null
  const recordRows = operations
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, RECORD_LIMIT)

  return (
    <div data-design-node="OHwbU" className={styles.board}>
      {/* 権限が無い人には閲覧のみの帯。操作は出さず、記録は読める。 */}
      {previewSettled && !canControl ? (
        <div className={styles.roBand} role="status">
          <Eye size={16} aria-hidden="true" />
          <span>閲覧のみで見ています。止める・戻す操作はオーナーか許可された人に頼んでください。</span>
        </div>
      ) : null}

      {needsReload ? (
        <SaveConflictBar
          message="ほかの人が先に操作しました。最新の状態を読み直してから、もう一度確認してください。"
          actionLabel={reloading ? '読み直しています…' : '最新の状態を読み直す'}
          onAction={() => void reloadControl()}
          actionQa="emergency-reload"
        />
      ) : null}

      {stopBlockers.length > 0 ? (
        <div className={`${styles.feedbackBand} ${styles.feedbackWarn}`} role="status">
          <span>{stopBlockers.map((blocker) => blockerText[blocker]).join('')}</span>
          {stopBlockers.includes('unavailable') ? (
            <Button type="button" onClick={() => void reloadControl()} disabled={reloading}>
              {reloading ? '読み直しています…' : '最新の状態を読み直す'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {feedback ? (
        <div
          className={`${styles.feedbackBand} ${feedback.tone === 'danger' ? styles.feedbackDanger : feedback.tone === 'warning' ? styles.feedbackWarn : styles.feedbackSuccess}`}
          role={feedback.tone === 'success' ? 'status' : 'alert'}
        >
          <span>{feedback.text}</span>
          {feedback.tone !== 'success' && needsReload ? (
            <Button type="button" onClick={() => void reloadControl()} disabled={reloading}>
              {reloading ? '読み直しています…' : '最新の状態を読み直す'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* 数の帯。取れていない数字は「—」（0 とは言わない）。 */}
      <div className={styles.kpis} aria-label="緊急停止の集計">
        <div className={styles.kpi}>
          <div className={styles.kpiHead}>
            <span className={styles.kpiTile} aria-hidden="true"><ShieldCheck size={14} /></span>
            <span className={styles.kpiLabel}>緊急停止状態</span>
          </div>
          <p className={`${styles.kpiValue} ${isStopped ? styles.kpiValueDanger : ''}`}>
            {previewSettled ? (isStopped ? '止めている' : '動いている') : '—'}
          </p>
          <p className={styles.kpiDetail}>
            {calculatedAt ? `${formatOperationDate(calculatedAt)}に確認` : '確認中'}
          </p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiHead}>
            <span className={styles.kpiTile} aria-hidden="true"><PauseCircle size={14} /></span>
            <span className={styles.kpiLabel}>止めた回数</span>
          </div>
          <p className={styles.kpiValue}>
            {historyState === 'ready' ? formatNumber(recent90.length) : '—'}<span className={styles.kpiUnit}>回</span>
          </p>
          <p className={styles.kpiDetail}>この90日</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiHead}>
            <span className={styles.kpiTile} aria-hidden="true"><Timer size={14} /></span>
            <span className={styles.kpiLabel}>いちばん長かった停止</span>
          </div>
          <p className={styles.kpiValue}>
            {historyState === 'ready' ? (longest.entry ? formatMinutesRough(longest.minutes) : '—') : '—'}
          </p>
          <p className={styles.kpiDetail}>
            {longest.entry ? `${formatMonthDay(longest.entry.stoppedAt)} ${longest.entry.reason.slice(0, 8)}` : '記録なし'}
          </p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiHead}>
            <span className={styles.kpiTile} aria-hidden="true"><Tag size={14} /></span>
            <span className={styles.kpiLabel}>いまの版</span>
          </div>
          <p className={styles.kpiValue}>{historyState === 'ready' ? (currentVersion ?? '—') : '—'}</p>
          <p className={styles.kpiDetail}>
            {latestReleaseAt ? `管理画面の更新 ${formatMonthDay(latestReleaseAt)}` : '管理画面の更新 —'}
          </p>
        </div>
      </div>

      <section className={styles.card} aria-labelledby="emergency-targets-heading">
        <h2 id="emergency-targets-heading" className={styles.cardTitle}>何を止めますか</h2>
        <p className={styles.cardNote}>選んだものだけを止めます。止めると、予約中の一斉配信は下書きに戻ります。</p>
        {(Object.keys(targetLabels) as StopTarget[]).map((key) => (
          <div key={key} className={styles.targetRow}>
            <Checkbox
              checked={targets[key]}
              onCheckedChange={(checked) => setTargets((current) => ({ ...current, [key]: checked }))}
              disabled={mutationLocked || isStopped || !canControl}
              description={targetLabels[key].note}
            >
              {targetLabels[key].label}
            </Checkbox>
            <span className={styles.targetImpact}>{impactText(key)}</span>
          </div>
        ))}
        <div className={styles.accountRow}>
          <div className={styles.accountField}>
            <label htmlFor="emergency-account-v8" className={styles.fieldLabel}>止めるアカウント</label>
            <Select
              size="full"
              id="emergency-account-v8"
              value={targetAccountId}
              onChange={(value) => {
                previewGeneration.current += 1
                setImpact(null)
                setImpactFailed(false)
                setControl(null)
                setCanControl(false)
                setBlockedCode(null)
                setCalculatedAt(null)
                setTargetAccountId(value)
              }}
              disabled={mutationLocked || isStopped}
              aria-label="緊急停止の対象アカウント"
              options={[
                { value: 'all', label: 'すべてのアカウント' },
                ...accounts.map((account) => ({ value: account.id, label: `${account.name}（いまのアカウント）` })),
              ]}
            />
          </div>
          <Button
            type="button"
            variant="danger"
            onClick={openStopConfirm}
            disabled={mutationLocked || isStopped || impactFailed || !impact || !control || !canControl}
          >
            選んだものを止める
          </Button>
        </div>

        <div className={styles.accountRow}>
          <div className={styles.accountField}>
            <label htmlFor="emergency-reason-v8-body" className={styles.fieldLabel}>止める理由（記録に残ります）</label>
            <Select
              size="full"
              id="emergency-reason-v8-body"
              value={reason}
              onChange={(value) => setReason(value)}
              disabled={mutationLocked || isStopped}
              aria-label="緊急停止の理由"
              options={['障害対応', '誤配信の防止', 'アカウント異常', 'メンテナンス', 'その他'].map((label) => ({ value: label, label }))}
            />
          </div>
        </div>
        <div className={styles.detailBlock}>
          <div className={styles.detailHead}>
            <label htmlFor="emergency-detail-v8-body" className={styles.fieldLabel}>補足（任意）</label>
            <p className={styles.detailCounter}>あと{1000 - reasonDetail.length}文字</p>
          </div>
          <textarea
            id="emergency-detail-v8-body"
            value={reasonDetail}
            onChange={(event) => setReasonDetail(event.target.value)}
            disabled={mutationLocked || isStopped}
            rows={2}
            maxLength={1000}
            placeholder="発生していることを短く入力"
            className={styles.detailTextarea}
          />
        </div>

        {isStopped && control ? (
          <div className={styles.stoppedBand} role="status">
            <p className={styles.stoppedTitle}>止めているとき</p>
            <div className={styles.stoppedLine}>
              <p className={styles.stoppedText}>
                <span className={styles.stoppedDot}>● </span>
                止めている　{formatStopRange(control.stoppedAt, null)}から・{control.actorId ?? '担当者不明'}・
                {(stopIncident?.capabilities ?? selectedCapabilities).map((capability) => CAPABILITY_LABEL[capability]).join('・')}
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={openRestoreConfirm}
                disabled={mutationLocked || !canControl}
              >
                復旧する
              </Button>
            </div>
            <p className={styles.stoppedNote}>
              復旧するとき：止める前に動いていたものだけを戻します。理由を書いて、本人確認（6桁）をしてから戻します。
            </p>
          </div>
        ) : null}
      </section>

      <SendPathCoveragePanel accountId={targetAccountId === 'all' ? null : targetAccountId} revision={control?.version ?? 0} />

      <div className={styles.infoGrid}>
        <section className={styles.card} aria-labelledby="emergency-after-stop-heading">
          <h2 id="emergency-after-stop-heading" className={styles.cardTitle}>止めるとどうなるか</h2>
          <ul className={styles.infoList}>
            <li>予約中の一斉配信は下書きに戻ります</li>
            <li>止めているあいだ配信は出せません</li>
            <li>停止前にすでに LINE へ渡したものは取り消せません</li>
            <li>止めたことは、ログインユーザー全員の LINE とメールへ知らせます</li>
          </ul>
        </section>
        <section className={styles.card} aria-labelledby="emergency-next-heading">
          <h2 id="emergency-next-heading" className={styles.cardTitle}>止めたあとにすること</h2>
          <ul className={styles.infoList}>
            <li>止める前に動いていたものだけを戻します</li>
            <li>変更・追加があった配信は再開しません</li>
            <li>期限を過ぎた予約配信は戻りません（下書きへ）</li>
            <li>止めているあいだの時刻ぶんは、戻しても送りません</li>
          </ul>
        </section>
        <section className={styles.card} aria-labelledby="emergency-links-heading">
          <h2 id="emergency-links-heading" className={styles.cardTitle}>つながる先</h2>
          <ul className={styles.infoList}>
            <li><Link href="/emergency?tab=health" className={styles.relatedLink}>→ 健全性チェック</Link><br />止める前に、どこが変かを確認</li>
            <li><Link href="/emergency?tab=history" className={styles.relatedLink}>→ 更新履歴</Link><br />止めた・戻した記録</li>
            <li><Link href="/broadcasts" className={styles.relatedLink}>→ 一斉配信</Link><br />下書きに戻った配信</li>
          </ul>
        </section>
      </div>

      <section aria-labelledby="emergency-records-heading">
        <h2 id="emergency-records-heading" className={styles.cardTitle}>止めた・戻した記録</h2>
        {historyState === 'loading' ? (
          <div className={styles.card} style={{ marginTop: 12 }} aria-busy="true" aria-label="止めた・戻した記録を読み込んでいます">
            <DelayedSkeleton
              loading
              skeleton={(
                <div aria-hidden="true">
                  <div style={{ display: 'flex', gap: 24, padding: '12px 16px' }}>
                    <Skeleton height={12} width={40} />
                    <Skeleton height={12} width={60} />
                    <Skeleton height={12} width={40} />
                    <Skeleton height={12} width={40} />
                    <Skeleton height={12} width={70} />
                    <Skeleton height={12} width={120} />
                  </div>
                  {[0, 1, 2].map((row) => (
                    <div key={row} style={{ display: 'flex', gap: 16, padding: '12px 16px', borderTop: '1px solid var(--color-hairline)' }}>
                      <Skeleton height={14} width={120} />
                      <Skeleton height={14} width={80} />
                      <Skeleton height={14} width={100} />
                      <Skeleton height={14} width={90} />
                      <Skeleton height={14} width={60} />
                      <Skeleton height={14} width={110} />
                    </div>
                  ))}
                </div>
              )}
            />
          </div>
        ) : historyState === 'error' ? (
          <div className={styles.card} style={{ marginTop: 12 }}>
            <ListState kind="error" title="記録を読み込めませんでした" description="履歴なしとは扱いません。" />
          </div>
        ) : recordRows.length === 0 ? (
          <div className={styles.card} style={{ marginTop: 12 }}>
            <ListState kind="empty" title="この期間の記録はありません" />
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">いつ</th>
                  <th scope="col">だれが</th>
                  <th scope="col">何を</th>
                  <th scope="col">なぜ</th>
                  <th scope="col">止めた時間</th>
                  <th scope="col">下書きに戻った配信</th>
                </tr>
              </thead>
              <tbody>
                {recordRows.map((entry) => {
                  const minutes = stopMinutes(entry.stoppedAt, entry.resolvedAt)
                  return (
                    <tr key={entry.id}>
                      <td title={formatStopRange(entry.stoppedAt, entry.resolvedAt)} className={styles.cellTruncate}>
                        {formatStopRange(entry.stoppedAt, entry.resolvedAt)}
                      </td>
                      <td title={entry.actorId} className={styles.cellTruncate}>{entry.actorId}</td>
                      <td title={entry.capabilities.map((capability) => CAPABILITY_LABEL[capability]).join('・')} className={styles.cellTruncate}>
                        {entry.capabilities.map((capability) => CAPABILITY_LABEL[capability]).join('・')}
                      </td>
                      <td title={entry.detail ? `${entry.reason}（${entry.detail}）` : entry.reason} className={styles.cellTruncate}>
                        {entry.reason}
                      </td>
                      <td>{minutes === null ? '—' : formatMinutesRough(minutes)}</td>
                      <td>—</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.tableNote}>
          だれが、いつ、何を止めたかが残ります。通常の管理者は消せません。緊急停止はオーナーと許可された人だけが実行できます。
        </p>
      </section>

      <div className={styles.stickyBar} role="region" aria-label="緊急停止の操作">
        <p className={styles.stickySummary}>4つのうち{selectedTargets.length}つを選択 ／ {accountName} ／ 理由「{reason}」</p>
        <div className={styles.stickyActions}>
          <button
            type="button"
            onClick={() => { setTargets({ broadcasts: true, scenarios: true, reminders: true, automations: false }); setReason('障害対応'); setReasonDetail('') }}
            disabled={mutationLocked || isStopped}
            className={styles.stickyCancel}
          >
            キャンセル
          </button>
          <Button
            type="button"
            variant="danger"
            onClick={openStopConfirm}
            disabled={mutationLocked || isStopped || impactFailed || !impact || !control || !canControl}
          >
            緊急停止する
          </Button>
        </div>
      </div>

      {/* 確認の窓：止めるときは板 `EA8rM` の1枚（対象・理由必須・言葉・番号）。戻すときは今までどおり。 */}
      <Dialog
        open={confirmMode !== null}
        designNode={confirmMode === 'stop' ? 'EA8rM' : 'OHwbU-confirm'}
        tone={confirmMode === 'stop' ? 'destructive' : 'default'}
        title={confirmMode === 'stop' ? '緊急停止を確認' : '止める前の状態に戻しますか？'}
        description={confirmMode === 'stop'
          ? '止める前に、何と何人に関わるかを実測で確かめました。'
          : '停止前に動いていたものだけを戻します。期限を過ぎた予約は自動では送りません。'}
        onCancel={closeConfirm}
        footer={confirmMode === 'stop' ? (
          <ConfirmActions>
            <Button type="button" onClick={closeConfirm} disabled={mutationLocked || running}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void runStop(stepUpMethod === 'password' ? stopPassword : stopCode)}
              disabled={!canRunStop}
            >
              緊急停止する
            </Button>
          </ConfirmActions>
        ) : (
          <ConfirmActions>
            <Button type="button" onClick={closeConfirm} disabled={mutationLocked}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={proceedToStepUp}
              disabled={mutationLocked || confirmWord !== '復旧'}
            >
              復旧を実行する
            </Button>
          </ConfirmActions>
        )}
      >
        <div>
          {confirmMode === 'stop' ? (
            <>
              <div className={styles.confirmTargets}>
                <p className={styles.dialogLabel}>止める対象：{accountName}</p>
                {selectedTargets.map((key) => (
                  <div key={key} className={styles.confirmTargetRow}>
                    <span>{targetLabels[key].label}</span>
                    <strong>{impactText(key)}</strong>
                  </div>
                ))}
              </div>
              <p className={styles.dialogHint}>止まらないもの：{targets.automations ? '受信箱からの手の返信と予約の受付は止まりません。' : '自動処理／受信箱からの手の返信／予約の受付は止まりません。'}</p>
              <div className={styles.confirmReason}>
                <label htmlFor="emergency-reason-v8" className={styles.dialogLabel}>止める理由（必須）</label>
                <input
                  id="emergency-reason-v8"
                  aria-label="止める理由"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={mutationLocked || running}
                  maxLength={200}
                  placeholder="例：宛先の絞り込みを間違えた"
                  className={styles.dialogInput}
                  style={{ maxWidth: '100%' }}
                />
              </div>
              <p className={styles.dialogHint}>停止前にすでに LINE へ渡したものは取り消せません。</p>
            </>
          ) : (
            <>
              <p className={styles.confirmReason}>{accountName}</p>
              {restoreDrift && describeRestoreDrift(restoreDrift).length > 0 ? (
                <div className={styles.confirmTargets}>
                  <p className={styles.dialogLabel}>停止しているあいだに変わったものがあります</p>
                  <ul className={styles.infoList}>
                    {describeRestoreDrift(restoreDrift).map((line) => <li key={line}>{line}</li>)}
                  </ul>
                  <p className={styles.dialogHint}>変更・追加があった配信は再開しません。期限切れの予約は下書きへ戻します。</p>
                </div>
              ) : null}
            </>
          )}
          <label className={styles.dialogField}>
            <span className={styles.dialogLabel}>
              確認のため「{confirmMode === 'stop' ? '停止' : '復旧'}」と入力
            </span>
            <input
              value={confirmWord}
              onChange={(event) => setConfirmWord(event.target.value)}
              autoFocus
              disabled={mutationLocked || running}
              aria-label="確認の言葉"
              className={styles.dialogInput}
            />
          </label>
          {confirmMode === 'stop' && stepUpMethod !== 'none' ? (
            <div className={styles.dialogField}>
              <span className={styles.dialogLabel} id="emergency-stepup-label">
                {stepUpMethod === 'password' ? '本人確認（パスワード）' : '本人確認（認証アプリの6桁）'}
              </span>
              {stepUpMethod === 'password' ? (
                <input
                  type="password"
                  aria-label="パスワード"
                  value={stopPassword}
                  onChange={(event) => setStopPassword(event.target.value)}
                  disabled={mutationLocked || running}
                  autoComplete="current-password"
                  className={styles.dialogInput}
                  style={{ maxWidth: '100%' }}
                />
              ) : (
                <OtpInput
                  value={stopCode}
                  onChange={setStopCode}
                  labelledBy="emergency-stepup-label"
                  disabled={mutationLocked || running}
                />
              )}
            </div>
          ) : null}
          <p className={styles.dialogHint}>この操作は記録に残り、ログインユーザーへ通知されます。</p>
        </div>
      </Dialog>

      {/* 本人確認の窓：2段階認証の人は6桁、無い人はパスワード。 */}
      <StepUpDialog
        open={stepUpMode !== null}
        action={stepUpMode === 'stop' ? '緊急停止する' : '復旧する'}
        method={stepUpMethod}
        busy={running}
        error={stepUpError || undefined}
        onSubmit={(code) => void (stepUpMode === 'stop' ? runStop(code) : runRestore(code))}
        onCancel={() => {
          if (!running) {
            setStepUpMode(null)
            setStepUpError('')
          }
        }}
      />

    </div>
  )
}

export default forwardRef<EmergencyControlV8Handle, { accounts: LineAccount[] }>(EmergencyControlV8)
