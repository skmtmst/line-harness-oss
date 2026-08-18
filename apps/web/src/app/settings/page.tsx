'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import {
  DEFAULT_FEATURES,
  FEATURE_SETTINGS_UPDATED_EVENT,
  SIDEBAR_FEATURE_BY_HREF,
  groupEnabledCount,
  groupFeatureCount,
  itemIsEnabled,
  visibleFeatureGroups,
  type FeatureGroup,
  type FeatureItem,
  type FeatureKey,
} from '@/lib/feature-settings'

function Switch({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange?: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
        checked ? 'bg-emerald-500' : 'bg-gray-200'
      } ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function groupSummary(group: FeatureGroup, features: Record<string, boolean>) {
  if (group.id === 'basic') return 'この3つは無効にできません'
  const total = groupFeatureCount(group)
  const enabled = groupEnabledCount(group, features)
  if (enabled === total) return `${total}機能すべて有効`
  if (enabled === 0) return `${total}機能すべて無効`
  return `${total}機能中 ${enabled}つが有効`
}

function FeatureRow({ item, features, onToggle }: {
  item: FeatureItem
  features: Record<string, boolean>
  onToggle: (item: FeatureItem, next: boolean) => void
}) {
  const enabled = itemIsEnabled(item, features)
  return (
    <li className="flex min-h-16 items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-gray-900">{item.label}</p>
          {item.badge && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              item.badge === '専用'
                ? 'bg-emerald-50 text-emerald-700'
                : item.badge === '要API申請'
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-blue-50 text-blue-700'
            }`}>
              {item.badge}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">{item.note}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={`hidden text-xs font-semibold sm:inline ${enabled ? 'text-emerald-600' : 'text-gray-400'}`}>
          {item.required ? '必須' : enabled ? 'オン' : 'オフ'}
        </span>
        <Switch
          checked={enabled}
          disabled={item.required}
          label={item.required ? `${item.label}は必須機能です` : `${item.label}を${enabled ? 'オフ' : 'オン'}にする`}
          onChange={(next) => onToggle(item, next)}
        />
      </div>
    </li>
  )
}

function FeatureSection({ group, features, onItemToggle, onGroupToggle }: {
  group: FeatureGroup
  features: Record<string, boolean>
  onItemToggle: (item: FeatureItem, next: boolean) => void
  onGroupToggle: (group: FeatureGroup, next: boolean) => void
}) {
  const total = groupFeatureCount(group)
  const enabled = groupEnabledCount(group, features)
  const allEnabled = group.id === 'basic' || enabled === total
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-gray-100 bg-gray-50/70 px-5 py-3.5 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-base font-bold text-gray-900">{group.label}</h2>
          <p className="text-xs text-gray-500">{groupSummary(group, features)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-[11px] font-medium text-gray-500 sm:inline">グループごと切替</span>
          <Switch
            checked={allEnabled}
            disabled={group.id === 'basic'}
            label={`${group.label}をまとめて${allEnabled ? 'オフ' : 'オン'}にする`}
            onChange={(next) => onGroupToggle(group, next)}
          />
        </div>
      </div>
      <ul className="divide-y divide-gray-100">
        {group.items.map((item) => (
          <FeatureRow key={item.id} item={item} features={features} onToggle={onItemToggle} />
        ))}
      </ul>
    </section>
  )
}

const PREVIEW_SECTIONS = [
  { label: 'ホーム', items: [{ label: 'ダッシュボード' }] },
  { label: '対応', items: [{ label: '受信箱' }, { label: '友だち' }] },
  { label: '友だち属性', items: [{ label: 'タグ管理' }, { label: '友だち情報欄' }] },
  {
    label: '配信',
    items: [
      { label: 'シナリオ配信', href: '/scenarios' },
      { label: '一斉配信', href: '/broadcasts' },
      { label: 'テンプレート', href: '/templates' },
      { label: 'リマインダ', href: '/reminders' },
      { label: '自動応答', href: '/auto-replies' },
      { label: 'リッチメニュー', href: '/rich-menus' },
      { label: 'ウェビナー', href: '/webinars' },
    ],
  },
  {
    label: '成果と分析',
    items: [
      { label: '流入経路', href: '/inflow-links' },
      { label: '回答フォーム', href: '/form-submissions' },
      { label: 'マイル', href: '/scoring' },
      { label: '成果とアフィリエイト', href: '/conversions' },
    ],
  },
] as const

function SidebarPreview({ features, specializedFeatureKeys, showMultiStore }: {
  features: Record<string, boolean>
  specializedFeatureKeys: string[]
  showMultiStore: boolean
}) {
  const specialized = [
    { label: '健康記録', href: '/nen-campaigns', key: 'nen_campaigns' },
    { label: '写真審査', href: '/nen-members', key: 'photo_review' },
    { label: 'EC連携', href: '/ec-commerce', key: 'ec_commerce' },
  ].filter((item) => specializedFeatureKeys.includes(item.key))
  const multiStore = showMultiStore
    ? [
        { label: '店舗一覧', key: 'multi_store_hierarchy' },
        { label: '一括更新', key: 'multi_store_bulk_updates' },
        { label: '予約台帳', key: 'reservation_ledger' },
        { label: 'Googleマップ連携', key: 'google_business_profile' },
      ]
    : []
  const sections = [
    ...PREVIEW_SECTIONS,
    ...(specialized.length ? [{ label: '専用機能', items: specialized }] : []),
    ...(multiStore.length ? [{ label: '多店舗管理', items: multiStore }] : []),
  ]
  let hidden = 0
  for (const section of sections) {
    for (const item of section.items) {
      const key = 'href' in item && item.href
        ? SIDEBAR_FEATURE_BY_HREF[item.href]
        : 'key' in item ? item.key as FeatureKey : undefined
      if (key && features[key] === false) hidden += 1
    }
  }
  return (
    <aside data-design="サイドメニューの見え方" className="xl:sticky xl:top-6">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="font-bold text-gray-900">サイドメニューの見え方</h2>
          <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">保存前</span>
        </div>
        <div className="max-h-[calc(100vh-13rem)] space-y-4 overflow-y-auto px-5 py-4">
          {sections.map((section) => (
            <div key={section.label}>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">{section.label}</p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const key = 'href' in item && item.href
                    ? SIDEBAR_FEATURE_BY_HREF[item.href]
                    : 'key' in item ? item.key as FeatureKey : undefined
                  const enabled = !key || features[key] !== false
                  return (
                    <div
                      key={item.label}
                      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${
                        enabled ? 'text-gray-700' : 'bg-gray-50 text-gray-300 line-through'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                      <span className="truncate">{item.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-3 text-xs text-gray-500">
          {hidden > 0 ? `${hidden} 項目が非表示になります` : 'すべての項目が表示されます'}
        </div>
      </div>
    </aside>
  )
}

export default function SettingsPage() {
  const { accounts, selectedAccountId, selectedAccount } = useAccount()
  const [savedFeatures, setSavedFeatures] = useState<Record<string, boolean>>(DEFAULT_FEATURES)
  const [features, setFeatures] = useState<Record<string, boolean>>(DEFAULT_FEATURES)
  const [specializedFeatureKeys, setSpecializedFeatureKeys] = useState<string[]>([])
  const [parentChildMode, setParentChildMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
      const next = { ...DEFAULT_FEATURES, ...response.data.features }
      setSavedFeatures(next)
      setFeatures(next)
      setSpecializedFeatureKeys(response.data.specializedFeatureKeys ?? [])
      setParentChildMode(response.data.parentChildMode ?? false)
    } catch {
      setError('機能設定を読み込めませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  const showMultiStore = accounts.length > 1 || parentChildMode
  const groups = useMemo(
    () => visibleFeatureGroups({ showMultiStore, specializedFeatureKeys }),
    [showMultiStore, specializedFeatureKeys],
  )
  const dirty = Object.keys(DEFAULT_FEATURES).some((key) => features[key] !== savedFeatures[key])

  const toggleItem = (item: FeatureItem, next: boolean) => {
    if (item.required) return
    setFeatures((current) => {
      const changed = { ...current }
      for (const key of item.keys) changed[key] = next
      return changed
    })
    setNotice('')
  }

  const toggleGroup = (group: FeatureGroup, next: boolean) => {
    if (group.id === 'basic') return
    setFeatures((current) => {
      const changed = { ...current }
      for (const item of group.items) for (const key of item.keys) changed[key] = next
      return changed
    })
    setNotice('')
  }

  const save = async () => {
    if (!selectedAccountId || !dirty) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await api.featureSettings.save(selectedAccountId, { features })
      if (!response.success) {
        setError(response.error)
        return
      }
      setSavedFeatures({ ...features })
      setNotice('機能設定を保存しました。サイドメニューにも反映されています。')
      window.dispatchEvent(new CustomEvent(FEATURE_SETTINGS_UPDATED_EVENT, { detail: { accountId: selectedAccountId } }))
    } catch {
      setError('保存できませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header
        title="機能設定"
        description="使わない機能をオフにすると、サイドメニューから消えます。データは残るので、あとからオンに戻せば元どおりです。"
      />

      {!selectedAccountId ? (
        <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          先に上部でLINEアカウントを選んでください。
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="text-xs font-medium text-gray-500">適用先</span>
              <span className="truncate rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-800">この契約全体</span>
              <span className="hidden truncate text-xs text-gray-400 md:inline">
                {selectedAccount?.displayName ?? selectedAccount?.name ?? selectedAccountId}
              </span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setFeatures({ ...DEFAULT_FEATURES }); setNotice('') }}
                disabled={loading || saving}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                初期値に戻す
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={loading || saving || !dirty}
                className="min-w-24 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>

          <div className="mb-5 flex items-start gap-3 rounded-xl bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-800">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold">i</span>
            <p>オフにしても、その機能で作ったデータ（タグ・配信履歴・予約など）は削除されません。APIも動いたままなので、管理画面から隠れるだけです。</p>
          </div>

          <div aria-live="polite">
            {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
            {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</div>}
          </div>

          {loading ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">読み込み中…</div>
          ) : (
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="space-y-5">
                {groups.map((group) => (
                  group.id === 'basic' ? (
                    <div key={group.id} data-design="基本">
                      <FeatureSection group={group} features={features} onItemToggle={toggleItem} onGroupToggle={toggleGroup} />
                    </div>
                  ) : group.id === 'delivery' ? (
                    <div key={group.id} data-design="配信">
                      <FeatureSection group={group} features={features} onItemToggle={toggleItem} onGroupToggle={toggleGroup} />
                    </div>
                  ) : group.id === 'results' ? (
                    <div key={group.id} data-design="成果と分析">
                      <FeatureSection group={group} features={features} onItemToggle={toggleItem} onGroupToggle={toggleGroup} />
                    </div>
                  ) : group.id === 'specialized' ? (
                    <div key={group.id} data-design="この契約の専用機能">
                      <FeatureSection group={group} features={features} onItemToggle={toggleItem} onGroupToggle={toggleGroup} />
                    </div>
                  ) : (
                    <div key={group.id} data-design="多店舗管理">
                      <FeatureSection group={group} features={features} onItemToggle={toggleItem} onGroupToggle={toggleGroup} />
                    </div>
                  )
                ))}
              </div>
              <SidebarPreview features={features} specializedFeatureKeys={specializedFeatureKeys} showMultiStore={showMultiStore} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
