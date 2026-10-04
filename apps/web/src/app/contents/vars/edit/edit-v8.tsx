'use client'

/*
 * ★V8 共通情報の編集（板 `AYc6O`、競合 `piWhz`、編集（1152）`C67dE`）。
 *
 * v7 の編集画面（`page.tsx` 内の EditCommonVarInner）とは別の部品として持つ。
 * データの口・影響確認・保存・予約・削除・状態切替は同じ。
 * 違いは置き場と見せ方だけ——左に中身を変える・変える前に影響を見る、
 * 右に名前とフォルダ・使える期間・社内メモ・決めた日に変える・
 * これまでの変更・差し込んだときの見え方、下の帯に削除・キャンセル・
 * 止める・反映して保存。競合は `piWhz` の黄色い帯と比べる窓で扱う。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, CircleAlert, CircleCheck, Eye } from 'lucide-react'
import DateField from '@/components/shared/date-field'
import DateTimeField, { TimeField } from '@/components/shared/date-time-field'
import Select from '@/components/shared/select'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import type {
  CommonVar,
  CommonVarChangeImpact,
  CommonVarDeleteImpact,
  CommonVarSchedule,
  Folder,
} from '@line-crm/shared'
import { api, ApiError, type CommonVarDetail } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useAccount } from '@/contexts/account-context'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import LinePreview from '@/components/shared/line-preview'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StickyBar from '@/components/shared/sticky-bar'
import StatusBadge from '@/components/shared/status-badge'
import TargetMissing from '@/components/shared/target-missing'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { NOT_AVAILABLE, STATE_TEXT } from '@/components/shared/not-connected'
import { checkedAtText, placeholderText } from '../delete-impact'
import { VAR_TYPE_LABELS, commonVarValueError, formatStamp, isSecretLikeVarValue, COMMON_VAR_STATE_LABELS } from '@/lib/common-vars'
import {
  blockingErrors,
  historicalText,
  isChangeItem,
  reflectionScopeText,
  reflectionTimingText,
  reviewWarnings,
  hiddenText,
  immediateItems,
  impactStateFromError,
  impactStateText,
  saveErrorText,
  scheduleErrorText,
  type ChangeImpactState,
} from '../change-impact'
import { formatNumber } from '@/lib/format'
import { impactCsv } from '../impact-review'
import styles from './edit-v8.module.css'

/** 「いま」より前は予約できない。入れた瞬間に当たって、予約に見えない。 */
function jstNowLocalInput(): { date: string; time: string } {
  const jst = new Date(Date.now() + 9 * 3600_000).toISOString()
  return { date: jst.slice(0, 10), time: jst.slice(11, 16) }
}

function utcToJstLocalInput(value: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return ''
  return new Date(parsed.getTime() + 9 * 3600_000).toISOString().slice(0, 16)
}

/** 競合の帯の時刻。「14:02」の形（板 `piWhz`）。 */
function formatHourMinute(value: string): string | null {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  const jst = new Date(parsed.getTime() + 9 * 3600_000)
  return `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
}

/** 札の色。配信予約中は金、止めた・下書きは灰、期限切れは黄。 */
function usageTone(status: string): 'warning' | 'neutral' | 'info' {
  if (/配信予約中|配信中/.test(status)) return 'warning'
  if (/停止中|止めた|下書き/.test(status)) return 'neutral'
  return 'info'
}

function EditCommonVarV8Inner() {
  usePageTitle('共通情報を編集')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: '共通情報', href: '/contents/vars' },
  ])
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''

  /*
   * 保存・削除・状態切替の口は `requireRole('owner', 'admin')` で閉じている。
   * staff には閲覧のみの帯を出して保存の押し口を押せない形にする（閉さない）。
   */
  const [canWrite] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())

  const [item, setItem] = useState<CommonVarDetail | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [schedules, setSchedules] = useState<CommonVarSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loadFailure, setLoadFailure] = useState<'missing' | 'error' | null>(null)
  const [foldersError, setFoldersError] = useState(false)
  const [schedulesError, setSchedulesError] = useState(false)
  const [saved, setSaved] = useState(false)

  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState('')
  const [value, setValue] = useState('')
  const [memo, setMemo] = useState('')
  const [changeReason, setChangeReason] = useState('')
  const [reasonFieldError, setReasonFieldError] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [expiryBehavior, setExpiryBehavior] = useState<'stop' | 'fallback'>('stop')
  const [fallbackValue, setFallbackValue] = useState('')
  const [valueFieldError, setValueFieldError] = useState('')
  const [fallbackFieldError, setFallbackFieldError] = useState('')
  const [scheduleFieldError, setScheduleFieldError] = useState('')

  const [draft, setDraft] = useState<{ date: string; time: string; value: string } | null>(null)
  const draftPanelRef = useOverlayFocus(!!draft, () => setDraft(null))
  const [clearSchedulesOpen, setClearSchedulesOpen] = useState(false)
  const [clearSchedulesBusy, setClearSchedulesBusy] = useState(false)
  const [clearSchedulesError, setClearSchedulesError] = useState('')

  useEffect(() => { setValueFieldError('') }, [value])
  useEffect(() => { setFallbackFieldError('') }, [fallbackValue])
  useEffect(() => { setScheduleFieldError('') }, [draft?.value])

  const [impact, setImpact] = useState<CommonVarDeleteImpact | CommonVarChangeImpact | null>(null)
  const [impactState, setImpactState] = useState<ChangeImpactState>('loading')
  /** 影響の行が多いときは畳む（板 `AYc6O` の「ほか5か所」）。 */
  const [impactExpanded, setImpactExpanded] = useState(false)
  /** 狭い板ではスマホの見え方を窓で見る（板 `C67dE`）。 */
  const [previewOpen, setPreviewOpen] = useState(false)

  const loadImpact = useCallback(async (
    varId: string,
    accountId: string,
    nextValue?: string,
    expectedVersion?: number,
  ) => {
    setImpactState('loading')
    try {
      const res = nextValue === undefined
        ? await api.commonVars.deleteImpact(varId, accountId)
        : await api.commonVars.impactPreview(varId, accountId, nextValue, expectedVersion)
      if (accountId !== latestAccountRef.current) return
      if (!res.success) {
        setImpact(null)
        setImpactState('error')
        return
      }
      setImpact(res.data)
      setImpactState('ready')
    } catch (e) {
      if (accountId !== latestAccountRef.current) return
      setImpact(null)
      setImpactState(impactStateFromError(e))
    }
  }, [])

  useEffect(() => {
    if (!item || !selectedAccountId) return
    const nextValue = value === item.value ? undefined : value
    const timer = setTimeout(() => {
      void loadImpact(item.id, selectedAccountId, nextValue, item.version)
    }, 400)
    return () => clearTimeout(timer)
  }, [item, selectedAccountId, value, loadImpact])

  const blocked = impact && 'canSave' in impact && impactState === 'ready'
    ? blockingErrors(impact)
    : []

  const loadFolders = useCallback(async (accountId: string) => {
    try {
      const folderList = await api.folders.list('common_var')
      if (accountId !== latestAccountRef.current) return
      if (folderList.success) {
        setFolders(folderList.data)
        setFoldersError(false)
      } else {
        setFoldersError(true)
      }
    } catch {
      if (accountId !== latestAccountRef.current) return
      setFoldersError(true)
    }
  }, [])

  const loadSchedules = useCallback(async (varId: string, accountId: string) => {
    try {
      const scheduleList = await api.commonVars.schedules(varId, accountId)
      if (accountId !== latestAccountRef.current) return
      if (scheduleList.success) {
        setSchedules(scheduleList.data)
        setSchedulesError(false)
      } else {
        setSchedulesError(true)
      }
    } catch {
      if (accountId !== latestAccountRef.current) return
      setSchedulesError(true)
    }
  }, [])

  const applyDetail = useCallback((found: CommonVarDetail) => {
    setItem(found)
    setName(found.name)
    setFolderId(found.folderId ?? '')
    setValue(found.value)
    setMemo(found.memo)
    setValidFrom(utcToJstLocalInput(found.validFrom))
    setValidUntil(utcToJstLocalInput(found.validUntil))
    setExpiryBehavior(found.expiryBehavior ?? 'stop')
    setFallbackValue(found.fallbackValue ?? '')
  }, [])

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false)
      setError('')
      setLoadFailure(null)
      return
    }
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setItem(null)
      setLoading(false)
      setError(accountLoading ? '' : 'LINEアカウントを選択してください')
      setLoadFailure(null)
      return
    }
    setLoading(true)
    setError('')
    setLoadFailure(null)
    setFoldersError(false)
    setSchedulesError(false)
    try {
      const [detailResult, folderResult, scheduleResult] = await Promise.all([
        api.commonVars.detail(id, accountAtRequest).then(
          (data) => ({ ok: true as const, data }),
          (caught: unknown) => ({ ok: false as const, caught }),
        ),
        api.folders.list('common_var').then(
          (data) => ({ ok: true as const, data }),
          (caught: unknown) => ({ ok: false as const, caught }),
        ),
        api.commonVars.schedules(id, accountAtRequest).then(
          (data) => ({ ok: true as const, data }),
          (caught: unknown) => ({ ok: false as const, caught }),
        ),
      ])
      if (accountAtRequest !== latestAccountRef.current) return
      if (folderResult.ok && folderResult.data.success) {
        setFolders(folderResult.data.data)
        setFoldersError(false)
      } else {
        setFoldersError(true)
      }
      if (scheduleResult.ok && scheduleResult.data.success) {
        setSchedules(scheduleResult.data.data)
        setSchedulesError(false)
      } else {
        setSchedulesError(true)
      }
      if (!detailResult.ok) {
        if (detailResult.caught instanceof ApiError && detailResult.caught.status === 404) {
          setError('この共通情報は見つかりませんでした')
          setLoadFailure('missing')
        } else {
          setError('読み込みに失敗しました。もう一度読み込んでください。')
          setLoadFailure('error')
        }
        return
      }
      const found = detailResult.data.success ? detailResult.data.data : undefined
      if (!found) {
        setError('この共通情報は見つかりませんでした')
        setLoadFailure('missing')
        return
      }
      applyDetail(found)
      setConflict(null)
    } catch {
      if (accountAtRequest !== latestAccountRef.current) return
      setError('読み込みに失敗しました。もう一度読み込んでください。')
      setLoadFailure('error')
    } finally {
      if (accountAtRequest === latestAccountRef.current) setLoading(false)
    }
  }, [accountLoading, applyDetail, id, selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  /*
   * 競合の帯（板 `piWhz`）。保存が409で止まったとき、入力を残したまま
   * いま保存されている版へ合わせ、誰がいつ保存したかを見せる。
   */
  const [conflict, setConflict] = useState<{
    actorName: string | null
    savedAt: string | null
  } | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)

  const refreshBaseline = async (varId: string, accountId: string, err?: ApiError) => {
    const body = err?.data as { currentVersion?: unknown } | undefined
    if (typeof body?.currentVersion === 'number' && Number.isInteger(body.currentVersion)) {
      const currentVersion = body.currentVersion
      setItem((prev) => (prev ? { ...prev, version: currentVersion } : prev))
    }
    try {
      const detail = await api.commonVars.detail(varId, accountId)
      if (accountId !== latestAccountRef.current) return null
      if (detail.success) {
        setItem(detail.data)
        return detail.data
      }
      return null
    } catch {
      return null
    } finally {
      await loadSchedules(varId, accountId)
    }
  }

  const save = async () => {
    if (!item || saving || !selectedAccountId) return
    const accountAtRequest = selectedAccountId
    if (!name.trim()) {
      setError('共通情報名を入力してください')
      return
    }
    const valueError = commonVarValueError(item.type, value)
    if (valueError) {
      setError(valueError)
      setValueFieldError(valueError)
      document.getElementById('cv-value')?.focus()
      return
    }
    if (validFrom && validUntil && validFrom >= validUntil) {
      setError('有効終了は有効開始より後にしてください')
      return
    }
    if (expiryBehavior === 'fallback') {
      if (!fallbackValue) {
        setError('期限切れ時に使う代替値を入力してください')
        document.getElementById('cv-fallback-value')?.focus()
        return
      }
      const fallbackError = commonVarValueError(item.type, fallbackValue, '代替値')
      if (fallbackError) {
        setError(fallbackError)
        setFallbackFieldError(fallbackError)
        document.getElementById('cv-fallback-value')?.focus()
        return
      }
    }
    if (isSecretLikeVarValue(value)) {
      const message = '鍵やトークンのような秘密の値は共通情報に保存できません'
      setError(message)
      setValueFieldError(message)
      document.getElementById('cv-value')?.focus()
      return
    }
    if (expiryBehavior === 'fallback' && isSecretLikeVarValue(fallbackValue)) {
      const message = '鍵やトークンのような秘密の値は代替値にも保存できません'
      setError(message)
      setFallbackFieldError(message)
      document.getElementById('cv-fallback-value')?.focus()
      return
    }
    if (!changeReason.trim()) {
      const message = '変える理由を入力してください'
      setError(message)
      setReasonFieldError(message)
      document.getElementById('cv-change-reason')?.focus()
      return
    }
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      let preview: Awaited<ReturnType<typeof api.commonVars.impactPreview>> | null = null
      try {
        preview = await api.commonVars.impactPreview(item.id, accountAtRequest, value, item.version)
      } catch {
        preview = null
      }
      if (accountAtRequest !== latestAccountRef.current) return
      if (!preview || !preview.success) {
        setError('影響を確認できませんでした。しばらく待って保存し直してください')
        return
      }
      const res = await api.commonVars.update(item.id, accountAtRequest, {
        name: name.trim(),
        value,
        memo,
        folderId: folderId || null,
        expectedVersion: item.version,
        changeReason: changeReason.trim(),
        impactProof: preview.data.impactProof,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
        expiryBehavior,
        fallbackValue: expiryBehavior === 'fallback' ? fallbackValue : null,
      })
      if (accountAtRequest !== latestAccountRef.current) return
      if (!res.success) {
        setError(res.error)
        if (res.error.includes('代替値')) setFallbackFieldError(res.error)
        else if (res.error.includes('値')) setValueFieldError(res.error)
        return
      }
      setSaved(true)
      setChangeReason('')
      setConflict(null)
      setCompareOpen(false)
      void load()
    } catch (e) {
      if (e instanceof ApiError && (e.status === 428 || e.status === 409)) {
        if (accountAtRequest !== latestAccountRef.current) return
        setError(saveErrorText(e))
        const fresh = await refreshBaseline(item.id, accountAtRequest, e)
        /*
         * 409は誰かが先に保存した。入力は残したまま、帯で誰の保存かを見せる
         * （板 `piWhz`）。428（確認切れ）は文だけで、帯は出さない。
         */
        if (e.status === 409) {
          const latest = fresh?.history[0]
          setConflict({
            actorName: latest?.actorName ?? null,
            savedAt: latest?.createdAt ?? null,
          })
        }
        return
      }
      setError(saveErrorText(e))
    } finally {
      setSaving(false)
    }
  }

  /** 最新を読み込んで続ける。打ち込んだ内容は捨て、いまの版から直し直す。 */
  const adoptLatest = () => {
    if (!item) return
    applyDetail(item)
    setConflict(null)
    setCompareOpen(false)
    setError('')
  }

  const [deleteTarget, setDeleteTarget] = useState<{ item: CommonVar; accountId: string } | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deletePhase, setDeletePhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [deleteImpact, setDeleteImpact] = useState<CommonVarDeleteImpact | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteAccountSwitched = deleteTarget !== null && deleteTarget.accountId !== selectedAccountId

  const dirty = item !== null && (
    name !== item.name ||
    folderId !== (item.folderId ?? '') ||
    value !== item.value ||
    memo !== item.memo ||
    validFrom !== utcToJstLocalInput(item.validFrom) ||
    validUntil !== utcToJstLocalInput(item.validUntil) ||
    expiryBehavior !== (item.expiryBehavior ?? 'stop') ||
    fallbackValue !== (item.fallbackValue ?? '') ||
    draft !== null
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty,
    busy: saving || deleting,
  })
  const leaveConfirmDialog = (
    <UnsavedLeaveDialog open={leaveTarget !== null} subject="共通情報への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
  )

  const openDelete = async () => {
    if (!item || !selectedAccountId) return
    const target = { item, accountId: selectedAccountId }
    setDeleteTarget(target)
    setDeleteImpact(null)
    setDeleteError('')
    setDeleteReason('')
    setDeletePhase('loading')
    try {
      const res = await api.commonVars.deleteImpact(target.item.id, target.accountId)
      if (latestAccountRef.current !== target.accountId) return
      if (!res.success) throw new Error(res.error)
      setDeleteImpact(res.data)
      setDeletePhase('ready')
    } catch {
      setDeletePhase('error')
    }
  }

  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteImpact(null)
    setDeleteError('')
    setDeleteReason('')
    setDeletePhase('loading')
  }

  const remove = async () => {
    if (!deleteTarget || deleting || deleteAccountSwitched) return
    if (deletePhase !== 'ready' || !deleteImpact?.canDelete) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.commonVars.delete(deleteTarget.item.id, deleteTarget.accountId, deleteReason.trim())
      if (!res.success) throw new Error(res.error)
      router.push('/contents/vars')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setDeleteError('いま使われ始めたため、削除できませんでした。使用先を読み直しました。')
        try {
          const again = await api.commonVars.deleteImpact(deleteTarget.item.id, deleteTarget.accountId)
          if (again.success) setDeleteImpact(again.data)
          else setDeletePhase('error')
        } catch {
          setDeletePhase('error')
        }
        return
      }
      setDeleteError('削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const addSchedule = async () => {
    if (!item || !draft || !selectedAccountId) return
    if (!draft.date) {
      setError('開始日を入れてください')
      return
    }
    const scheduleValueError = commonVarValueError(item.type, draft.value, '更新後の値')
    if (scheduleValueError) {
      setError(scheduleValueError)
      setScheduleFieldError(scheduleValueError)
      return
    }
    setError('')
    try {
      const res = await api.commonVars.addSchedule(item.id, selectedAccountId, {
        effectiveFrom: `${draft.date}T${draft.time || '00:00'}`,
        value: draft.value,
      })
      if (!res.success) {
        setError(res.error)
        if (res.error.includes('更新後の値') || res.error.includes('種別')) {
          setScheduleFieldError(res.error)
        }
        return
      }
      setDraft(null)
      await refreshBaseline(item.id, selectedAccountId)
    } catch (e) {
      setError(scheduleErrorText(e))
    }
  }

  const removeSchedule = async (scheduleId: string) => {
    if (!item || !selectedAccountId) return
    setError('')
    try {
      await api.commonVars.deleteSchedule(item.id, scheduleId, selectedAccountId)
      await refreshBaseline(item.id, selectedAccountId)
    } catch {
      setError('予約の削除に失敗しました。通信を確かめて、もう一度お試しください。')
    }
  }

  const clearSchedules = async () => {
    if (!item || !selectedAccountId) return
    setClearSchedulesBusy(true)
    setClearSchedulesError('')
    try {
      for (const schedule of schedules) {
        await api.commonVars.deleteSchedule(item.id, schedule.id, selectedAccountId)
      }
      setClearSchedulesOpen(false)
      await refreshBaseline(item.id, selectedAccountId)
    } catch {
      setClearSchedulesError('消せなかった予定があります。通信を確かめて、もう一度お試しください。')
    } finally {
      setClearSchedulesBusy(false)
    }
  }

  const [statusAction, setStatusAction] = useState<'stop' | 'resume' | 'publish' | null>(null)
  const [statusReason, setStatusReason] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState('')

  const openStatusDialog = (action: 'stop' | 'resume' | 'publish') => {
    setStatusAction(action)
    setStatusReason('')
    setStatusError('')
  }

  const closeStatusDialog = () => {
    if (statusBusy) return
    setStatusAction(null)
    setStatusReason('')
    setStatusError('')
  }

  const applyStatus = async () => {
    if (!item || !selectedAccountId || !statusAction) return
    const reason = statusReason.trim()
    if (!reason) {
      setStatusError('変える理由を入力してください')
      return
    }
    setStatusBusy(true)
    setStatusError('')
    try {
      const res = await api.commonVars.setStatus(item.id, selectedAccountId, {
        to: statusAction === 'stop' ? 'stopped' : 'active',
        changeReason: reason,
        expectedVersion: item.version,
      })
      if (!res.success) {
        setStatusError(res.error)
        return
      }
      setStatusAction(null)
      setStatusReason('')
      await load()
    } catch (e) {
      setStatusError(
        e instanceof ApiError && e.status === 409
          ? '別の担当者が先に更新しました。最新内容を読み直してください。'
          : '状態を変えられませんでした。通信を確かめて、もう一度お試しください。',
      )
    } finally {
      setStatusBusy(false)
    }
  }

  const exportImpactCsv = () => {
    if (!impact || !('canSave' in impact)) return
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${impactCsv(impact)}`], { type: 'text/csv;charset=utf-8' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'common-information-impact.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="編集する共通情報が指定されていません"
        description="一覧から編集する共通情報を選び直してください。"
        backHref="/contents/vars"
        backLabel="共通情報一覧へ戻る"
      />
    )
  }
  if (!accountLoading && !selectedAccountId) {
    return (
      <ListState
        kind="empty"
        title="LINEアカウントを選んでください"
        description="選ぶと共通情報を編集できます。"
        action={<Button href="/contents/vars">共通情報一覧へ戻る</Button>}
      />
    )
  }
  if (!loading && loadFailure === 'missing') {
    return (
      <TargetMissing
        kind="not-found"
        title="この共通情報は見つかりません"
        description="削除されたか、リンクが古くなっています。一覧から選び直してください。"
        backHref="/contents/vars"
        backLabel="共通情報一覧へ戻る"
      />
    )
  }
  if (!loading && loadFailure === 'error') {
    return (
      <TargetMissing
        kind="error"
        title="共通情報を読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => void load()}
      />
    )
  }

  const usageTotal = item?.usagePage
    ? item.usagePage.total
    : impactState === 'ready' && impact
      ? impact.total
      : null
  const stateLabel = item ? (COMMON_VAR_STATE_LABELS[item.state ?? item.status ?? 'active'] ?? '使用中') : ''
  const typeLabel = item ? (VAR_TYPE_LABELS[item.type] ?? item.type) : ''
  const stopped = (item?.status ?? 'active') === 'stopped'
  const isDraft = (item?.status ?? 'active') === 'draft'

  return (
    <div data-design-node="AYc6O" className={styles.board}>
      <div>
        <Link href="/contents/vars" className={styles.backLink}>
          ← 共通情報へ
        </Link>
        <h1 className={styles.headTitle}>{item?.name ?? '共通情報を編集'}</h1>
        {item ? (
          <p className={styles.headSub}>
            {placeholderText(item.varKey)}・{typeLabel}・{stateLabel}・{usageTotal === null ? '—' : `${formatNumber(usageTotal)}か所で使っています`}
          </p>
        ) : null}
      </div>

      {/* 競合の帯（板 `piWhz`）。入力は残したまま、誰の保存かを見せる。 */}
      {conflict && item ? (
        <div data-design-node="piWhz" className={styles.conflictBand} role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <div className={styles.conflictText}>
            <strong>
              {conflict.actorName ?? '別の担当者'}さんが{conflict.savedAt && formatHourMinute(conflict.savedAt) ? `${formatHourMinute(conflict.savedAt)}` : ''}に共通情報「{item.name}」を保存しました
            </strong>
            <p className={styles.conflictSub}>
              あなたが直した所はまだ保存されていません。このまま保存すると、{conflict.actorName ?? '別の担当者'}さんの変更が消えます。
            </p>
          </div>
          <div className={styles.conflictActions}>
            <Button type="button" onClick={() => setCompareOpen(true)}>
              違いを比べる
            </Button>
            <Button type="button" variant="primary" onClick={adoptLatest}>
              最新を読み込んで続ける
            </Button>
          </div>
        </div>
      ) : null}

      {canWrite ? null : (
        <div className={styles.roBand} role="status">
          <Eye size={16} aria-hidden="true" />
          <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
        </div>
      )}

      {error && item && (
        <Notice tone="danger" message={error} onClose={() => setError('')} className="mb-4 max-w-3xl" />
      )}

      {loading || !item ? (
        <div className={styles.stateCard}>
          <ListState kind="loading" title="共通情報を読み込んでいます" />
        </div>
      ) : (
        <>
          <div className={styles.split}>
            <div className={styles.main}>
              <section className={styles.card} aria-labelledby="cv-edit-value-heading">
                <h2 id="cv-edit-value-heading" className={styles.cardTitle}>中身を変える</h2>
                <div className={styles.valueRow}>
                  <div>
                    <label htmlFor="cv-current" className={styles.fieldLabel}>いまの中身</label>
                    <input
                      id="cv-current"
                      type="text"
                      value={item.value || '（空）'}
                      disabled
                      readOnly
                      className={styles.fieldInput}
                    />
                  </div>
                  <span className={styles.valueArrow} aria-hidden="true"><ArrowRight size={16} /></span>
                  <div>
                    <label htmlFor="cv-value" className={styles.fieldLabel}>新しい中身</label>
                    {item.type === 'boolean' ? (
                      <Select size="full" aria-label="新しい中身" id="cv-value" value={value} onChange={(next) => { setSaved(false); setValue(next) }} options={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} />
                    ) : (item.type as string) === 'long_text' ? (
                      <textarea id="cv-value" value={value} onChange={(e) => { setSaved(false); setValue(e.target.value) }} className={styles.fieldInput} rows={2} />
                    ) : (item.type as string) === 'date' ? (
                      <DateField id="cv-value" value={value} onChange={(v) => { setSaved(false); setValue(v) }} />
                    ) : (item.type as string) === 'datetime' ? (
                      <DateTimeField id="cv-value" value={value} onChange={(v) => { setSaved(false); setValue(v) }} />
                    ) : (
                      <input
                        id="cv-value"
                        type={item.type === 'number' ? 'number' : 'text'}
                        value={value}
                        onChange={(e) => { setSaved(false); setValue(e.target.value) }}
                        className={styles.fieldInput}
                      />
                    )}
                  </div>
                </div>
                {valueFieldError ? <p className={styles.fieldError} role="alert">{valueFieldError}</p> : null}
                <div className={styles.fieldBlock}>
                  <label htmlFor="cv-change-reason" className={styles.fieldLabel}>
                    変える理由（記録に残ります）
                  </label>
                  <input
                    id="cv-change-reason"
                    type="text"
                    value={changeReason}
                    onChange={(e) => { setSaved(false); setReasonFieldError(''); setChangeReason(e.target.value) }}
                    maxLength={200}
                    placeholder="例：10月から営業時間が変わるため"
                    className={styles.fieldInput}
                  />
                  {reasonFieldError ? <p className={styles.fieldError} role="alert">{reasonFieldError}</p> : null}
                </div>
              </section>

              <section className={styles.card} aria-labelledby="cv-edit-impact-heading">
                <h2 id="cv-edit-impact-heading" className={styles.cardTitle}>変える前に影響を見る</h2>
                <p className={styles.cardNote}>
                  {impactState === 'ready' && impact
                    ? `${formatNumber(impact.total)}か所。次に送る・動くときから新しい値が入ります。すでに届いた文は変わりません`
                    : '次に送る・動くときから新しい値が入ります。すでに届いた文は変わりません'}
                </p>
                {impactState !== 'ready' || !impact ? (
                  <div data-impact-state={impactState} style={{ marginTop: 12 }}>
                    <p className={styles.cardNote}>{impactStateText(impactState)}</p>
                    {impactState === 'error' ? (
                      <Button
                        type="button"
                        onClick={() => {
                          if (item && selectedAccountId) void loadImpact(item.id, selectedAccountId)
                        }}
                      >
                        {STATE_TEXT.retry}
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <ImpactRows
                    impact={impact}
                    onExportCsv={exportImpactCsv}
                  />
                )}
              </section>

              {saved && <p className="text-success text-sm">保存しました。</p>}
            </div>

            <aside className={styles.side}>
              <section className={styles.card} aria-labelledby="cv-edit-name-heading">
                <h2 id="cv-edit-name-heading" className={styles.cardTitle}>名前とフォルダ</h2>
                <div className={styles.fieldBlock}>
                  <label htmlFor="cv-name" className={styles.fieldLabel}>名前</label>
                  <input
                    id="cv-name"
                    type="text"
                    maxLength={200}
                    value={name}
                    onChange={(e) => { setSaved(false); setName(e.target.value) }}
                    className={styles.fieldInput}
                  />
                </div>
                <div className={styles.fieldBlock}>
                  <label htmlFor="cv-folder" className={styles.fieldLabel}>フォルダ</label>
                  <Select
                    aria-label="フォルダ"
                    id="cv-folder"
                    value={folderId}
                    onChange={(next) => { setSaved(false); setFolderId(next) }}
                    options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
                  />
                  {foldersError ? (
                    <div className="mt-1 space-y-1" data-folders-state="error">
                      <p className="text-ink-secondary text-xs">
                        フォルダの一覧を読み込めませんでした。いまの設定のまま保存できます。
                      </p>
                      <Button
                        type="button"
                        onClick={() => {
                          if (item && selectedAccountId) void loadFolders(selectedAccountId)
                        }}
                      >
                        再読み込み
                      </Button>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className={styles.card} aria-labelledby="cv-edit-period-heading">
                <h2 id="cv-edit-period-heading" className={styles.cardTitle}>使える期間</h2>
                <div className={styles.fieldBlock}>
                  <label htmlFor="cv-valid-from" className={styles.fieldLabel}>始まり</label>
                  <DateTimeField id="cv-valid-from" value={validFrom} placeholder="指定なし" onChange={(v) => { setSaved(false); setValidFrom(v) }} />
                </div>
                <div className={styles.fieldBlock}>
                  <label htmlFor="cv-valid-until" className={styles.fieldLabel}>終わり</label>
                  <DateTimeField id="cv-valid-until" value={validUntil} placeholder="指定なし" onChange={(v) => { setSaved(false); setValidUntil(v) }} />
                </div>
                <div className={styles.fieldBlock}>
                  <label htmlFor="cv-expiry-behavior" className={styles.fieldLabel}>期間外の動き</label>
                  <Select aria-label="期間外の動き" id="cv-expiry-behavior" value={expiryBehavior} onChange={(next) => { setSaved(false); setExpiryBehavior(next as 'stop' | 'fallback') }} options={[{ value: 'stop', label: '配信を止める' }, { value: 'fallback', label: '代替値を使う' }]} />
                </div>
                {expiryBehavior === 'fallback' && (
                  <div className={styles.fieldBlock}>
                    <label htmlFor="cv-fallback-value" className={styles.fieldLabel}>代わりの値</label>
                    {item.type === 'boolean' ? (
                      <Select
                        aria-label="代わりの値"
                        id="cv-fallback-value"
                        value={fallbackValue}
                        onChange={(next) => { setSaved(false); setFallbackValue(next) }}
                        options={[{ value: '', label: '選んでください' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]}
                      />
                    ) : (item.type as string) === 'date' ? (
                      <DateField id="cv-fallback-value" value={fallbackValue} onChange={(v) => { setSaved(false); setFallbackValue(v) }} />
                    ) : (item.type as string) === 'datetime' ? (
                      <DateTimeField id="cv-fallback-value" value={fallbackValue} onChange={(v) => { setSaved(false); setFallbackValue(v) }} />
                    ) : (
                      <input
                        id="cv-fallback-value"
                        type={item.type === 'number' ? 'number' : 'text'}
                        value={fallbackValue}
                        onChange={(e) => { setSaved(false); setFallbackValue(e.target.value) }}
                        placeholder="お問い合わせください"
                        className={styles.fieldInput}
                      />
                    )}
                    {fallbackFieldError ? <p className={styles.fieldError} role="alert">{fallbackFieldError}</p> : null}
                  </div>
                )}
              </section>

              <section className={styles.card} aria-labelledby="cv-edit-memo-heading">
                <h2 id="cv-edit-memo-heading" className={styles.cardTitle}>社内メモ</h2>
                <div className={styles.fieldBlock}>
                  <label htmlFor="cv-memo" className={styles.fieldLabel}>メモ（お客さまには出せません）</label>
                  <input
                    id="cv-memo"
                    type="text"
                    value={memo}
                    onChange={(e) => { setSaved(false); setMemo(e.target.value) }}
                    maxLength={1000}
                    placeholder="店舗ごとに違うときは店舗の共通情報へ"
                    className={styles.fieldInput}
                  />
                </div>
              </section>

              <section className={styles.card} aria-labelledby="cv-edit-schedule-heading">
                <h2 id="cv-edit-schedule-heading" className={styles.cardTitle}>決めた日に変える</h2>
                <p className={styles.cardNote}>今すぐではなく、決めた日から新しい中身にできます。</p>
                {schedulesError ? (
                  <div data-schedules-state="error" style={{ marginTop: 12 }}>
                    <p className="text-ink-secondary text-sm">
                      更新の予定を読み込めませんでした。いまの値のまま保存できます。
                    </p>
                    <Button
                      type="button"
                      onClick={() => {
                        if (item && selectedAccountId) void loadSchedules(item.id, selectedAccountId)
                      }}
                    >
                      再読み込み
                    </Button>
                  </div>
                ) : (
                  <>
                    {schedules.map((schedule) => (
                      <div key={schedule.id} className={styles.schedRow}>
                        <span className={styles.schedText}>
                          {formatStamp(schedule.effectiveFrom)}から {schedule.value || '（空）'}
                        </span>
                        {canWrite ? (
                          <Button type="button" onClick={() => void removeSchedule(schedule.id)}>予定を削除</Button>
                        ) : null}
                      </div>
                    ))}
                    {schedules.length > 0 ? (
                      <p className={styles.schedNote}>
                        いま値を保存しても、この予定は消えません。予定の時刻になると、ここに登録した値へ変わります。
                      </p>
                    ) : null}
                    {canWrite ? (
                      <div className={styles.statusBtns}>
                        <Button
                          type="button"
                          onClick={() => {
                            const now = jstNowLocalInput()
                            setDraft({ date: now.date, time: '00:00', value })
                          }}
                        >
                          予定を足す
                        </Button>
                        {schedules.length > 0 ? (
                          <Button
                            type="button"
                            onClick={() => {
                              setClearSchedulesError('')
                              setClearSchedulesOpen(true)
                            }}
                          >
                            予定をすべて消す
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </section>

              <section className={styles.card} aria-labelledby="cv-edit-history-heading">
                <h2 id="cv-edit-history-heading" className={styles.cardTitle}>これまでの変更</h2>
                {item.history.length > 0 ? (
                  <ol className={styles.historyList}>
                    {item.history.slice(0, 5).map((entry, index) => {
                      const previous = item.history[index + 1]
                      return (
                        <li key={entry.id} className={styles.historyItem}>
                          <div className={styles.historyHead}>
                            <span className={styles.historyDate}>{formatStamp(entry.createdAt)}</span>
                            <span className={styles.historyActor}>{entry.actorName ?? (entry.actorId ? '担当者名を確認できません' : '担当者未記録')}</span>
                          </div>
                          <p className={styles.historyChange}>
                            {previous
                              ? `「${previous.value || '（空）'}」→「${entry.value || '（空）'}」`
                              : 'はじめて登録'}
                          </p>
                          {entry.changeReason ? <p className={styles.historyReason}>理由：{entry.changeReason}</p> : null}
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <p className={styles.cardNote}>まだ変更履歴はありません。</p>
                )}
                {canWrite ? (
                  <>
                    <p className={styles.statusBtnsLabel}>下の帯の操作（状態で変わる）：</p>
                    <div className={styles.statusBtns}>
                      {(item.status ?? 'active') === 'active' && (
                        <Button type="button" onClick={() => openStatusDialog('stop')}>
                          止める
                        </Button>
                      )}
                      {item.status === 'stopped' && (
                        <Button type="button" onClick={() => openStatusDialog('resume')}>
                          再開する
                        </Button>
                      )}
                      {item.status === 'draft' && (
                        <Button type="button" variant="primary" onClick={() => openStatusDialog('publish')}>
                          公開する
                        </Button>
                      )}
                    </div>
                  </>
                ) : null}
              </section>

              <div className={styles.sidePreviewButton}>
                <Button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                >
                  LINEでの見え方を見る
                </Button>
              </div>
              <div className={styles.sidePreviewFull}>
                <h2 className={styles.previewTitle}>差し込んだときの見え方</h2>
                <div style={{ marginTop: 8 }}>
                  <LinePreview caption={schedules.length > 0 && schedules[0] ? `${formatStamp(schedules[0].effectiveFrom)}から` : undefined} accountName="然 -NEN-">
                    <p className={styles.previewBubble}>
                      いつもありがとうございます。
                      営業時間は{value || '（未入力）'}です。
                      お電話：03-1234-5678
                    </p>
                    <p className={styles.previewMeta}>10:00</p>
                  </LinePreview>
                </div>
              </div>
            </aside>
          </div>

          <StickyBar
            destructive={canWrite ? (
              <Button variant="danger" type="button" onClick={() => void openDelete()}>
                削除
              </Button>
            ) : undefined}
            actions={(
              <>
                <Button href="/contents/vars">キャンセル</Button>
                {canWrite && !stopped && !isDraft ? (
                  <Button type="button" onClick={() => openStatusDialog('stop')} disabled={saving}>
                    止める
                  </Button>
                ) : null}
                {blocked.length > 0 && (
                  <span className="text-danger text-xs">
                    {blocked[0]}。直すまで保存できません。
                  </span>
                )}
                {conflict ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => setCompareOpen(true)}
                    disabled={saving}
                  >
                    比べてから保存
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={saving || blocked.length > 0 || !canWrite}
                    onClick={() => void save()}
                    busy={saving}
                    busyLabel="保存中…"
                    title={canWrite ? undefined : '閲覧のみのため保存できません'}
                  >
                    {impactState === 'ready' && impact && usageTotal !== null
                      ? `${formatNumber(usageTotal)}か所に反映して保存`
                      : '保存する'}
                  </Button>
                )}
              </>
            )}
          />
        </>
      )}

      {/* 状態の切替（止める・再開する・公開する）。理由は記録に残すので必須。 */}
      <Dialog
        open={statusAction !== null}
        designNode="AYc6O-status"
        title={item && statusAction
          ? `「${item.name}」を${statusAction === 'stop' ? '止める' : statusAction === 'resume' ? '再開する' : '公開する'}`
          : ''}
        description={statusAction === 'stop'
          ? '止めているあいだ、この共通情報を差し込んだ配信は送られません。あとで再開できます。'
          : statusAction === 'resume'
            ? 'この共通情報を再び配信で使えるようにします。'
            : '下書きを配信で使えるようにします。公開すると差し込みに使われます。'}
        busy={statusBusy}
        error={statusError || undefined}
        onCancel={closeStatusDialog}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" onClick={closeStatusDialog} disabled={statusBusy}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void applyStatus()}
              disabled={statusBusy}
              busy={statusBusy}
              busyLabel="変更中…"
            >
              {statusAction === 'stop' ? '止める' : statusAction === 'resume' ? '再開する' : '公開する'}
            </Button>
          </div>
        }
      >
        <label className={styles.dialogField}>
          <span className={styles.dialogLabel}>
            {statusAction === 'stop' ? '止める理由（記録に残ります）'
              : statusAction === 'resume' ? '再開する理由（記録に残ります）'
                : '公開する理由（記録に残ります）'}
          </span>
          <input
            value={statusReason}
            onChange={(e) => { setStatusError(''); setStatusReason(e.target.value) }}
            maxLength={200}
            placeholder={statusAction === 'stop' ? '例：キャンペーンが終わったため' : '例：新しい期間の案内を始めるため'}
            className={styles.dialogInput}
          />
        </label>
      </Dialog>

      {/* 削除の確認。使われているものは消さず、一覧の窓（`xxKtW`）へ導く。 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget ? `共通情報「${deleteTarget.item.name}」を削除しますか？` : ''}
        description="この共通情報と、登録値・次回の更新予約を削除します。テンプレート・配信・フォルダ・友だちは削除しません。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={
          deleteAccountSwitched
            ? '窓を開けたあとにLINEアカウントが切り替わりました。この共通情報は、いま選んでいるアカウントのものではありません。閉じてから選び直してください。'
            : deleteError || undefined
        }
        onConfirm={
          deleteAccountSwitched || deletePhase !== 'ready' || !deleteImpact?.canDelete
            || !deleteReason.trim()
            ? undefined
            : () => void remove()
        }
        onCancel={closeDelete}
      >
        <div className="space-y-2 text-xs leading-5">
          {deletePhase === 'loading' ? (
            <p className="text-ink-faint">使われている場所を読み込んでいます</p>
          ) : deletePhase === 'error' ? (
            <p className="text-danger font-semibold" role="alert">
              使用先を読み込めませんでした。読み直してから、もう一度お試しください。
            </p>
          ) : deleteImpact ? (
            <>
              <p className={deleteImpact.blockingTotal > 0 ? 'text-danger font-semibold' : 'text-ink-secondary'}>
                {deleteImpact.blockingTotal > 0
                  ? `いま${deleteImpact.blockingTotal}か所で使われています。一覧の削除の窓から差し替えてください。`
                  : '使っている設定はありません。'}
              </p>
              <label className="block">
                <span className="text-ink-secondary font-semibold">
                  消した理由 <span className="text-danger">必須</span>
                </span>
                <input
                  value={deleteReason}
                  onChange={(event) => setDeleteReason(event.target.value)}
                  placeholder="例：店舗情報の変更のため"
                  className="border-hairline rounded-control bg-canvas text-ink mt-1 w-full border px-3 py-2 text-sm"
                />
              </label>
            </>
          ) : null}
        </div>
      </ConfirmDialog>

      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
          role="dialog"
          aria-modal="true"
          aria-label="スケジュール設定"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDraft(null)
          }}
        >
          <div ref={draftPanelRef} className="rounded-card bg-canvas w-full max-w-md space-y-4 p-6 shadow-float">
            <div className="flex items-start justify-between gap-3">
              <p className="text-ink text-sm font-semibold">予定を足す</p>
              <button type="button" onClick={() => setDraft(null)} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken">
                ×
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              <div>
                <label htmlFor="sc-date" className="text-ink-secondary mb-1 block text-xs font-medium">
                  開始日
                </label>
                <DateField
                  id="sc-date"
                  value={draft.date}
                  min={jstNowLocalInput().date}
                  onChange={(v) => setDraft({ ...draft, date: v })}
                />
              </div>
              <div>
                <label htmlFor="sc-time" className="text-ink-secondary mb-1 block text-xs font-medium">
                  開始時刻
                </label>
                <TimeField
                  id="sc-time"
                  value={draft.time}
                  onChange={(v) => setDraft({ ...draft, time: v })}
                />
              </div>
            </div>
            <div>
              <label htmlFor="sc-value" className="text-ink-secondary mb-1 block text-xs font-medium">
                更新後の値
              </label>
              {item?.type === 'boolean' ? (
                <Select size="full" aria-label="更新後の値" id="sc-value" value={draft.value} onChange={(v) => setDraft({ ...draft, value: v })} options={[{ value: '', label: '選んでください' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]} />
              ) : (item?.type as string) === 'date' ? (
                <DateField id="sc-value" value={draft.value} onChange={(v) => setDraft({ ...draft, value: v })} />
              ) : (item?.type as string) === 'datetime' ? (
                <DateTimeField id="sc-value" value={draft.value} onChange={(v) => setDraft({ ...draft, value: v })} />
              ) : (
                <input
                  id="sc-value"
                  type={item?.type === 'number' ? 'number' : 'text'}
                  value={draft.value}
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                />
              )}
              {scheduleFieldError ? <p className="text-danger mt-1 text-xs">{scheduleFieldError}</p> : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setDraft(null)}>
                キャンセル
              </Button>
              <Button type="button" variant="primary" onClick={() => void addSchedule()}>
                登録する
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={clearSchedulesOpen}
        title="更新の予定をすべて消しますか？"
        description="予定の時刻に値が変わる設定をすべて取り消します。いま入力中の内容はそのまま残ります。"
        confirmLabel="すべて削除する"
        destructive
        busy={clearSchedulesBusy}
        error={clearSchedulesError || undefined}
        onConfirm={clearSchedulesBusy ? undefined : () => void clearSchedules()}
        onCancel={() => { if (!clearSchedulesBusy) setClearSchedulesOpen(false) }}
      />

      {/* 違いを比べる窓（板 `piWhz`）。いまの版と自分の入力を見せる。 */}
      <Dialog
        open={compareOpen && conflict !== null && item !== null}
        designNode="piWhz-compare"
        title={item ? `「${item.name}」の違いを比べる` : ''}
        description="いま保存されている中身と、あなたが入力した中身を見せます。このまま保存すると、相手の変更が消えます。"
        busy={saving}
        error={error || undefined}
        onCancel={() => { if (!saving) setCompareOpen(false) }}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" onClick={() => { if (!saving) setCompareOpen(false) }} disabled={saving}>
              閉じる
            </Button>
            <Button type="button" onClick={adoptLatest} disabled={saving}>
              最新の値で続け直す
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void save()}
              disabled={saving || !canWrite}
              busy={saving}
              busyLabel="保存中…"
            >
              このまま保存して上書きする
            </Button>
          </div>
        }
      >
        {item ? (
          <div>
            <p className={styles.dialogLabel}>いま保存されている中身</p>
            <p className={`${styles.compareBox} ${styles.compareServer}`}>{item.value || '（空）'}</p>
            <p className={styles.dialogLabel} style={{ marginTop: 12 }}>あなたの入力</p>
            <p className={`${styles.compareBox} ${styles.compareMine}`}>{value || '（空）'}</p>
            <p className={styles.dialogHint}>
              名前・フォルダ・期間・メモの違いはこの窓に出ません。最新の値で続け直すと、すべて最新の版に戻ります。
            </p>
          </div>
        ) : null}
      </Dialog>

      {/* 狭い板のスマホの見え方（板 `C67dE`）。 */}
      <Dialog
        open={previewOpen}
        designNode="C67dE-preview"
        title="LINEでの見え方"
        onCancel={() => setPreviewOpen(false)}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" onClick={() => setPreviewOpen(false)}>
              閉じる
            </Button>
          </div>
        }
      >
        <LinePreview caption={schedules.length > 0 && schedules[0] ? `${formatStamp(schedules[0].effectiveFrom)}から` : undefined} accountName="然 -NEN-">
          <p className={styles.previewBubble}>
            いつもありがとうございます。
            営業時間は{value || '（未入力）'}です。
            お電話：03-1234-5678
          </p>
          <p className={styles.previewMeta}>10:00</p>
        </LinePreview>
      </Dialog>

      {leaveConfirmDialog}
    </div>
  )
}

/*
 * 変える前に影響を見る、の行。いまの文と保存したあとの文を
 * 赤・緑の箱で並べる（板 `AYc6O`）。3件まで出し、残りは畳む。
 */
function ImpactRows({
  impact,
  onExportCsv,
}: {
  impact: CommonVarDeleteImpact | CommonVarChangeImpact
  onExportCsv: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const rows = immediateItems(impact)
  const visible = expanded ? rows : rows.slice(0, 3)
  const rest = rows.length - visible.length
  const changeable = 'canSave' in impact
  const csvRows = changeable ? impact.items.filter((item) => item.changesOnSave) : []

  return (
    <div>
      {rows.length === 0 ? (
        <p className={styles.cardNote} style={{ marginTop: 12 }}>
          使われている場所がないため、確かめる文はありません。
        </p>
      ) : (
        visible.map((row, index) => (
          <div key={`${row.kind}-${row.name}-${index}`} className={styles.impactRow}>
            <div className={styles.impactRowHead}>
              <span>
                <span className={styles.impactKind}>{row.kindLabel} </span>
                <span className={styles.impactName}>{row.name}</span>
              </span>
              <StatusBadge tone={usageTone(row.status)}>{row.status}</StatusBadge>
            </div>
            <div className={styles.impactPair}>
              <p className={styles.impactBefore}>
                …{row.currentPreview}
              </p>
              <p className={styles.impactAfter}>
                {isChangeItem(row)
                  ? `…${row.nextPreview ?? `${NOT_AVAILABLE}（使用先を開いて確認してください）`}`
                  : '値を変えると、ここに保存後の文が出ます。'}
              </p>
            </div>
          </div>
        ))
      )}
      <div className={styles.impactFoot}>
        <span>
          {rest > 0 ? (
            <button type="button" className={styles.impactToggle} onClick={() => setExpanded(true)}>
              ほか{formatNumber(rest)}か所を見る
            </button>
          ) : rows.length > 3 ? (
            <button type="button" className={styles.impactToggle} onClick={() => setExpanded(false)}>
              畳む
            </button>
          ) : null}
        </span>
        {changeable ? (
          <button type="button" className={styles.impactCsv} onClick={onExportCsv} disabled={csvRows.length === 0}>
            この一覧をCSVで
          </button>
        ) : null}
      </div>
      {changeable ? (
        <>
          {blockingErrors(impact).length > 0 ? (
            <ul className={styles.blockList}>
              {blockingErrors(impact).map((message) => <li key={message}>{message}</li>)}
            </ul>
          ) : (
            <p className={styles.validNote} role="status">
              <CircleCheck size={14} aria-hidden="true" />
              <span>文字数の上限をこえる文はありません。保存を止める問題は見つかりませんでした。</span>
            </p>
          )}
          {reviewWarnings(impact).map((message) => (
            <p key={message} className={styles.cardNote}>{message}</p>
          ))}
        </>
      ) : (
        <>
          {reflectionScopeText(impact) ? (
            <p className={styles.cardNote}>{reflectionScopeText(impact)}</p>
          ) : null}
          {reflectionTimingText(impact) ? (
            <p className={styles.cardNote}>{reflectionTimingText(impact)}</p>
          ) : null}
          {historicalText(impact) ? (
            <p className={styles.cardNote}>{historicalText(impact)}</p>
          ) : null}
        </>
      )}
      {hiddenText(impact) ? (
        <p className={styles.cardNote}>
          名前を確認できない使用先：{hiddenText(impact)}
        </p>
      ) : null}
      <p className={styles.cardNote}>
        {checkedAtText(impact.checkedAt)} 時点で確認
      </p>
    </div>
  )
}

export default function EditCommonVarV8() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <EditCommonVarV8Inner />
    </Suspense>
  )
}
