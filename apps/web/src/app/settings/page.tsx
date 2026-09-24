'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import PageHeader from '@/components/shared/page-header'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import { RequiredBadge } from '@/components/shared/form-controls'
import { useAccount } from '@/contexts/account-context'
import { api, ApiError, fetchApi, type AnalyticsUsageOverview } from '@/lib/api'
import { createAccountRequestGuard } from './account-request-guard'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import {
  FEATURE_SETTINGS_UPDATED_EVENT,
  groupEnabledCount,
  groupFeatureCount,
  itemIsEnabled,
  itemOrderFromGroups,
  moveItemWithinGroup,
  visibleFeatureGroups,
  type FeatureGroup,
  type FeatureItem,
  type MenuItemOrder,
} from '@/lib/feature-settings'
import {
  CATALOG_DEFAULT_FEATURES,
  FEATURE_SETTINGS_CONFLICT_MESSAGE,
  applyItemOrder,
  featureSettingsAreDirty,
  featureSettingsErrorMessage,
  normalizeFeatureSettings,
  splitFeatureGroups,
} from './feature-settings-view'

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-ink-faint">
      <path d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EyeOffIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.25A10.5 10.5 0 0 1 12 4c5.5 0 9 5 9 5a15.8 15.8 0 0 1-2.2 2.6M6.6 6.6C4.3 8.1 3 10 3 10s3.5 5 9 5c1 0 1.9-.16 2.75-.44" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * 行の先頭に出す点。動かせる行の目印。
 *
 * 点だけでは動かせない（ドラッグは受けない）。実際に動かすのは右の↑↓で、
 * 点は「この行は並べ替えの対象」という印として置く。
 */
function GripIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 20" className="h-5 w-3 shrink-0 text-ink-faint">
      {[6, 10, 14].map((y) => (
        <g key={y}>
          <circle cx="4" cy={y} r="1.4" fill="currentColor" />
          <circle cx="8" cy={y} r="1.4" fill="currentColor" />
        </g>
      ))}
    </svg>
  )
}

function groupSummary(group: FeatureGroup, features: Record<string, boolean>) {
  const total = groupFeatureCount(group)
  if (total === 0) return 'この区分の項目は消せません（並び順だけ変えられます）'
  const enabled = groupEnabledCount(group, features)
  if (enabled === total) return `${total}機能すべて有効`
  if (enabled === 0) return `${total}機能すべて無効`
  return `${total}機能中 ${enabled}つが有効`
}

type UsageCategory = AnalyticsUsageOverview['data']['categories'][number]
type FeatureUsage = AnalyticsUsageOverview['data']['features'][number]

/**
 * オフ前の影響確認(票643)の応答。件数と対象種別だけを持ち、
 * 稼働中の行そのもの(宛先・内容)はサーバから出さない。
 */
type FeatureImpactItem = {
  kind: 'published' | 'scheduled' | 'dependent'
  targetType: string
  count: number
}

type FeatureImpactGroup = {
  feature: string
  items: FeatureImpactItem[]
  blocking: boolean
}

type FeatureImpactResponse = {
  success: boolean
  error: string
  data: {
    version: number
    impacts: FeatureImpactGroup[]
    requiresConfirmation: boolean
    impactToken: string | null
  }
}

type FeatureSaveResponse = {
  success: boolean
  error: string
  data: { version: number }
}

/*
 * オン／オフを持たない項目だけが使う、分類ごとの利用数バッジ。
 * 切り替えられる機能（keys を持つ行）は共有カタログの featureId で
 * 機械照合する features 側を見る。ここに残るのは「友だち属性」だけ。
 */
const USAGE_ITEM_IDS_BY_KEY: Record<string, string[]> = {
  friend_attributes: ['friend-attributes'],
}

function UsageBadge({ category, onRetry }: { category: UsageCategory; onRetry?: () => void }) {
  const created = category.created.value
  const inUse = category.inUse.value
  if (created === null || inUse === null) {
    return (
      <span
        className="rounded-pill border-hairline bg-canvas-sunken whitespace-nowrap border px-2 py-0.5 text-[10px] font-bold text-ink-faint"
        title={category.inUse.reason ?? category.created.reason ?? '利用状況を取得できません'}
      >
        利用数は未取得
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            aria-label="利用数を読み直す"
            className="ml-1 cursor-pointer underline hover:no-underline"
          >
            読み直す
          </button>
        )}
      </span>
    )
  }
  return (
    <span
      className="rounded-pill border-info bg-info-bg text-info whitespace-nowrap border px-2 py-0.5 text-[10px] font-bold"
      title={`${category.label}：作成 ${created.toLocaleString('ja-JP')}、利用中 ${inUse.toLocaleString('ja-JP')}`}
    >
      利用中 {inUse.toLocaleString('ja-JP')} / 作成 {created.toLocaleString('ja-JP')}
    </span>
  )
}

/** 最終利用の日付だけを短く出す。時刻はバッジに入らないのでタイトルへ残す。 */
function shortUsageDate(value: string): string {
  return value.slice(0, 10).replaceAll('-', '/')
}

/**
 * 機能ごとの利用状況バッジ（N-448）。
 *
 * 直近90日の回数・現在の利用数・最終利用・未計測理由のどれかを必ず出す。
 * 取得不可を 0 や無表示にしない。数え方の注意（partial）はタイトルへ載せる。
 */
function FeatureUsageBadge({ usage, label, onRetry }: {
  usage: FeatureUsage
  label: string
  onRetry?: () => void
}) {
  const { activity, activityBasis, activityUnit, lastUsedAt } = usage
  const lastUsed = lastUsedAt.value ? shortUsageDate(lastUsedAt.value) : null
  const titleParts = [
    lastUsed ? `最終利用 ${lastUsed}` : null,
    lastUsedAt.reason && !lastUsed ? lastUsedAt.reason : null,
    activity.reason ?? null,
  ].filter((part): part is string => Boolean(part))
  const title = `${label}：${titleParts.length > 0 ? titleParts.join('・') : '利用状況'}`
  if (activity.state === 'failed') {
    return (
      <span
        className="rounded-pill border-hairline bg-canvas-sunken whitespace-nowrap border px-2 py-0.5 text-[10px] font-bold text-ink-faint"
        title={title}
      >
        利用状況は取得失敗
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            aria-label="利用状況を読み直す"
            className="ml-1 cursor-pointer underline hover:no-underline"
          >
            読み直す
          </button>
        )}
      </span>
    )
  }
  if (activity.value === null) {
    const reason = activity.reason ?? lastUsedAt.reason ?? 'この機能の利用は計測していません'
    return (
      <>
        <span
          className="rounded-pill border-hairline bg-canvas-sunken whitespace-nowrap border px-2 py-0.5 text-[10px] font-bold text-ink-faint"
          title={title}
        >
          利用状況は未計測
        </span>
        <span className="min-w-0 truncate text-[10px] text-ink-faint" title={reason}>
          {reason}
        </span>
      </>
    )
  }
  const count = activity.value.toLocaleString('ja-JP')
  if (activityBasis === 'current') {
    return (
      <span
        className="rounded-pill border-info bg-info-bg text-info whitespace-nowrap border px-2 py-0.5 text-[10px] font-bold"
        title={title}
      >
        {activityUnit} {count}
      </span>
    )
  }
  if (activity.value === 0 && lastUsed) {
    return (
      <span
        className="rounded-pill border-hairline bg-canvas-sunken whitespace-nowrap border px-2 py-0.5 text-[10px] font-bold text-ink-faint"
        title={`${label}：直近90日の${activityUnit}は0・最終利用 ${lastUsed}`}
      >
        最終利用 {lastUsed}
      </span>
    )
  }
  return (
    <span
      className="rounded-pill border-info bg-info-bg text-info whitespace-nowrap border px-2 py-0.5 text-[10px] font-bold"
      title={title}
    >
      90日で {count}{activityUnit}
    </span>
  )
}

function FeatureRow({ item, features, ordering, usage, featureUsage, usageRetry, sharedSwitch, canMoveUp, canMoveDown, onMove, onToggle }: {
  item: FeatureItem
  features: Record<string, boolean>
  ordering: boolean
  usage?: UsageCategory
  featureUsage?: FeatureUsage
  usageRetry?: () => void
  sharedSwitch: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (itemId: string, direction: -1 | 1) => void
  onToggle: (item: FeatureItem, next: boolean) => void
}) {
  const enabled = itemIsEnabled(item, features)
  return (
    <li className="flex min-h-14 items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 items-start gap-2.5">
        {ordering && <span className="mt-0.5"><GripIcon /></span>}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="whitespace-nowrap text-sm font-bold text-ink">{item.label}</p>
            {sharedSwitch && (
              <span className="rounded-pill border-hairline whitespace-nowrap border px-1.5 py-0.5 text-micro font-bold text-ink-faint">
                同じスイッチ
              </span>
            )}
            {item.badge && (
              <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-[10px] font-bold text-accent-deep">
                {item.badge}
              </span>
            )}
            {featureUsage && <FeatureUsageBadge usage={featureUsage} label={item.label} onRetry={usageRetry} />}
            {!featureUsage && usage && <UsageBadge category={usage} onRetry={usageRetry} />}
          </div>
          <p className="mt-0.5 truncate text-[11px] leading-relaxed text-ink-faint" title={item.note}>{item.note}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {ordering && (
          <>
            <Button
              variant="secondary"
              aria-label={`${item.label}を上へ`}
              title="上へ移動"
              disabled={!canMoveUp}
              onClick={() => onMove(item.id, -1)}
            >
              ↑
            </Button>
            <Button
              variant="secondary"
              aria-label={`${item.label}を下へ`}
              title="下へ移動"
              disabled={!canMoveDown}
              onClick={() => onMove(item.id, 1)}
            >
              ↓
            </Button>
          </>
        )}
        {/*
          ★V7：消せない項目は「必須」の札だけにする。以前は札・鍵の印・押せない切替の3つが並び、
          押せない切替が「壊れている」ようにも見えた。
        */}
        {item.required ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-pill bg-canvas-sunken px-2.5 py-1 text-xs font-semibold text-ink-secondary" title={`${item.label}は必須機能のため、オフにできません`}>
            <LockIcon />
            必須
          </span>
        ) : (
          <Toggle
            checked={enabled}
            label={`${item.label}を${enabled ? 'オフ' : 'オン'}にする`}
            onChange={(next) => onToggle(item, next)}
          />
        )}
      </div>
    </li>
  )
}

function FeatureSection({ group, features, ordering, usageByItemId, usageByFeatureId, usageRetry, onItemToggle, onGroupToggle, onMove }: {
  group: FeatureGroup
  features: Record<string, boolean>
  ordering: boolean
  usageByItemId: Map<string, UsageCategory>
  usageByFeatureId: Map<string, FeatureUsage>
  usageRetry?: () => void
  onItemToggle: (item: FeatureItem, next: boolean) => void
  onGroupToggle: (group: FeatureGroup, next: boolean) => void
  onMove: (groupId: string, itemId: string, direction: -1 | 1) => void
}) {
  const total = groupFeatureCount(group)
  const allEnabled = total === 0 || groupEnabledCount(group, features) === total
  const switchCount = new Map<string, number>()
  for (const item of group.items) {
    const key = item.keys[0]
    if (key) switchCount.set(key, (switchCount.get(key) ?? 0) + 1)
  }
  return (
    <section className="border-hairline overflow-hidden rounded-xl border bg-canvas">
      <div className="border-hairline bg-canvas-sunken flex min-h-12 items-center justify-between gap-3 border-b px-3 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="text-sm font-bold text-ink">{group.label}</h2>
          <p className="text-[10px] text-ink-faint">{groupSummary(group, features)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-disabled={total === 0}
            onClick={() => total > 0 && onGroupToggle(group, !allEnabled)}
            className={`text-action focus-visible:outline-info whitespace-nowrap text-[11px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 ${total === 0 ? 'cursor-default' : 'cursor-pointer'}`}
          >
            まとめて切替
          </button>
        </div>
      </div>
      <ul className="divide-y divide-hairline">
        {group.items.map((item, index) => (
          <FeatureRow
            key={item.id}
            item={item}
            features={features}
            ordering={ordering}
            usage={item.keys.length === 0 ? usageByItemId.get(item.id) : undefined}
            featureUsage={item.keys[0] ? usageByFeatureId.get(item.keys[0]) : undefined}
            usageRetry={usageRetry}
            sharedSwitch={Boolean(item.keys[0]) && (switchCount.get(item.keys[0]) ?? 0) > 1}
            canMoveUp={index > 0}
            canMoveDown={index < group.items.length - 1}
            onMove={(itemId, direction) => onMove(group.id, itemId, direction)}
            onToggle={onItemToggle}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * サイドメニューの見え方。
 *
 * 左で決めた並びと表示を、そのまま同じ順で出す。別に並べ直すと、保存する前に
 * 出ている姿と、保存したあとの姿が違ってしまう。
 */
function SidebarPreview({ groups, features }: {
  groups: FeatureGroup[]
  features: Record<string, boolean>
}) {
  let hidden = 0
  for (const group of groups) {
    for (const item of group.items) if (!itemIsEnabled(item, features)) hidden += 1
  }
  return (
    <aside data-design="サイドメニューの見え方" className="xl:sticky xl:top-6">
      <div className="border-hairline bg-canvas overflow-hidden rounded-[22px] border">
        <div className="max-h-[calc(100vh-8rem)] space-y-4 overflow-y-auto px-6 pb-3 pt-6">
          {groups.map((group) => (
            <div key={group.id}>
              <p className="mb-2 text-xs font-bold text-ink-faint">{group.label}</p>
              <div className="space-y-0.5 pl-3">
                {group.items.map((item) => {
                  const enabled = itemIsEnabled(item, features)
                  return (
                    <div
                      key={item.id}
                      className={`flex min-h-7 items-center gap-2 text-[13px] font-medium ${
                        enabled ? 'text-ink' : 'text-ink-faint'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${enabled ? 'bg-accent' : 'bg-canvas-sunken'}`} />
                      <span className="truncate">{item.label}</span>
                      {!enabled && <EyeOffIcon className="ml-auto h-4 w-4 shrink-0 text-ink-faint" />}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="border-hairline border-t pb-1 pt-3 text-xs">
            <p className="flex items-center gap-2 text-ink-faint">
              <EyeOffIcon className="h-4 w-4 shrink-0" />
              この印はメニューに表示されません
            </p>
            <p className="mt-2 font-bold text-warning">
              {hidden > 0 ? `${hidden} 項目が非表示になります` : 'すべての項目が表示されます'}
            </p>
          </div>
        </div>
      </div>
    </aside>
  )
}

export default function SettingsPage() {
  const { selectedAccountId } = useAccount()
  const [savedFeatures, setSavedFeatures] = useState<Record<string, boolean>>(CATALOG_DEFAULT_FEATURES)
  const [features, setFeatures] = useState<Record<string, boolean>>(CATALOG_DEFAULT_FEATURES)
  const [savedItemOrder, setSavedItemOrder] = useState<MenuItemOrder>({})
  const [itemOrder, setItemOrder] = useState<MenuItemOrder>({})
  const [specializedFeatureKeys, setSpecializedFeatureKeys] = useState<string[]>([])
  const [usageCategories, setUsageCategories] = useState<UsageCategory[]>([])
  /** 全任意機能の利用状況（N-448）。共有カタログの featureId で照合する。 */
  const [usageFeatures, setUsageFeatures] = useState<FeatureUsage[]>([])
  /** 利用数の取得に失敗したときだけ出す「読み直す」の印。 */
  const [usageFailed, setUsageFailed] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  /** GET で受けた版。保存時に送り返し、競合(409)を検出する。 */
  const [settingsVersion, setSettingsVersion] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /**
   * 変更理由。サーバーが必須化しており、保存と同じ単位で監査へ残る。
   * 保存成功・取り消し・アカウント切替で空に戻す。
   */
  const [reason, setReason] = useState('')
  /**
   * オフ前の影響確認(票643)。止まる仕事があるときだけ開く。
   * トークンは保持せず、押すたびに取り直してから保存する。
   */
  const [impactOpen, setImpactOpen] = useState(false)
  const [impactGroups, setImpactGroups] = useState<FeatureImpactGroup[]>([])
  const [impactBusy, setImpactBusy] = useState(false)
  const [impactError, setImpactError] = useState('')
  /** 既定値へ初期化する前の確認。保存済み設定へ戻す操作には使わない。 */
  const [resetToDefaultsOpen, setResetToDefaultsOpen] = useState(false)
  /**
   * 世代guard。アカウントが変わったら古い応答を捨てる。
   * Aの応答をBの画面へ混ぜないし、Aの版でBへ保存しない。
   */
  const accountGuard = useMemo(() => createAccountRequestGuard(), [])
  const accountRef = useRef(selectedAccountId)

  /** 並び順を当てたあとの区分。画面も見え方の欄もこれを見る。 */
  const groups = useMemo(() => {
    return applyItemOrder(
      visibleFeatureGroups({ specializedFeatureKeys, includeRestaurantTest: true }),
      itemOrder,
    )
  }, [itemOrder, specializedFeatureKeys])

  const currentOrder = useMemo(() => itemOrderFromGroups(groups), [groups])
  const savedGroups = useMemo(() => applyItemOrder(
    visibleFeatureGroups({ specializedFeatureKeys, includeRestaurantTest: true }),
    savedItemOrder,
  ), [savedItemOrder, specializedFeatureKeys])
  const dirty = featureSettingsAreDirty({
    savedFeatures,
    features,
    savedOrder: itemOrderFromGroups(savedGroups),
    currentOrder,
  })

  /*
   * 未保存の変更がある間、画面を離れる操作を止める共通の番兵（DETAIL-04系）。
   * ブラウザ離脱・画面内リンク・戻る操作を同じ確認対話へ寄せる。
   */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  useEffect(() => {
    if (accountRef.current !== selectedAccountId) {
      accountRef.current = selectedAccountId
      accountGuard.advance()
      // Aの未保存状態をBへ持ち込まない。Bの値は load() が改めて確定する。
      setSavedFeatures(CATALOG_DEFAULT_FEATURES)
      setFeatures(CATALOG_DEFAULT_FEATURES)
      setSavedItemOrder({})
      setItemOrder({})
      setSettingsVersion(0)
      setSpecializedFeatureKeys([])
      setUsageCategories([])
      setUsageFeatures([])
      setUsageFailed(false)
      setOrdering(false)
      setError('')
      setNotice('')
      setImpactOpen(false)
      setImpactGroups([])
      setImpactError('')
      setResetToDefaultsOpen(false)
      cancelLeave()
      setReason('')
    }
  }, [selectedAccountId, accountGuard, cancelLeave])

  /**
   * 利用数だけ後から読む。設定の表示を重い集計で待たせない。
   *
   * 集計が8系統の数え直しで重いため、以前は設定と一緒に待っていた。
   * 先に設定を出して、数は届き次第バッジに足す。失敗しても設定は
   * 触れるままにし、バッジの「読み直す」から取り直せる。
   */
  const loadUsage = useCallback(async () => {
    if (!selectedAccountId) return
    const ticket = accountGuard.issue(selectedAccountId)
    setUsageFailed(false)
    try {
      const usageResponse = await api.analytics.usageOverview(selectedAccountId)
      if (!accountGuard.isCurrent(ticket, selectedAccountId)) return
      if (usageResponse?.success) {
        setUsageCategories(usageResponse.data.data.categories)
        setUsageFeatures(usageResponse.data.data.features ?? [])
      } else {
        setUsageFailed(true)
      }
    } catch {
      if (!accountGuard.isCurrent(ticket, selectedAccountId)) return
      setUsageFailed(true)
    }
  }, [selectedAccountId, accountGuard])

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setSavedFeatures(CATALOG_DEFAULT_FEATURES)
      setFeatures(CATALOG_DEFAULT_FEATURES)
      setSavedItemOrder({})
      setItemOrder({})
      setSettingsVersion(0)
      setSpecializedFeatureKeys([])
      setUsageCategories([])
      setUsageFeatures([])
      cancelLeave()
      setLoading(false)
      return
    }
    const ticket = accountGuard.issue(selectedAccountId)
    setLoading(true)
    setError('')
    try {
      const response = await api.featureSettings.get(selectedAccountId)
      if (!accountGuard.isCurrent(ticket, selectedAccountId)) return
      if (!response.success) {
        setError(response.error)
        return
      }
      const next = normalizeFeatureSettings(response.data.features)
      setSavedFeatures(next)
      setFeatures(next)
      const nextOrder = response.data.sidebarItemOrder ?? {}
      setSavedItemOrder(nextOrder)
      setSettingsVersion(response.data.version ?? 0)
      setItemOrder(nextOrder)
      setSpecializedFeatureKeys(response.data.specializedFeatureKeys ?? [])
      // 設定を先に出し、利用数は後から足す（表示を集計で待たせない）。
      void loadUsage()
    } catch (error) {
      if (!accountGuard.isCurrent(ticket, selectedAccountId)) return
      setError(featureSettingsErrorMessage(error instanceof ApiError ? error.status : undefined, 'load'))
    } finally {
      if (accountGuard.isCurrent(ticket, selectedAccountId)) setLoading(false)
    }
  }, [selectedAccountId, loadUsage, accountGuard, cancelLeave])

  useEffect(() => { void load() }, [load])

  const usageByItemId = useMemo(() => {
    const result = new Map<string, UsageCategory>()
    for (const category of usageCategories) {
      for (const itemId of USAGE_ITEM_IDS_BY_KEY[category.key] ?? []) result.set(itemId, category)
    }
    return result
  }, [usageCategories])

  /** 共有カタログの featureId → 利用状況。切り替えられる全機能を機械照合する。 */
  const usageByFeatureId = useMemo(() => {
    const result = new Map<string, FeatureUsage>()
    for (const entry of usageFeatures) result.set(entry.featureId, entry)
    return result
  }, [usageFeatures])

  const groupColumns = useMemo(() => {
    return splitFeatureGroups(groups, 3)
  }, [groups])

  const toggleItem = (item: FeatureItem, next: boolean) => {
    if (item.required || item.keys.length === 0) return
    setFeatures((current) => {
      const changed = { ...current }
      for (const key of item.keys) changed[key] = next
      return changed
    })
    setNotice('')
  }

  const toggleGroup = (group: FeatureGroup, next: boolean) => {
    setFeatures((current) => {
      const changed = { ...current }
      for (const item of group.items) {
        if (item.required) continue
        for (const key of item.keys) changed[key] = next
      }
      return changed
    })
    setNotice('')
  }

  /**
   * 1つ上／下へ動かす。**区分をまたいでは動かせない。**
   *
   * またげるようにすると「受信箱を配信の中へ」といった並びが作れてしまい、
   * サイドバーの見出しと中身が合わなくなる。
   */
  const moveItem = (groupId: string, itemId: string, direction: -1 | 1) => {
    const group = groups.find((item) => item.id === groupId)
    if (!group) return
    const ids = group.items.map((item) => item.id)
    setItemOrder((current) => ({ ...current, [groupId]: moveItemWithinGroup(ids, itemId, direction) }))
    setNotice('')
  }

  /** 最後に取得または保存成功した、現在のアカウントの状態へだけ戻す。 */
  const discardChanges = () => {
    if (loading || saving) return
    setFeatures({ ...savedFeatures })
    setItemOrder({ ...savedItemOrder })
    setReason('')
    setError('')
    setNotice('保存済みの機能設定に戻しました。')
  }

  /** 既定値を下書きへ入れる。ここではAPIを呼ばず、保存を押すまでサーバーは変えない。 */
  const resetToDefaults = () => {
    if (loading || saving) return
    setFeatures({ ...CATALOG_DEFAULT_FEATURES })
    setItemOrder({})
    setError('')
    setNotice('初期値を下書きに入れました。保存すると反映されます。')
    setResetToDefaultsOpen(false)
  }

  /** 機能の目印→表示名。確認ダイアログで内部IDを出さないために使う。 */
  const featureLabelByKey = useMemo(() => {
    const labels = new Map<string, string>()
    for (const group of groups) {
      for (const item of group.items) {
        for (const key of item.keys) {
          if (!labels.has(key)) labels.set(key, item.label)
        }
      }
    }
    return labels
  }, [groups])

  /** 最新の保存済み状態を読み直す。編集中身は残す。 */
  const reloadSaved = useCallback(async () => {
    if (!selectedAccountId) return
    const ticket = accountGuard.issue(selectedAccountId)
    try {
      const latest = await api.featureSettings.get(selectedAccountId)
      if (!accountGuard.isCurrent(ticket, selectedAccountId)) return
      if (latest.success) {
        setSavedFeatures(normalizeFeatureSettings(latest.data.features))
        setSavedItemOrder(latest.data.sidebarItemOrder ?? {})
        setSettingsVersion(latest.data.version ?? 0)
      }
    } catch {
      // 読み直しに失敗しても編集中身は残す。
    }
  }, [selectedAccountId, accountGuard])

  /**
   * オフ前の影響確認(票643)。変更案だけ送り、保存はしない。
   * 版が古ければ読み直して null を返す(呼び出し側は保存へ進まない)。
   * 途中でアカウントが変わったら捨てて null を返す。
   */
  const checkImpact = useCallback(async () => {
    if (!selectedAccountId) return null
    const ticket = accountGuard.issue(selectedAccountId)
    try {
      const impact = await fetchApi<FeatureImpactResponse>(
        `/api/settings/features/impact?account_id=${encodeURIComponent(selectedAccountId)}`,
        {
          method: 'POST',
          body: JSON.stringify({ features, expectedVersion: settingsVersion }),
        },
      )
      if (!accountGuard.isCurrent(ticket, selectedAccountId)) return null
      if (!impact.success) {
        setError(impact.error)
        return null
      }
      return impact.data
    } catch (error) {
      if (!accountGuard.isCurrent(ticket, selectedAccountId)) return null
      // ほかの管理者が先に保存したときは、編集中身は残したまま
      // 最新を読み直し、内容を確認してもう一度保存してもらう。
      if (error instanceof ApiError && error.status === 409) {
        await reloadSaved()
        setError(FEATURE_SETTINGS_CONFLICT_MESSAGE)
        return null
      }
      setError(featureSettingsErrorMessage(error instanceof ApiError ? error.status : undefined, 'save'))
      return null
    }
  }, [selectedAccountId, features, settingsVersion, reloadSaved, accountGuard])

  const persist = async (impactToken?: string): Promise<boolean> => {
    if (!selectedAccountId) return false
    const ticket = accountGuard.issue(selectedAccountId)
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetchApi<FeatureSaveResponse>(
        `/api/settings/features?account_id=${encodeURIComponent(selectedAccountId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            features,
            sidebarItemOrder: currentOrder,
            expectedVersion: settingsVersion,
            reason: reason.trim(),
            ...(impactToken ? { impactToken } : {}),
          }),
        },
      )
      // 途中でアカウントが変わったら、応答を捨てて保存へ進まない。
      if (!accountGuard.isCurrent(ticket, selectedAccountId)) return false
      if (!response.success) {
        setError(response.error)
        return false
      }
      /*
       * 保存したつもりの値をそのまま確定しない。サーバーが正した値
       * （無効環境の飲食店テストなど）を、そのままオン表示にすると
       * 読み直すまで誤った状態を見せる。サーバ値を読み直して確定する。
       */
      try {
        const latest = await api.featureSettings.get(selectedAccountId)
        if (!accountGuard.isCurrent(ticket, selectedAccountId)) return false
        if (latest.success) {
          const serverFeatures = normalizeFeatureSettings(latest.data.features)
          setSavedFeatures(serverFeatures)
          setFeatures(serverFeatures)
          const serverOrder = latest.data.sidebarItemOrder ?? {}
          setSavedItemOrder(serverOrder)
          setItemOrder(serverOrder)
          setSettingsVersion(latest.data.version ?? response.data.version)
          setSpecializedFeatureKeys(latest.data.specializedFeatureKeys ?? [])
        } else {
          setSettingsVersion(response.data.version)
          setSavedFeatures({ ...features })
          setSavedItemOrder(currentOrder)
          setItemOrder(currentOrder)
        }
      } catch {
        setSettingsVersion(response.data.version)
        setSavedFeatures({ ...features })
        setSavedItemOrder(currentOrder)
        setItemOrder(currentOrder)
      }
      setReason('')
      setNotice('機能設定を保存しました。サイドメニューにも反映されています。')
      window.dispatchEvent(new CustomEvent(FEATURE_SETTINGS_UPDATED_EVENT, { detail: { accountId: selectedAccountId } }))
      return true
    } catch (error) {
      if (!accountGuard.isCurrent(ticket, selectedAccountId)) return false
      // 確認後に稼働中が変わったときは、最新の影響で確認し直す。
      // 編集中身は残したまま、ダイアログを開き直す。
      if (error instanceof ApiError && error.status === 409
        && error.code === 'IMPACT_CONFIRMATION_REQUIRED') {
        const data = error.data as { impacts?: FeatureImpactGroup[] } | undefined
        if (data?.impacts) {
          setImpactGroups(data.impacts)
          setImpactError('状態が変わったため、内容を確認し直してください。')
          setImpactOpen(true)
        } else {
          setError(featureSettingsErrorMessage(error.status, 'save'))
        }
        await reloadSaved()
        return false
      }
      // ほかの管理者が先に保存したときは、編集中身は残したまま
      // 最新を読み直し、内容を確認してもう一度保存してもらう。
      if (error instanceof ApiError && error.status === 409) {
        await reloadSaved()
        setError(FEATURE_SETTINGS_CONFLICT_MESSAGE)
        return false
      }
      setError(featureSettingsErrorMessage(error instanceof ApiError ? error.status : undefined, 'save'))
      return false
    } finally {
      setSaving(false)
    }
  }

  /**
   * 保存ボタン。オフに変わる機能があるときだけ先に影響確認し、
   * 止まる仕事があるときは確認ダイアログを開いて止める。
   */
  const save = async () => {
    if (!selectedAccountId || !dirty) return
    // サーバーが理由なしの保存を400にする。往復させる前にここで止める。
    if (!reason.trim()) {
      setError('変更理由を入力してください')
      return
    }
    const offKeys = Object.keys(features).filter(
      (key) => savedFeatures[key] === true && features[key] === false,
    )
    if (offKeys.length === 0) {
      await persist()
      return
    }
    setSaving(true)
    setError('')
    try {
      const data = await checkImpact()
      if (!data) return
      if (data.requiresConfirmation) {
        setImpactGroups(data.impacts)
        setImpactError('')
        setImpactOpen(true)
        return
      }
      await persist()
    } finally {
      setSaving(false)
    }
  }

  /**
   * 確認ダイアログの「確認して保存」。押すたびに影響を取り直し、
   * その場のトークンで保存する。トークンの持ち回しはしない。
   */
  const confirmImpactSave = async () => {
    if (impactBusy || !selectedAccountId) return
    setImpactBusy(true)
    setImpactError('')
    try {
      const data = await checkImpact()
      if (!data) {
        setImpactError('確認を取り直せませんでした。閉じてもう一度保存してください。')
        return
      }
      if (!data.requiresConfirmation || !data.impactToken) {
        setImpactOpen(false)
        await persist()
        return
      }
      setImpactGroups(data.impacts)
      setImpactOpen(true)
      const ok = await persist(data.impactToken)
      if (ok) setImpactOpen(false)
    } finally {
      setImpactBusy(false)
    }
  }

  const impactSummary = (group: FeatureImpactGroup) => group.items
    .map((item) => `${item.targetType} ${item.count.toLocaleString('ja-JP')}件`)
    .join('、')

  return (
    <div>
      {/*
        U034: 390px・768pxでは右の操作（並び替え・保存など）が見出しを
        押しつぶし、題が1文字ずつ縦に割れていた。共通の PageHeader の形は
        変えず、この画面の見出し帯だけ「収まらないとき操作を次の行へ
        下げる」にする。収まる幅では1行のままで見た目は変わらない。
      */}
      <div data-page-header-wrap>
      <PageHeader
        className="mb-5"
        breadcrumb={[{ label: '設定' }, { label: '機能設定' }]}
        title="機能設定"
        description=""
        actions={(
          <>
          <Button
            variant="secondary"
            onClick={() => setOrdering((current) => !current)}
            disabled={loading || saving}
          >
            {ordering ? '並び替えを閉じる' : '並びを変える'}
          </Button>
          <Button
            variant="secondary"
            onClick={discardChanges}
            disabled={loading || saving || !dirty}
            title={!dirty && !loading ? '変更すると取り消せます' : undefined}
          >
            変更を取り消す
          </Button>
          <Button
            variant="secondary"
            onClick={() => setResetToDefaultsOpen(true)}
            disabled={loading || saving}
          >
            初期値に戻す
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={loading || saving || !dirty}
            title={!dirty && !loading ? '変更すると保存できます' : undefined}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path d="m4 10 3.5 3.5L16 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {saving ? '保存中…' : '機能設定を保存'}
          </Button>
          {!loading && !dirty && <span className="self-center text-xs text-ink-faint">変更すると保存できます</span>}
          </>
        )}
      />
      <style>{`
        [data-page-header-wrap] > div { flex-wrap: wrap; }
        [data-page-header-wrap] > div > div + div { flex-wrap: wrap; max-width: 100%; margin-left: auto; }
      `}</style>
      </div>

      <div className="bg-info-bg text-ink-secondary mb-4 flex items-start gap-3 rounded-card px-5 py-2.5 text-xs leading-relaxed">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="mt-px h-4 w-4 shrink-0 text-info">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
          <path d="M12 10.5v6M12 7.5h.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
        <p>使わない機能をオフにすると、サイドメニューから消えます。オフにしても作ったデータは削除されません。公開中のページや動いている配信・予約は、それぞれの画面で止めてからオフにしてください。並び順はここでは変えません。「並びを変える」から入れ替えてください。</p>
      </div>

      {!selectedAccountId ? (
        <p className="border-hairline bg-canvas text-ink-faint rounded-card border p-8 text-center text-sm">
          先に上部でLINEアカウントを選んでください。
        </p>
      ) : (
        <>
          <div aria-live="polite">
            {error && <div className="border-danger bg-danger-bg text-danger mb-4 rounded-control border p-4 text-sm">{error}</div>}
            {notice && <div className="border-success bg-success-bg text-success mb-4 rounded-control border p-4 text-sm">{notice}</div>}
          </div>

          {dirty && (
            <div className="border-hairline bg-canvas rounded-card mb-4 flex flex-col gap-2 border p-4 sm:flex-row sm:items-center">
              <label htmlFor="feature-settings-reason" className="text-ink shrink-0 text-sm font-bold">
                変更理由<RequiredBadge />
              </label>
              <TextField
                id="feature-settings-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="例: 使っていない配信機能を止めるため"
                maxLength={300}
                disabled={saving}
              />
            </div>
          )}

          {loading ? (
            <div className="border-hairline bg-canvas text-ink-faint rounded-card border p-10 text-center text-sm">読み込み中…</div>
          ) : (
            <div className={ordering ? 'grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]' : ''}>
              {/*
                利用状況の取得自体に失敗したとき。バッジは付かないので、
                無表示のままにせず一覧の先頭で理由とやり直しを出す。
                設定の切替はこの間も触れるままにする。
              */}
              {usageFailed && (
                <div className="border-hairline bg-canvas-sunken text-ink-faint mb-4 flex items-center gap-2 rounded-card border px-4 py-2 text-xs">
                  <span>機能の利用状況を読めませんでした。設定の切替はそのまま使えます。</span>
                  <button
                    type="button"
                    onClick={() => void loadUsage()}
                    className="text-action cursor-pointer font-bold underline hover:no-underline"
                  >
                    利用状況を読み直す
                  </button>
                </div>
              )}
              {/*
                区分ごとの印は付けない。区分と項目はサイドメニューと同じ一覧
                （src/lib/menu.ts）から作るので、並びと顔ぶれは
                sidebar-design.test.ts が見ている。ここで二重に縛ると、
                項目を1つ足すたびに2か所直すことになる。
              */}
              <div
                data-design="機能の一覧"
                className={ordering ? 'space-y-4' : 'grid items-start gap-4 xl:grid-cols-3'}
              >
                {(ordering ? [groups] : groupColumns).map((column, columnIndex) => (
                  <div key={columnIndex} className="space-y-3">
                    {column.map((group) => (
                      <FeatureSection
                        key={group.id}
                        group={group}
                        features={features}
                        ordering={ordering}
                        usageByItemId={usageByItemId}
                        usageByFeatureId={usageByFeatureId}
                        usageRetry={() => void loadUsage()}
                        onItemToggle={toggleItem}
                        onGroupToggle={toggleGroup}
                        onMove={moveItem}
                      />
                    ))}
                  </div>
                ))}
              </div>
              {ordering && <SidebarPreview groups={groups} features={features} />}
              {/*
                運営だけが触る表への入口。要件 v6-34 §5-2「呼び出し元: 31 機能設定の
                『運営』区分」。**入口をここに 1 つだけ置く。**
                画面の中身は開いた先で権限を確かめる（運営以外には出さない）。
              */}
              {ordering && <div data-design="運営" className="rounded-card border-hairline bg-canvas mt-5 border p-4">
                <p className="text-ink text-sm font-bold">運営</p>
                <p className="text-ink-secondary mt-1 text-xs leading-5">お客さまの組織からは見えません。</p>
                <Link href="/settings/manual-links" className="text-accent-deep mt-3 inline-block text-sm font-bold">
                  マニュアルの正本表
                </Link>
              </div>}
            </div>
          )}
        </>
      )}

      {/*
        オフ前の影響確認(票643)。止まる仕事の件数と対象種別を並べ、
        確認したうえで保存する。標準の確認窓は使わない。
      */}
      <ConfirmDialog
        open={resetToDefaultsOpen}
        title="初期値に戻しますか？"
        description="機能の表示と並び順を初期値の下書きに置き換えます。保存するまで、他の利用者やサイドメニューには反映されません。"
        confirmLabel="初期値を下書きに入れる"
        cancelLabel="キャンセル"
        onCancel={() => {
          if (!saving) setResetToDefaultsOpen(false)
        }}
        onConfirm={resetToDefaults}
      />

      <ConfirmDialog
        open={leaveTarget !== null}
        title="保存していない変更があります"
        description="保存せずに移動すると、この画面で変更した機能の表示・並び順は失われます。"
        confirmLabel="保存せずに移動"
        cancelLabel="編集を続ける"
        destructive
        busy={saving}
        onCancel={() => {
          if (!saving) cancelLeave()
        }}
        onConfirm={() => {
          // 遷移が始まる前にdirtyを外す。beforeunloadも不要な警告を出さない。
          setSavedFeatures({ ...features })
          setSavedItemOrder(currentOrder)
          confirmLeave()
        }}
      />

      <ConfirmDialog
        open={impactOpen}
        title="オフにする前に確認"
        description="止まる仕事があります。オフにしてもデータは削除されず、再度オンにすると再開できます。公開中のページや動いている配信・予約は、それぞれの画面で止めてからオフにしてください。"
        confirmLabel="確認して保存"
        destructive
        busy={impactBusy || saving}
        error={impactError || undefined}
        onCancel={() => {
          if (impactBusy || saving) return
          setImpactOpen(false)
          setImpactError('')
        }}
        onConfirm={() => void confirmImpactSave()}
      >
        <div className="space-y-3">
          {impactGroups.map((group) => (
            <div key={group.feature}>
              <p className="text-sm font-bold text-ink">
                {featureLabelByKey.get(group.feature) ?? group.feature}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                {impactSummary(group)}
              </p>
            </div>
          ))}
        </div>
      </ConfirmDialog>
    </div>
  )
}
