'use client'

/*
 * ★V8 成果地点を作る（Pencil：作る `j8p3yj`・競合 `cXqlS`）。
 *
 * 型（CreatePage）に、4つの段（何が起きたら・何回まで・金額・数えない条件）と
 * 下書き・詳細設定の段、右の列（この30日にあてはめると・使う場所）、下の帯を渡す。
 *
 * 聞く項目・保存の口・送る形は今の作る画面（app/conversions/new/conversion-create-v8.tsx）と同じ
 * （BEHAVIOR.md）。違うのは見せ方だけ：
 * - 使う場所は種類ごとの1行（チェック＝その種類を全部使う／外す）。1つずつ選ぶのは「使う場所を足す」の窓で
 * - 競合（cXqlS）：同じ名前の成果地点がすでにある（入力中に見つかった／保存したら先に作られていた 409）とき、
 *   板の頭の下に帯を出し、主ボタンは「比べてから保存」になる
 */
import { SaveConflictBand } from '@/components/shared/save-conflict'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import {
  api,
  ApiError,
  type ConversionDeduplicationMode,
  type ConversionDefinitionPreview,
  type ConversionDefinitionUsageKind,
  type ConversionReversalPolicy,
  type ConversionValueMode,
} from '@/lib/api'
import type { ConversionPoint } from '@line-crm/shared'
import { CreatePage } from '@/components/templates'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import Disclosure from '@/components/shared/disclosure'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { TextField } from '@/components/shared/text-field'
import { Field } from '@/components/shared/form-controls'
import Card from '@/components/shared/card'
import { focusConversionField, type ConversionFieldIssue } from './field-issue'
import ConditionBuilder, { findConditionDraftIssue, isEmptyCondition, pruneCondition } from '@/components/shared/condition-builder'
import type { SegmentCondition } from '@/lib/segment-condition'
import { originInfoOf } from './origin-labels'
import { createLatestPreviewRequestGate, type LatestPreviewRequest } from './latest-preview-request'
import styles from './create.module.css'

/* 数えるきっかけ6種（今の作る画面と同じ中身）。 */
type TriggerKind = 'order' | 'form' | 'booking' | 'page' | 'video' | 'tag'

interface TriggerChoice {
  value: TriggerKind
  label: string
  note: string
  eventType: string
  measureMethod: 'url_reach' | 'webhook'
}

const TRIGGER_CHOICES: TriggerChoice[] = [
  { value: 'order', label: '注文が確定した', note: 'EC 連携', eventType: 'ec_order_confirmed', measureMethod: 'webhook' },
  { value: 'form', label: 'フォームが送信された', note: '回答フォーム', eventType: 'form_submitted', measureMethod: 'webhook' },
  { value: 'booking', label: '予約が確定した', note: '予約管理', eventType: 'reservation_confirmed', measureMethod: 'webhook' },
  { value: 'page', label: 'ページを見た', note: 'サイトスクリプト', eventType: 'url_reach', measureMethod: 'url_reach' },
  { value: 'video', label: '動画を見終えた', note: 'ウェビナー', eventType: 'webinar_completed', measureMethod: 'webhook' },
  { value: 'tag', label: 'タグが付いた', note: '友だち属性', eventType: 'tag_added', measureMethod: 'webhook' },
]

const VALUE_MODE_LABELS: Record<ConversionValueMode, string> = {
  source: '注文の金額',
  fixed: '決まった額',
  none: '金額を集計しない',
}

const REVERSAL_OPTIONS = [
  { value: 'source_cancelled', label: '件数と金額を引く' },
  { value: 'manual', label: '担当者が取り消す' },
  { value: 'none', label: '取り消しを数えない' },
]

type UsageGroupKind = 'analytics' | 'nen_campaign' | 'automation'

const USAGE_GROUPS: Array<{ kind: UsageGroupKind; label: string }> = [
  { kind: 'analytics', label: '分析（ファネル・レポート）' },
  { kind: 'nen_campaign', label: 'NEN配信' },
  { kind: 'automation', label: '自動化（オートメーション）' },
]

interface UsageTarget {
  kind: ConversionDefinitionUsageKind
  refId: string
  refVersionId?: string | null
  label: string
}

function usageKey(target: Pick<UsageTarget, 'kind' | 'refId'>): string {
  return `${target.kind}:${target.refId}`
}

type UsageKindState = 'idle' | 'loading' | 'ok' | 'error' | 'forbidden'

interface UsageKindResult {
  state: UsageKindState
  targets: UsageTarget[]
}

const EMPTY_USAGE_KINDS: Record<UsageGroupKind, UsageKindResult> = {
  analytics: { state: 'idle', targets: [] },
  nen_campaign: { state: 'idle', targets: [] },
  automation: { state: 'idle', targets: [] },
}

/* 種類ごとに候補を読む（今の作る画面と同じ口）。 */
async function fetchUsageTargets(kind: UsageGroupKind, accountId: string): Promise<UsageTarget[]> {
  if (kind === 'analytics') {
    const res = await api.analytics.v6Funnels.list(accountId)
    if (!res.success) throw new Error(res.error)
    return res.data.map((funnel) => ({ kind, refId: funnel.id, refVersionId: funnel.currentVersion?.id ?? null, label: funnel.name }))
  }
  if (kind === 'nen_campaign') {
    const res = await api.nenCampaigns.settings(accountId)
    if (!res.success) throw new Error(res.error)
    return res.data.map((campaign) => ({ kind, refId: campaign.campaignKey, label: campaign.label }))
  }
  const res = await api.automations.list({ accountId })
  if (!res.success) throw new Error(res.error)
  return res.data.map((automation) => ({ kind, refId: automation.id, refVersionId: automation.versionId ?? null, label: automation.name }))
}

function normalizeName(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('ja')
}

export default function ConversionCreateV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <ConversionCreate />
    </Suspense>
  )
}

function ConversionCreate() {
  usePageTitle('成果地点を作る')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: 'コンバージョン', href: '/conversions?tab=points' },
  ])
  const router = useRouter()
  /* `?name=` で名前を入れて開ける（ほかの画面から「この名前で作る」）。 */
  const initialName = useSearchParams().get('name') ?? ''
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  /*
   * 閲覧のみと分かったら、押せない入力の欄は置かず閲覧のみの帯だけを出す（2026-10-06 オーナー決定）。
   * 作る画面なので、閲覧のみの人に見せる中身は無い。役割を読むまでは今までどおり欄を出す（保存は役割が分かってから）。
   */
  const viewerOnly = role !== null && !canEdit
  const { selectedAccountId, selectedAccount } = useAccount()
  const [name, setName] = useState(initialName)
  const [triggerKind, setTriggerKind] = useState<TriggerKind>('order')
  const [eventType, setEventType] = useState('ec_order_confirmed')
  const [value, setValue] = useState('')
  const [valueMode, setValueMode] = useState<ConversionValueMode>('source')
  const [valueModeNotice, setValueModeNotice] = useState<string | null>(null)
  const [measureMethod, setMeasureMethod] = useState<'url_reach' | 'webhook'>('webhook')
  const [targetUrl, setTargetUrl] = useState('')
  const [exclusion, setExclusion] = useState<SegmentCondition | null>(null)
  const [exclusionMemo, setExclusionMemo] = useState('')
  const [deduplicationMode, setDeduplicationMode] = useState<ConversionDeduplicationMode>('once_per_friend')
  const [reversalPolicy, setReversalPolicy] = useState<ConversionReversalPolicy>('source_cancelled')
  const [attributionDays, setAttributionDays] = useState('')
  const [saveAsDraft, setSaveAsDraft] = useState(false)
  const [points, setPoints] = useState<ConversionPoint[]>([])
  const [pointsFailed, setPointsFailed] = useState(false)
  const [usageKinds, setUsageKinds] = useState<Record<UsageGroupKind, UsageKindResult>>(EMPTY_USAGE_KINDS)
  const [selectedUsageKeys, setSelectedUsageKeys] = useState<Set<string>>(new Set())
  const [usagePickerOpen, setUsagePickerOpen] = useState(false)
  const [preview, setPreview] = useState<ConversionDefinitionPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const previewRequests = useRef(createLatestPreviewRequestGate())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [fieldIssue, setFieldIssue] = useState<ConversionFieldIssue | null>(null)
  useEffect(() => {
    if (fieldIssue) focusConversionField(fieldIssue.field)
  }, [fieldIssue])
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  /* 保存したら、ほかの人が先に同じ名前で作っていた（409）。名前を変えるまで帯を出す。 */
  const [serverConflictName, setServerConflictName] = useState<string | null>(null)

  const requestPoints = useCallback(() => {
    setPointsFailed(false)
    void api.conversions.points().then((response) => {
      if (response.success) {
        setPoints(response.data)
        setPointsFailed(false)
      } else {
        setPointsFailed(true)
      }
    }).catch(() => setPointsFailed(true))
  }, [])

  useEffect(() => { requestPoints() }, [requestPoints])

  const lineAccountId = selectedAccountId ?? ''

  const usageRequestIds = useRef<Record<UsageGroupKind, number>>({ analytics: 0, nen_campaign: 0, automation: 0 })
  const requestUsageKind = useCallback((kind: UsageGroupKind, accountId: string) => {
    const requestId = ++usageRequestIds.current[kind]
    setUsageKinds((current) => ({ ...current, [kind]: { ...current[kind], state: 'loading' } }))
    void fetchUsageTargets(kind, accountId).then((targets) => {
      if (usageRequestIds.current[kind] !== requestId) return
      setUsageKinds((current) => ({ ...current, [kind]: { state: 'ok', targets } }))
      setSelectedUsageKeys((current) =>
        new Set([...current].filter((key) => !key.startsWith(`${kind}:`) || targets.some((target) => usageKey(target) === key))))
    }).catch((error: unknown) => {
      if (usageRequestIds.current[kind] !== requestId) return
      setUsageKinds((current) => ({
        ...current,
        [kind]: { state: error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error', targets: [] },
      }))
    })
  }, [])

  useEffect(() => {
    if (!lineAccountId) {
      setUsageKinds(EMPTY_USAGE_KINDS)
      return
    }
    for (const group of USAGE_GROUPS) requestUsageKind(group.kind, lineAccountId)
  }, [lineAccountId, requestUsageKind])

  const usageTargets = useMemo(() => USAGE_GROUPS.flatMap((group) => usageKinds[group.kind].targets), [usageKinds])

  /* 同じ名前の警告は、同じ集計対象の中だけで出す（今の作る画面と同じ）。 */
  const duplicateName = useMemo(() => {
    const normalized = normalizeName(name)
    if (!normalized) return null
    return points.find(
      (point) => normalizeName(point.name) === normalized && (point.lineAccountId == null || point.lineAccountId === lineAccountId),
    ) ?? null
  }, [name, points, lineAccountId])
  const serverConflict = serverConflictName !== null && normalizeName(serverConflictName) === normalizeName(name)
  const conflict = duplicateName !== null || serverConflict

  const yen = value ? Number(value) : null
  const origin = originInfoOf(eventType)

  /* 入力中の条件で、この30日にあてはめた見込みを出す（保存しない）。古い試算は捨てる。 */
  useEffect(() => {
    if (!lineAccountId) return
    let request: LatestPreviewRequest | null = null
    const timer = window.setTimeout(() => {
      request = previewRequests.current.start()
      setPreviewLoading(true)
      setPreviewFailed(false)
      void api.conversions.previewDefinition({
        sourceType: eventType,
        sourceConfig: { triggerKind, exclusion: pruneCondition(exclusion), exclusionMemo: exclusionMemo.trim() || null },
        targetUrl: measureMethod === 'url_reach' ? targetUrl.trim() : null,
        lineAccountId,
        deduplicationMode,
        deduplicationWindowDays: deduplicationMode === 'window' ? 30 : null,
        valueMode,
        fixedValue: valueMode === 'fixed' && Number.isFinite(yen) ? yen : null,
        reversalPolicy,
      }, { signal: request.signal }).then((response) => {
        if (!request?.isCurrent()) return
        if (response.success) setPreview(response.data)
        else setPreviewFailed(true)
      }).catch(() => {
        if (request?.isCurrent()) setPreviewFailed(true)
      }).finally(() => {
        if (request?.isCurrent()) setPreviewLoading(false)
      })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      request?.abort()
    }
  }, [deduplicationMode, eventType, exclusion, exclusionMemo, lineAccountId, measureMethod, reversalPolicy, targetUrl, triggerKind, valueMode, yen])

  const toggleUsage = (target: UsageTarget) => {
    setSelectedUsageKeys((current) => {
      const next = new Set(current)
      const key = usageKey(target)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /* 種類の行のチェック：その種類の候補を全部使う／全部外す。 */
  const toggleUsageGroup = (kind: UsageGroupKind, use: boolean) => {
    const targets = usageKinds[kind].targets
    setSelectedUsageKeys((current) => {
      const next = new Set(current)
      for (const target of targets) {
        if (use) next.add(usageKey(target))
        else next.delete(usageKey(target))
      }
      return next
    })
  }

  const selectTrigger = (eventTypeValue: string) => {
    const choice = TRIGGER_CHOICES.find((item) => item.eventType === eventTypeValue)
    if (!choice) return
    const nextOrigin = originInfoOf(choice.eventType)
    setTriggerKind(choice.value)
    setEventType(choice.eventType)
    setMeasureMethod(choice.measureMethod)
    if (choice.measureMethod !== 'url_reach') setTargetUrl('')
    if (!nextOrigin.valueModes.includes(valueMode)) {
      setValueMode(nextOrigin.defaultValueMode)
      setValueModeNotice(`起点に注文の金額が無いため、金額の出し方を「${VALUE_MODE_LABELS[nextOrigin.defaultValueMode]}」に戻しました。`)
    } else {
      setValueModeNotice(null)
    }
  }

  /* 入力の点検（今の作る画面と同じ）。 */
  const validate = (): ConversionFieldIssue | null => {
    if (!name.trim()) return { field: 'cv-name', message: '成果地点の名前を入力してください' }
    if (measureMethod === 'url_reach' && !targetUrl.trim()) return { field: 'cv-url', message: '指定ページへの到達で数えるときは、対象のURLが要ります' }
    if (exclusionMemo.trim().length > 500) return { field: 'cv-memo', message: '数えない条件のメモは500文字以内で入力してください' }
    const exclusionIssue = findConditionDraftIssue(exclusion)
    if (exclusionIssue) return { field: 'cv-exclusion-fields', message: exclusionIssue }
    if (!origin.valueModes.includes(valueMode)) {
      return { field: 'cv-value-mode', message: 'この起点には注文の金額が無いため、金額の出し方は「決まった額」か「金額を集計しない」を選んでください' }
    }
    if (valueMode === 'fixed' && (yen === null || !Number.isFinite(yen) || yen < 0)) return { field: 'cv-value', message: '固定で付ける金額は0以上の数値で入力してください' }
    if (attributionDays) {
      const days = Number(attributionDays)
      if (!Number.isInteger(days) || days < 1 || days > 365) return { field: 'cv-days', message: '成果を紐づける日数は1〜365日で入力してください' }
    }
    return null
  }

  const resetForm = () => {
    setName('')
    setValue('')
    setValueMode(originInfoOf(eventType).defaultValueMode)
    setValueModeNotice(null)
    setTargetUrl('')
    setExclusion(null)
    setExclusionMemo('')
    setDeduplicationMode('once_per_friend')
    setReversalPolicy('source_cancelled')
    setAttributionDays('')
    setSaveAsDraft(false)
    setSelectedUsageKeys(new Set())
  }

  const runSave = async (andContinue: boolean) => {
    if (!canEdit || saving) return
    if (conflict) { focusConversionField('cv-name'); return }
    const failed = validate()
    setFieldIssue(failed)
    setSaveError(null)
    setSavedNotice(null)
    if (failed) return
    if (!lineAccountId) {
      setSaveError('集計対象のLINEアカウントを選んでください（画面上部で選べます）')
      return
    }
    setSaving(true)
    try {
      const res = await api.conversions.createDefinition({
        name: name.trim(),
        sourceType: eventType,
        sourceConfig: { triggerKind, exclusion: pruneCondition(exclusion), exclusionMemo: exclusionMemo.trim() || null },
        targetUrl: measureMethod === 'url_reach' ? targetUrl.trim() : null,
        lineAccountId,
        deduplicationMode,
        deduplicationWindowDays: deduplicationMode === 'window' ? 30 : null,
        valueMode,
        fixedValue: valueMode === 'fixed' ? yen : null,
        reversalPolicy,
        attributionDays: attributionDays ? Number(attributionDays) : null,
        usages: usageTargets
          .filter((target) => selectedUsageKeys.has(usageKey(target)))
          .map(({ kind, refId, refVersionId }) => ({ refKind: kind, refId, refVersionId })),
        draft: saveAsDraft,
      })
      if (!res.success) throw new Error(res.error)
      if (andContinue) {
        resetForm()
        setSavedNotice('保存しました。続けて作れます。')
      } else {
        router.push(`/conversions?tab=points${res.data.id ? `&highlight=${encodeURIComponent(res.data.id)}` : ''}`)
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        /* ほかの人が先に同じ名前で保存していた。上書きせず、帯で比べ方を出す。 */
        setServerConflictName(name)
        setSaveError(null)
        requestPoints()
      } else {
        setSaveError('保存できませんでした。権限を確認して、もう一度お試しください。')
      }
    } finally {
      setSaving(false)
    }
  }

  const dirty = Boolean(
    (name && name !== initialName) || value || targetUrl || exclusionMemo || attributionDays ||
    triggerKind !== 'order' || eventType !== 'ec_order_confirmed' ||
    valueMode !== 'source' || measureMethod !== 'webhook' ||
    exclusion !== null || deduplicationMode !== 'once_per_friend' ||
    reversalPolicy !== 'source_cancelled' || saveAsDraft ||
    selectedUsageKeys.size > 0,
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty })

  const scrollToExclusion = () => {
    document.getElementById('cv-exclusion')?.scrollIntoView({ block: 'center' })
  }

  const conflictTarget = duplicateName ?? points.find((point) => normalizeName(point.name) === normalizeName(name)) ?? null
  const compareHref = conflictTarget
    ? `/conversions?tab=points&highlight=${encodeURIComponent(conflictTarget.id)}`
    : '/conversions?tab=points'
  const reloadLatest = () => {
    setServerConflictName(null)
    requestPoints()
  }

  const excluded = preview ? preview.excludedCount ?? preview.duplicateExcludedCount + preview.cancellationCount : null
  const previewNote = previewFailed
    ? '保存前の試算を読み込めませんでした。入力内容は保存されていません。'
    : preview
      ? `入力中の条件だけで試算しています。重複除外 ${formatNumber(preview.duplicateExcludedCount)}件・取消 ${formatNumber(preview.cancellationCount)}件・1日あたり ${formatNumber(preview.dailyAverage)}件。試算では成果を追加しません。`
      : '入力中の条件を試算しています。'

  const previewColumn = (
    <div className={styles.side}>
      <Card variant="aside" aria-labelledby="cv-new-preview">
        <div className={styles.sideHead}>
          <h2 className={styles.sideTitle} id="cv-new-preview">この決めごとを この30日に あてはめると</h2>
          <p className={styles.sideNote} aria-busy={previewLoading}>
            {previewFailed ? '試算を読み込めませんでした（入力は保存されていません）' : '前の日にさかのぼっては数えません（見込みです）'}
            <HelpTip label="この試算の説明">{previewNote}</HelpTip>
          </p>
        </div>
        <dl className={styles.previewRows}>
          <div className={styles.previewRow}><dt>成果</dt><dd>{preview ? `${formatNumber(preview.estimatedCount)}件` : '—'}</dd></div>
          <div className={styles.previewRow}><dt>金額</dt><dd>{preview ? `¥${formatNumber(preview.estimatedValue)}` : '—'}</dd></div>
          <div className={styles.previewRow}><dt>人数</dt><dd>{preview && typeof preview.uniqueFriendCount === 'number' ? `${formatNumber(preview.uniqueFriendCount)}人` : '—'}</dd></div>
          <div className={styles.previewRow}><dt>除いた注文</dt><dd>{excluded == null ? '—' : `${formatNumber(excluded)}件`}</dd></div>
        </dl>
        {preview && !previewFailed && preview.excludedReasons.length > 0 ? (
          <ul className={styles.previewReasons}>
            {preview.excludedReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        ) : null}
      </Card>

      <Card variant="aside" aria-labelledby="cv-new-usage">
        <div className={styles.sideHead}>
          <h2 className={styles.sideTitle} id="cv-new-usage">この成果地点を使う場所</h2>
          <p className={styles.sideNote}>使う所にチェックを入れます（作ったあとにも足せます）</p>
        </div>
        <div className={styles.usageRows}>
          {USAGE_GROUPS.map((group) => {
            const result = usageKinds[group.kind]
            const chosen = result.targets.filter((target) => selectedUsageKeys.has(usageKey(target))).length
            const all = result.targets.length
            const stateText = result.state === 'loading' || result.state === 'idle'
              ? '読み込み中'
              : result.state === 'forbidden'
                ? '見る権限なし'
                : result.state === 'error'
                  ? '読み込めません'
                  : all === 0
                    ? 'まだ無い'
                    : chosen === 0 ? '使わない' : chosen === all ? '使う' : `${chosen}/${all}件`
            return (
              <div key={group.kind} className={styles.usageRow}>
                <Checkbox
                  checked={all > 0 && chosen === all}
                  indeterminate={chosen > 0 && chosen < all}
                  disabled={result.state !== 'ok' || all === 0}
                  onCheckedChange={(next) => toggleUsageGroup(group.kind, next)}
                >{group.label}</Checkbox>
                {result.state === 'error' ? (
                  <Button variant="text" onClick={() => requestUsageKind(group.kind, lineAccountId)} disabled={!lineAccountId}>読み直す</Button>
                ) : (
                  <span className={styles.usageState} role={result.state === 'forbidden' ? 'status' : undefined}>{stateText}</span>
                )}
              </div>
            )
          })}
        </div>
        {canEdit ? (
          <div>
            <Button variant="text" onClick={() => setUsagePickerOpen(true)}><Plus size={15} aria-hidden="true" />使う場所を足す</Button>
          </div>
        ) : null}
      </Card>
    </div>
  )

  const footerActions = canEdit ? (
    <>
      <Button href="/conversions?tab=points">キャンセル</Button>
      <Button disabled={saving} onClick={() => void runSave(true)} busy={saving} busyLabel="保存しています">保存して続けて作る</Button>
      {conflict ? (
        <Button variant="primary" href={compareHref}><Check size={15} aria-hidden="true" />比べてから保存</Button>
      ) : (
        <Button variant="primary" disabled={saving} onClick={() => void runSave(false)} busy={saving} busyLabel="保存しています">
          <Check size={15} aria-hidden="true" />{saveAsDraft ? '下書きを保存する' : '保存して数えはじめる'}
        </Button>
      )}
    </>
  ) : (
    <Button href="/conversions?tab=points">一覧へ戻る</Button>
  )

  /* 帯は共通部品（save-conflict）に寄せた。名前の重なりと先の保存で題を言い分ける。 */
  const conflictBand = conflict ? (
    <div className={styles.conflictSlot}>
    <SaveConflictBand
      designNode="cXqlS"
      title={serverConflict && !duplicateName
        ? `ほかの人が「${name.trim()}」を先に保存しました`
        : `同じ名前の「${duplicateName?.name ?? name.trim()}」がすでにあります`}
      description="このまま保存すると、同じ意味の成果地点が2つになり、分析の数字が二重になります"
      compareHref={compareHref}
      onReload={reloadLatest}
    />
    </div>
  ) : null

  return (
    <CreatePage
      boardId="j8p3yj"
      title="成果地点を作る"
      description="「何が起きたら・何回まで・いくら」を決めると、その日から数えはじめます。前の日にさかのぼっては数えません。"
      /* 競合の帯は型の notice に渡し、入力欄と右の列の上に置く。 */
      notice={conflictBand}
      preview={viewerOnly ? undefined : previewColumn}
      footerActions={footerActions}
    >
      {viewerOnly ? (
        <div className={styles.viewerBand} role="status">閲覧のみで見ています。作る操作は管理者に頼んでください。</div>
      ) : null}
      {savedNotice ? <Notice tone="success">{savedNotice}</Notice> : null}
      {saveError ? <Notice tone="danger">{saveError}</Notice> : null}

      {viewerOnly ? null : (<>

      <Card variant="form" aria-labelledby="cv-new-what">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="cv-new-what">何が起きたら数えますか</h2>
          <p className={styles.cardNote}>名前は一覧で見分けるため。お客さまには見えません</p>
        </div>
        <Field label="名前" htmlFor="cv-name" error={fieldIssue?.field === 'cv-name' ? fieldIssue.message : undefined}>
          <TextField
            aria-label="成果地点の名前"
            value={name}
            maxLength={120}
            placeholder="商品を買った"
            onChange={(event) => { setFieldIssue((current) => current?.field === 'cv-name' ? null : current); setName(event.target.value) }}
          />
        </Field>
        {pointsFailed ? (
          <div className={styles.inlineRetry}>
            <p className={styles.fieldNote} role="alert">同じ名前があるか確認できませんでした。同じ意味の成果地点があるかもしれません。</p>
            <Button variant="text" onClick={() => requestPoints()}>同名の確認を再読み込み</Button>
          </div>
        ) : null}
        <div className={styles.field}>
          <span className={styles.pickLabel}>できごと</span>
          <div className={styles.selectBox}>
            <Select
              size="full"
              aria-label="できごと"
              value={eventType}
              options={TRIGGER_CHOICES.map((choice) => ({ value: choice.eventType, label: `${choice.label}（${choice.note}）` }))}
              onChange={selectTrigger}
            />
          </div>
        </div>
        {measureMethod === 'url_reach' ? (
          <Field label="数えてよいページ" htmlFor="cv-url" error={fieldIssue?.field === 'cv-url' ? fieldIssue.message : undefined}>
            <TextField
              aria-label="数えてよいページ"
              inputMode="url"
              value={targetUrl}
              maxLength={2000}
              placeholder="https://example.com/thanks"
              onChange={(event) => { setFieldIssue((current) => current?.field === 'cv-url' ? null : current); setTargetUrl(event.target.value) }}
            />
          </Field>
        ) : null}
        <div className={styles.chipRow}>
          <span className={styles.conditionTag}>{isEmptyCondition(pruneCondition(exclusion)) ? '除外なし' : '数えない条件あり'}</span>
          {canEdit ? (
            <button type="button" className={styles.linkButton} onClick={scrollToExclusion}>
              <Plus size={13} aria-hidden="true" />「いずれか1つ以上を満たす」条件を足す
            </button>
          ) : null}
        </div>
      </Card>

      <Card variant="form" aria-labelledby="cv-new-dedup">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="cv-new-dedup">同じ人を何回まで数えるか</h2>
          <p className={styles.cardNote}>くり返し起きるできごとは、数えすぎを防ぎます</p>
        </div>
        <RadioCardGroup legend="同じ人を何回まで数えるか" className={styles.dedupRow}>
          <RadioCard
            name="conversion-create-dedup"
            value="once_per_friend"
            checked={deduplicationMode === 'once_per_friend'}
            onChange={() => setDeduplicationMode('once_per_friend')}
            title="1人1回だけ"
            note="はじめての人だけを数えます"
            size="small"
          />
          <RadioCard
            name="conversion-create-dedup"
            value="window"
            checked={deduplicationMode === 'window'}
            onChange={() => setDeduplicationMode('window')}
            title="30日に1回まで"
            note="短い間にくり返し起きるものに"
            size="small"
          />
          <RadioCard
            name="conversion-create-dedup"
            value="every"
            checked={deduplicationMode === 'every'}
            onChange={() => setDeduplicationMode('every')}
            title="何回でも"
            note="買うたびに数えます。売上を追うときに"
            size="small"
          />
        </RadioCardGroup>
      </Card>

      <Card variant="form" aria-labelledby="cv-new-value">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="cv-new-value">金額をどう出すか</h2>
          <p className={styles.cardNote}>アフィリエイトの報酬や、配信ごとの売上の計算に使います</p>
        </div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.pickLabel}>金額の出し方</span>
            <div className={styles.selectBox}>
              <Select
                size="full"
                id="cv-value-mode"
                error={fieldIssue?.field === 'cv-value-mode' ? fieldIssue.message : undefined}
                aria-label="金額の出し方"
                value={valueMode}
                options={origin.valueModes.map((mode) => ({ value: mode, label: VALUE_MODE_LABELS[mode] }))}
                onChange={(next) => {
                  setFieldIssue((current) => current?.field === 'cv-value-mode' ? null : current)
                  setValueMode(next as ConversionValueMode)
                  setValueModeNotice(null)
                }}
              />
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.pickLabel}>取り消されたとき</span>
            <div className={styles.selectBox}>
              <Select
                size="full"
                aria-label="取り消されたとき"
                value={reversalPolicy}
                options={REVERSAL_OPTIONS}
                onChange={(next) => setReversalPolicy(next as ConversionReversalPolicy)}
              />
            </div>
          </div>
        </div>
        {valueModeNotice ? <p className={styles.fieldNote} role="status">{valueModeNotice}</p> : null}
        {valueMode === 'fixed' ? (
          <Field label="1件あたりの金額（円）" htmlFor="cv-value" error={fieldIssue?.field === 'cv-value' ? fieldIssue.message : undefined}>
            <TextField
              aria-label="決まった金額"
              inputMode="numeric"
              value={value}
              placeholder="0"
              onChange={(event) => { setFieldIssue((current) => current?.field === 'cv-value' ? null : current); setValue(event.target.value) }}
            />
          </Field>
        ) : null}
      </Card>

      <Card variant="form" aria-labelledby="cv-new-exclusion" id="cv-exclusion">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="cv-new-exclusion">数えない条件</h2>
          <p className={styles.cardNote}>任意。テスト用の注文などを除きます</p>
        </div>
        <label className={styles.field}>
          <span className={styles.labelRow}><span className={styles.label}>メモ</span><span className={styles.optional}>任意</span></span>
          <TextField
            id="cv-memo"
            aria-label="数えない条件のメモ"
            invalid={fieldIssue?.field === 'cv-memo'}
            aria-describedby={fieldIssue?.field === 'cv-memo' ? 'cv-memo-error' : undefined}
            value={exclusionMemo}
            maxLength={500}
            placeholder="例：テスト用の注文は条件で除いています"
            onChange={(event) => { setFieldIssue((current) => current?.field === 'cv-memo' ? null : current); setExclusionMemo(event.target.value) }}
          />
        </label>
        {fieldIssue?.field === 'cv-memo' ? <p id="cv-memo-error" className={styles.fieldError} role="alert">{fieldIssue.message}</p> : null}
        <div id="cv-exclusion-fields" aria-invalid={fieldIssue?.field === 'cv-exclusion-fields' || undefined}>
          <Field label="除く条件" error={fieldIssue?.field === 'cv-exclusion-fields' ? fieldIssue.message : undefined}>
          {canEdit ? (
            <ConditionBuilder value={exclusion} onChange={(next) => { setFieldIssue((current) => current?.field === 'cv-exclusion-fields' ? null : current); setExclusion(next) }} label="数えない条件" showCount={false} />
          ) : (
            <p className={styles.fieldNote}>{isEmptyCondition(pruneCondition(exclusion)) ? '除外なし' : '数えない条件あり'}</p>
          )}
          </Field>
        </div>
      </Card>

      <Card variant="form" aria-labelledby="cv-new-more">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="cv-new-more">下書きと詳細設定</h2>
          <p className={styles.cardNote}>任意。すぐに数えはじめないときや、紐づける日数を変えるときに</p>
        </div>
        <Checkbox
          checked={saveAsDraft}
          onCheckedChange={setSaveAsDraft}
          description="一覧の「下書き」に入ります。数えはじめるには一覧から公開します。"
        >まだ計測せず、下書きとして保存する</Checkbox>
        <Disclosure size="compact" title="詳細設定" hint="帰属期間・集計対象">
          <div className={styles.fieldRow}>
            <Field label="友だち追加からの計測期間（日）" htmlFor="cv-days" error={fieldIssue?.field === 'cv-days' ? fieldIssue.message : undefined}>
              <TextField
                aria-label="友だち追加からの計測期間"
                inputMode="numeric"
                value={attributionDays}
                placeholder="90"
                onChange={(event) => { setFieldIssue((current) => current?.field === 'cv-days' ? null : current); setAttributionDays(event.target.value) }}
              />
              <span className={styles.fieldNote}>空欄なら既定の90日です。</span>
            </Field>
            <div className={styles.field}>
              <span className={styles.label}>集計対象アカウント</span>
              <p className={styles.fixedBox}>{selectedAccount ? selectedAccount.name : '未選択（画面上部で選んでください）'}</p>
            </div>
          </div>
        </Disclosure>
      </Card>
      </>)}

      <Dialog
        open={usagePickerOpen}
        title="使う場所を足す"
        description="この成果地点を使う所を、1つずつ選べます。作ったあとにも一覧の「使う場所を足す」から足せます。"
        designWidth={560}
        confirmLabel="決める"
        onConfirm={() => setUsagePickerOpen(false)}
        onCancel={() => setUsagePickerOpen(false)}
      >
        <div className={styles.pickerGroups}>
          {USAGE_GROUPS.map((group) => {
            const result = usageKinds[group.kind]
            return (
              <div key={group.kind} className={styles.pickerGroup}>
                <p className={styles.pickLabel}>{group.label}</p>
                {result.state === 'ok' && result.targets.length > 0 ? (
                  <ul className={styles.pickerList}>
                    {result.targets.map((target) => (
                      <li key={usageKey(target)}>
                        <Checkbox checked={selectedUsageKeys.has(usageKey(target))} onCheckedChange={() => toggleUsage(target)}>{target.label}</Checkbox>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.fieldNote}>
                    {result.state === 'ok' ? `使える${group.label}がまだありません`
                      : result.state === 'forbidden' ? `このアカウントの${group.label}を見る権限がありません`
                        : result.state === 'error' ? `使える${group.label}を読み込めませんでした`
                          : '候補を読み込んでいます'}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </Dialog>
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した成果地点" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </CreatePage>
  )
}
