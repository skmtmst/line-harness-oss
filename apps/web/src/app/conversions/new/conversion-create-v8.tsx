'use client'

/*
 * ★V8-B 成果地点を作る（Pencil「★V8-B 画面の地図」：作る `j8p3yj`、
 * 競合 `cXqlS`）。
 *
 * v7 の作る画面（`new/page.tsx`）とは別の見せ方。聞く項目・順番・
 * 保存の動きは v7 と同じ（名前の重複・金額・URL・条件・使う場所・
 * 下書き）。右の列に30日の試算と使う場所を置き、下の帯は追従する。
 * v7 を直す必要が出たら `new/page.tsx` 側も同じ判断を入れる
 * （V8 完成までの二重管理）。
 *
 * 競合（`cXqlS`）：同じ名前の成果地点がすでにあったとき（他の人が
 * 先に保存した）に帯で出す。「違いを比べる」はその行の一覧へ飛ぶ。
 * 「最新を読み込んで続ける」は同名の一覧を取り直す。
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Disclosure from '@/components/shared/disclosure'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import ConditionBuilder, { findConditionDraftIssue, isEmptyCondition, pruneCondition } from '@/components/shared/condition-builder'
import type { SegmentCondition } from '@/lib/segment-condition'
import { inputClass } from '@/components/shared/create-page'
import { originInfoOf } from '../origin-labels'
import { createLatestPreviewRequestGate, type LatestPreviewRequest } from './latest-preview-request'
import styles from './conversion-create-v8.module.css'

/*
 * 数えるきっかけ6種。`new/page.tsx` の `TRIGGER_CHOICES` と同じ中身
 * （見せ方だけ V8 の選ぶ欄に合わせる）。
 */
type TriggerKind = 'order' | 'form' | 'booking' | 'page' | 'video' | 'tag'

interface TriggerChoice {
  value: TriggerKind
  label: string
  note: string
  eventType: string
  measureMethod: 'url_reach' | 'webhook'
}

const TRIGGER_CHOICES: TriggerChoice[] = [
  { value: 'order', label: '注文が確定した', note: 'EC連携', eventType: 'ec_order_confirmed', measureMethod: 'webhook' },
  { value: 'form', label: 'フォームが送信された', note: '回答フォーム', eventType: 'form_submitted', measureMethod: 'webhook' },
  { value: 'booking', label: '予約が確定した', note: '予約管理', eventType: 'reservation_confirmed', measureMethod: 'webhook' },
  { value: 'page', label: 'ページを見た', note: 'サイトスクリプト', eventType: 'url_reach', measureMethod: 'url_reach' },
  { value: 'video', label: '動画を見終えた', note: 'ウェビナー', eventType: 'webinar_completed', measureMethod: 'webhook' },
  { value: 'tag', label: 'タグが付いた', note: '友だち属性', eventType: 'tag_added', measureMethod: 'webhook' },
]

/* 金額の出し方の表示名（`new/page.tsx` と同じ言葉）。 */
const VALUE_MODE_LABELS: Record<ConversionValueMode, string> = {
  source: '注文の金額をそのまま使う',
  fixed: '決まった額を使う',
  none: '金額を集計しない',
}

const REVERSAL_OPTIONS = [
  { value: 'source_cancelled', label: '返品されたら取り消す' },
  { value: 'manual', label: '担当者が取り消す' },
  { value: 'none', label: '取り消しを数えない' },
]

/* 「使う場所」の種類（`new/page.tsx` の `USAGE_GROUPS` と同じ）。 */
type UsageGroupKind = 'analytics' | 'nen_campaign' | 'automation'

const USAGE_GROUPS: Array<{ kind: UsageGroupKind; label: string; note: string }> = [
  { kind: 'analytics', label: '分析（ファネル・レポート）', note: 'この成果地点を段に使うファネル' },
  { kind: 'nen_campaign', label: 'NEN配信', note: 'この成果をきっかけにする配信' },
  { kind: 'automation', label: '自動化（オートメーション）', note: 'この成果をきっかけに動く処理' },
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

/* 種類ごとに候補を読む（`new/page.tsx` の `fetchUsageTargets` と同じ）。 */
async function fetchUsageTargets(kind: UsageGroupKind, accountId: string): Promise<UsageTarget[]> {
  if (kind === 'analytics') {
    const res = await api.analytics.v6Funnels.list(accountId)
    if (!res.success) throw new Error(res.error)
    return res.data.map((funnel) => ({
      kind, refId: funnel.id, refVersionId: funnel.currentVersion?.id ?? null, label: funnel.name,
    }))
  }
  if (kind === 'nen_campaign') {
    const res = await api.nenCampaigns.settings(accountId)
    if (!res.success) throw new Error(res.error)
    return res.data.map((campaign) => ({ kind, refId: campaign.campaignKey, label: campaign.label }))
  }
  const res = await api.automations.list({ accountId })
  if (!res.success) throw new Error(res.error)
  return res.data.map((automation) => ({
    kind, refId: automation.id, refVersionId: automation.versionId ?? null, label: automation.name,
  }))
}

const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'

export default function ConversionCreateV8() {
  usePageTitle('成果地点を作る')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: 'コンバージョン', href: '/conversions?tab=points' },
  ])
  const router = useRouter()
  const role = useStaffRole()
  // 閲覧のみ：作る操作は押せない形にする（隠さない）。
  const canEdit = canManageRole(role)
  const { selectedAccountId, selectedAccount } = useAccount()
  const [name, setName] = useState('')
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
  const [preview, setPreview] = useState<ConversionDefinitionPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const previewRequests = useRef(createLatestPreviewRequestGate())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)

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

  useEffect(() => {
    requestPoints()
  }, [requestPoints])

  const lineAccountId = selectedAccountId ?? ''

  const usageRequestIds = useRef<Record<UsageGroupKind, number>>({ analytics: 0, nen_campaign: 0, automation: 0 })
  const requestUsageKind = useCallback((kind: UsageGroupKind, accountId: string) => {
    const requestId = ++usageRequestIds.current[kind]
    setUsageKinds((current) => ({ ...current, [kind]: { ...current[kind], state: 'loading' } }))
    void fetchUsageTargets(kind, accountId).then((targets) => {
      if (usageRequestIds.current[kind] !== requestId) return
      setUsageKinds((current) => ({ ...current, [kind]: { state: 'ok', targets } }))
      setSelectedUsageKeys((current) =>
        new Set([...current].filter((key) =>
          !key.startsWith(`${kind}:`) || targets.some((target) => usageKey(target) === key))))
    }).catch((error: unknown) => {
      if (usageRequestIds.current[kind] !== requestId) return
      setUsageKinds((current) => ({
        ...current,
        [kind]: {
          state: error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error',
          targets: [],
        },
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

  const usageTargets = useMemo(
    () => USAGE_GROUPS.flatMap((group) => usageKinds[group.kind].targets),
    [usageKinds],
  )

  // 同じ名前の警告は、同じ集計対象の中だけで出す（`new/page.tsx` と同じ）。
  const duplicateName = useMemo(() => {
    const normalized = name.trim().normalize('NFKC').toLocaleLowerCase('ja')
    if (!normalized) return null
    return points.find(
      (point) => point.name.trim().normalize('NFKC').toLocaleLowerCase('ja') === normalized
        && (point.lineAccountId == null || point.lineAccountId === lineAccountId),
    ) ?? null
  }, [name, points, lineAccountId])

  const yen = value ? Number(value) : null
  const origin = originInfoOf(eventType)

  useEffect(() => {
    if (!lineAccountId) return
    let request: LatestPreviewRequest | null = null
    const timer = window.setTimeout(() => {
      request = previewRequests.current.start()
      setPreviewLoading(true)
      setPreviewFailed(false)
      void api.conversions.previewDefinition({
        sourceType: eventType,
        sourceConfig: {
          triggerKind,
          exclusion: pruneCondition(exclusion),
          exclusionMemo: exclusionMemo.trim() || null,
        },
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
      setValueModeNotice(
        `起点に注文の金額が無いため、金額の出し方を「${VALUE_MODE_LABELS[nextOrigin.defaultValueMode]}」に戻しました。`,
      )
    } else {
      setValueModeNotice(null)
    }
  }

  // 入力の点検（`new/page.tsx` の `validate` と同じ）。
  const validate = (): string | null => {
    if (!name.trim()) return '成果地点の名前を入力してください'
    if (duplicateName) return `「${duplicateName.name}」と同じ名前の成果地点がすでにあります`
    if (measureMethod === 'url_reach' && !targetUrl.trim()) {
      return '指定ページへの到達で数えるときは、対象のURLが要ります'
    }
    if (!lineAccountId) return '集計対象のLINEアカウントを選んでください（画面上部で選べます）'
    if (exclusionMemo.trim().length > 500) return '数えない条件のメモは500文字以内で入力してください'
    const exclusionIssue = findConditionDraftIssue(exclusion)
    if (exclusionIssue) return exclusionIssue
    if (!origin.valueModes.includes(valueMode)) {
      return 'この起点には注文の金額が無いため、金額の出し方は「決まった額を使う」か「金額を集計しない」を選んでください'
    }
    if (valueMode === 'fixed' && (yen === null || !Number.isFinite(yen) || yen < 0)) {
      return '固定で付ける金額は0以上の数値で入力してください'
    }
    if (attributionDays) {
      const days = Number(attributionDays)
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return '成果を紐づける日数は1〜365日で入力してください'
      }
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
    const failed = validate()
    setSaveError(failed)
    setSavedNotice(null)
    if (failed) return
    setSaving(true)
    try {
      const res = await api.conversions.createDefinition({
        name: name.trim(),
        sourceType: eventType,
        sourceConfig: {
          triggerKind,
          exclusion: pruneCondition(exclusion),
          exclusionMemo: exclusionMemo.trim() || null,
        },
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
    } catch {
      setSaveError('保存できませんでした。権限を確認して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  const dirty = Boolean(
    name || value || targetUrl || exclusionMemo || attributionDays ||
    triggerKind !== 'order' || eventType !== 'ec_order_confirmed' ||
    valueMode !== 'source' || measureMethod !== 'webhook' ||
    exclusion !== null || deduplicationMode !== 'once_per_friend' ||
    reversalPolicy !== 'source_cancelled' || saveAsDraft ||
    selectedUsageKeys.size > 0
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty })

  const scrollToExclusion = () => {
    document.getElementById('cv-exclusion')?.scrollIntoView({ block: 'center' })
  }

  const excludedTotal = preview ? preview.duplicateExcludedCount + preview.cancellationCount : null

  return (
    <div className={styles.board} data-design-node="j8p3yj">
      <Link href="/conversions?tab=points" className={styles.back}>
        ← コンバージョンへ
      </Link>
      <div className={styles.head}>
        <h1 className={styles.headTitle}>成果地点を作る</h1>
        <p className={styles.headDescription}>
          「何が起きたら・何回まで・いくら」を決めると、その日から数えはじめます。前の日にさかのぼっては数えません。
        </p>
      </div>

      {!canEdit ? (
        <Notice tone="info" message="閲覧のみで見ています。変える操作は管理者に頼んでください。" />
      ) : null}

      {duplicateName ? (
        <div className={styles.conflict} role="alert">
          <p className={styles.conflictTitle}>同じ名前の「{duplicateName.name}」があります</p>
          <p className={styles.conflictNote}>同じ意味の成果地点を2つ作ると、分析の数字が二重になります。</p>
          <div className={styles.conflictButtons}>
            <Button
              variant="secondary"
              size="compact"
              href={`/conversions?tab=points&highlight=${encodeURIComponent(duplicateName.id)}`}
            >
              違いを比べる
            </Button>
            <Button variant="secondary" size="compact" onClick={() => requestPoints()}>
              最新を読み込んで続ける
            </Button>
          </div>
        </div>
      ) : null}

      {savedNotice ? <Notice tone="success" message={savedNotice} /> : null}
      {saveError ? <p className={styles.formError} role="alert">{saveError}</p> : null}

      <div className={styles.split}>
        <div className={styles.main}>
          <section className={styles.card} aria-label="何が起きたら数えますか">
            <h2 className={styles.cardTitle}>何が起きたら数えますか</h2>
            <p className={styles.cardNote}>名前は一覧で見分けるため。お客さまには見えません</p>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>名前</span>
              <input
                aria-label="成果地点の名前"
                className={inputClass}
                value={name}
                maxLength={120}
                placeholder="商品を買った"
                disabled={!canEdit}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {duplicateName ? (
              <p className={styles.fieldError} role="alert">
                同じ名前の「{duplicateName.name}」があります。同じ意味の成果地点を2つ作らないでください。
              </p>
            ) : null}
            {pointsFailed ? (
              <div className={styles.fieldRetry}>
                <p className={styles.fieldNote} role="alert">
                  同じ名前があるか確認できませんでした。同じ意味の成果地点があるかもしれません。
                </p>
                <Button variant="secondary" size="compact" onClick={() => requestPoints()}>
                  同名の確認を再読み込み
                </Button>
              </div>
            ) : null}
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>できごと</span>
                <Select
                  aria-label="できごと"
                  value={eventType}
                  disabled={!canEdit}
                  options={TRIGGER_CHOICES.map((choice) => ({
                    value: choice.eventType,
                    label: `${choice.label}（${choice.note}）`,
                  }))}
                  onChange={selectTrigger}
                />
              </label>
              {measureMethod === 'url_reach' ? (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>数えてよいページ</span>
                  <input
                    aria-label="数えてよいページ"
                    className={inputClass}
                    inputMode="url"
                    value={targetUrl}
                    maxLength={2000}
                    placeholder="https://example.com/thanks"
                    disabled={!canEdit}
                    onChange={(event) => setTargetUrl(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
            <div className={styles.chipRow}>
              <span className={styles.stateChip}>
                {isEmptyCondition(pruneCondition(exclusion)) ? '除外なし' : '条件あり'}
              </span>
              <button type="button" className={styles.linkButton} onClick={scrollToExclusion}>
                ＋ 「いずれか1つ以上を満たす」条件を足す
              </button>
            </div>
          </section>

          <section className={styles.card} aria-label="同じ人を何回まで数えるか">
            <h2 className={styles.cardTitle}>同じ人を何回まで数えるか</h2>
            <p className={styles.cardNote}>くり返し起きるできごとは、数えすぎを防ぎます</p>
            <RadioCardGroup legend="同じ人を何回まで数えるか">
              <RadioCard
                name="conversion-create-dedup"
                value="once_per_friend"
                checked={deduplicationMode === 'once_per_friend'}
                disabled={!canEdit}
                onChange={() => setDeduplicationMode('once_per_friend')}
                title="1人1回だけ"
                note="はじめての人だけを数えます"
              />
              <RadioCard
                name="conversion-create-dedup"
                value="window"
                checked={deduplicationMode === 'window'}
                disabled={!canEdit}
                onChange={() => setDeduplicationMode('window')}
                title="30日に1回まで"
                note="短い間にくり返し起きるものに"
              />
              <RadioCard
                name="conversion-create-dedup"
                value="every"
                checked={deduplicationMode === 'every'}
                disabled={!canEdit}
                onChange={() => setDeduplicationMode('every')}
                title="何回でも"
                note="買うたびに数えます。売上を追うときに"
              />
            </RadioCardGroup>
          </section>

          <section className={styles.card} aria-label="金額をどう出すか">
            <h2 className={styles.cardTitle}>金額をどう出すか</h2>
            <p className={styles.cardNote}>アフィリエイトの報酬や、配信ごとの売上の計算に使います</p>
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>金額の出し方</span>
                <Select
                  aria-label="金額の出し方"
                  value={valueMode}
                  disabled={!canEdit}
                  options={origin.valueModes.map((mode) => ({ value: mode, label: VALUE_MODE_LABELS[mode] }))}
                  onChange={(value) => {
                    setValueMode(value as ConversionValueMode)
                    setValueModeNotice(null)
                  }}
                />
                {valueModeNotice ? (
                  <span className={styles.fieldNote} role="status">{valueModeNotice}</span>
                ) : null}
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>決まった金額（円）</span>
                <input
                  aria-label="決まった金額"
                  className={inputClass}
                  inputMode="numeric"
                  value={value}
                  placeholder="0"
                  disabled={!canEdit || valueMode === 'none'}
                  onChange={(event) => setValue(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>取り消されたとき</span>
                <Select
                  aria-label="取り消されたとき"
                  value={reversalPolicy}
                  disabled={!canEdit}
                  options={REVERSAL_OPTIONS}
                  onChange={(value) => setReversalPolicy(value as ConversionReversalPolicy)}
                />
              </label>
            </div>
          </section>

          <section className={styles.card} aria-label="数えない条件" id="cv-exclusion">
            <h2 className={styles.cardTitle}>数えない条件</h2>
            <p className={styles.cardNote}>任意。テスト用の注文などを除きます</p>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>メモ <span className={styles.optional}>任意</span></span>
              <input
                aria-label="数えない条件のメモ"
                className={inputClass}
                value={exclusionMemo}
                maxLength={500}
                placeholder="例：テスト用の注文は条件で除いています"
                disabled={!canEdit}
                onChange={(event) => setExclusionMemo(event.target.value)}
              />
            </label>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>除く条件</span>
              {canEdit ? (
                <ConditionBuilder
                  value={exclusion}
                  onChange={setExclusion}
                  label="数えない条件"
                  showCount={false}
                />
              ) : (
                <p className={styles.fieldNote}>閲覧のみのため、条件は変えられません。</p>
              )}
            </div>
          </section>

          <section className={styles.card} aria-label="下書きと詳細設定">
            <h2 className={styles.cardTitle}>下書きと詳細設定</h2>
            <Checkbox
              checked={saveAsDraft}
              onCheckedChange={setSaveAsDraft}
              disabled={!canEdit}
              description="一覧の「下書き」に入ります。数えはじめるには一覧から公開します。"
            >まだ計測せず、下書きとして保存する</Checkbox>
            <Disclosure size="compact" title="詳細設定" hint="帰属期間・集計対象">
              <div className={styles.fieldRow}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>友だち追加からの計測期間（日）</span>
                  <input
                    aria-label="友だち追加からの計測期間"
                    className={inputClass}
                    inputMode="numeric"
                    value={attributionDays}
                    placeholder="90"
                    disabled={!canEdit}
                    onChange={(event) => setAttributionDays(event.target.value)}
                  />
                  <span className={styles.fieldNote}>空欄なら既定の90日です。</span>
                </label>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>集計対象アカウント</span>
                  <p className={styles.fixedBox}>
                    {selectedAccount ? selectedAccount.name : '未選択（画面上部で選んでください）'}
                  </p>
                </div>
              </div>
            </Disclosure>
          </section>
        </div>

        <div className={styles.rail}>
          <section className={styles.railCard} aria-label="この決めごとをこの30日にあてはめると">
            <h2 className={styles.railTitle}>この決めごとをこの30日にあてはめると</h2>
            <p className={styles.cardNote}>前の日にさかのぼっては数えません（見込みです）</p>
            <dl className={styles.previewRows}>
              <div className={styles.previewRow}>
                <dt>成果</dt>
                <dd>{preview ? `${formatNumber(preview.estimatedCount)}件` : '—'}</dd>
              </div>
              <div className={styles.previewRow}>
                <dt>金額</dt>
                <dd>{preview ? `¥${formatNumber(preview.estimatedValue)}` : '—'}</dd>
              </div>
              <div className={styles.previewRow}>
                <dt>1日あたり</dt>
                <dd>{preview ? `${formatNumber(preview.dailyAverage)}件` : '—'}</dd>
              </div>
              <div className={styles.previewRow}>
                <dt>除いた注文</dt>
                <dd>{excludedTotal == null ? '—' : `${formatNumber(excludedTotal)}件`}</dd>
              </div>
            </dl>
            <p className={styles.cardNote} aria-busy={previewLoading}>
              {previewFailed
                ? '保存前の試算を読み込めませんでした。入力内容は保存されていません。'
                : preview
                  ? `入力中の条件だけで試算しています。重複除外 ${formatNumber(preview.duplicateExcludedCount)}件・取消 ${formatNumber(preview.cancellationCount)}件。試算では成果を追加しません。`
                  : '入力中の条件を試算しています。'}
            </p>
            {preview && !previewFailed && preview.excludedReasons.length > 0 ? (
              <ul className={styles.previewReasons}>
                {preview.excludedReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className={styles.railCard} aria-label="この成果地点を使う場所">
            <h2 className={styles.railTitle}>この成果地点を使う場所</h2>
            <p className={styles.cardNote}>使う所にチェックを入れます（作ったあとにも足せます）</p>
            {USAGE_GROUPS.map((group) => {
              const kindResult = usageKinds[group.kind]
              return (
                <div key={group.kind} className={styles.usageGroup}>
                  <p className={styles.usageLabel}>{group.label} <span className={styles.usageState}>{kindResult.state === 'ok' && kindResult.targets.length === 0 ? 'まだ無い' : ''}</span></p>
                  {kindResult.state === 'idle' ? (
                    <p className={styles.fieldNote}>集計対象のアカウントを選ぶと候補が出ます</p>
                  ) : kindResult.state === 'loading' ? (
                    <p className={styles.fieldNote}>候補を読み込んでいます</p>
                  ) : kindResult.state === 'forbidden' ? (
                    <p className={styles.fieldNote} role="status">
                      このアカウントの{group.label}を見る権限がありません
                    </p>
                  ) : kindResult.state === 'error' ? (
                    <div>
                      <p className={styles.fieldError} role="alert">
                        使える{group.label}を読み込めませんでした
                      </p>
                      <Button
                        variant="secondary"
                        size="compact"
                        disabled={!lineAccountId}
                        onClick={() => requestUsageKind(group.kind, lineAccountId)}
                      >
                        {group.label}を再読み込み
                      </Button>
                    </div>
                  ) : kindResult.targets.length === 0 ? (
                    <p className={styles.fieldNote}>使える{group.label}がまだありません</p>
                  ) : (
                    <ul className={styles.usageList}>
                      {kindResult.targets.map((target) => (
                        <li key={usageKey(target)}>
                          <Checkbox
                            checked={selectedUsageKeys.has(usageKey(target))}
                            disabled={!canEdit}
                            onCheckedChange={() => toggleUsage(target)}
                          >{target.label}</Checkbox>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
            <Link href="/analytics?tab=funnel" className={styles.linkButton}>＋ 使う場所を足す</Link>
          </section>
        </div>
      </div>

      <div className={styles.footer}>
        <Button variant="secondary" href="/conversions?tab=points">
          キャンセル
        </Button>
        <Button
          variant="secondary"
          disabled={!canEdit || saving}
          title={canEdit ? undefined : READONLY_REASON}
          onClick={() => void runSave(true)}
          busy={saving}
          busyLabel="保存しています"
        >
          保存して続けて作る
        </Button>
        {duplicateName ? (
          <Button
            variant="primary"
            href={`/conversions?tab=points&highlight=${encodeURIComponent(duplicateName.id)}`}
          >
            比べてから保存
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!canEdit || saving}
            title={canEdit ? undefined : READONLY_REASON}
            onClick={() => void runSave(false)}
            busy={saving}
            busyLabel="保存しています"
          >
            {saveAsDraft ? '下書きを保存する' : '保存して数えはじめる'}
          </Button>
        )}
      </div>
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した成果地点" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
