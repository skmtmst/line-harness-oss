'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/shared/button'
import PageHeader from '@/components/shared/page-header'
import Toggle from '@/components/shared/toggle'
import { useAccount } from '@/contexts/account-context'
import { api, ApiError, type AnalyticsUsageOverview } from '@/lib/api'
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
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-ink-faint">
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

const USAGE_ITEM_IDS_BY_KEY: Record<string, string[]> = {
  templates: ['templates'],
  scenarios: ['scenarios'],
  forms: ['forms'],
  rich_menus: ['rich-menus'],
  friend_attributes: ['friend-attributes'],
  inflow_conversion: ['inflow', 'conversions'],
  automations: ['automations'],
  media_vars: ['common-vars', 'contents'],
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

function FeatureRow({ item, features, ordering, usage, usageRetry, sharedSwitch, canMoveUp, canMoveDown, onMove, onToggle }: {
  item: FeatureItem
  features: Record<string, boolean>
  ordering: boolean
  usage?: UsageCategory
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
              <span className="rounded-pill border-hairline whitespace-nowrap border px-1.5 py-0.5 text-[9px] font-bold text-ink-faint">
                同じスイッチ
              </span>
            )}
            {item.badge && (
              <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-[10px] font-bold text-accent-deep">
                {item.badge}
              </span>
            )}
            {usage && <UsageBadge category={usage} onRetry={usageRetry} />}
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
        {item.required && <span className="text-xs font-bold text-ink-faint">必須</span>}
        {item.required && <LockIcon />}
        <Toggle
          checked={enabled}
          locked={item.required}
          label={item.required ? `${item.label}は必須機能です` : `${item.label}を${enabled ? 'オフ' : 'オン'}にする`}
          onChange={(next) => onToggle(item, next)}
        />
      </div>
    </li>
  )
}

function FeatureSection({ group, features, ordering, usageByItemId, usageRetry, onItemToggle, onGroupToggle, onMove }: {
  group: FeatureGroup
  features: Record<string, boolean>
  ordering: boolean
  usageByItemId: Map<string, UsageCategory>
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
            className={`text-action focus-visible:outline-info text-[11px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 ${total === 0 ? 'cursor-default' : 'cursor-pointer'}`}
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
            usage={usageByItemId.get(item.id)}
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
   * 利用数だけ後から読む。設定の表示を重い集計で待たせない。
   *
   * 集計が8系統の数え直しで重いため、以前は設定と一緒に待っていた。
   * 先に設定を出して、数は届き次第バッジに足す。失敗しても設定は
   * 触れるままにし、バッジの「読み直す」から取り直せる。
   */
  const loadUsage = useCallback(async () => {
    if (!selectedAccountId) return
    setUsageFailed(false)
    try {
      const usageResponse = await api.analytics.usageOverview(selectedAccountId)
      if (usageResponse?.success) {
        setUsageCategories(usageResponse.data.data.categories)
      } else {
        setUsageFailed(true)
      }
    } catch {
      setUsageFailed(true)
    }
  }, [selectedAccountId])

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await api.featureSettings.get(selectedAccountId)
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
      setError(featureSettingsErrorMessage(error instanceof ApiError ? error.status : undefined, 'load'))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, loadUsage])

  useEffect(() => { void load() }, [load])

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

  const usageByItemId = useMemo(() => {
    const result = new Map<string, UsageCategory>()
    for (const category of usageCategories) {
      for (const itemId of USAGE_ITEM_IDS_BY_KEY[category.key] ?? []) result.set(itemId, category)
    }
    return result
  }, [usageCategories])

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

  const save = async () => {
    if (!selectedAccountId || !dirty) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await api.featureSettings.save(selectedAccountId, {
        features,
        sidebarItemOrder: currentOrder,
        expectedVersion: settingsVersion,
      })
      if (!response.success) {
        setError(response.error)
        return
      }
      /*
       * 保存したつもりの値をそのまま確定しない。サーバーが正した値
       * （無効環境の飲食店テストなど）を、そのままオン表示にすると
       * 読み直すまで誤った状態を見せる。サーバ値を読み直して確定する。
       */
      try {
        const latest = await api.featureSettings.get(selectedAccountId)
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
      setNotice('機能設定を保存しました。サイドメニューにも反映されています。')
      window.dispatchEvent(new CustomEvent(FEATURE_SETTINGS_UPDATED_EVENT, { detail: { accountId: selectedAccountId } }))
    } catch (error) {
      // ほかの管理者が先に保存したときは、編集中身は残したまま
      // 最新を読み直し、内容を確認してもう一度保存してもらう。
      if (error instanceof ApiError && error.status === 409) {
        try {
          const latest = await api.featureSettings.get(selectedAccountId)
          if (latest.success) {
            setSavedFeatures(normalizeFeatureSettings(latest.data.features))
            setSavedItemOrder(latest.data.sidebarItemOrder ?? {})
            setSettingsVersion(latest.data.version ?? 0)
          }
        } catch {
          // 読み直しに失敗しても編集中身は残す。
        }
        setError(FEATURE_SETTINGS_CONFLICT_MESSAGE)
        return
      }
      setError(featureSettingsErrorMessage(error instanceof ApiError ? error.status : undefined, 'save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
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
            onClick={() => {
              setFeatures({ ...CATALOG_DEFAULT_FEATURES })
              setItemOrder({})
              setNotice('')
            }}
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

          {loading ? (
            <div className="border-hairline bg-canvas text-ink-faint rounded-card border p-10 text-center text-sm">読み込み中…</div>
          ) : (
            <div className={ordering ? 'grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]' : ''}>
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
                        usageRetry={usageFailed ? () => void loadUsage() : undefined}
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
    </div>
  )
}
