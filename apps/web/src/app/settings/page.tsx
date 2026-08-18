'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import {
  DEFAULT_FEATURES,
  FEATURE_SETTINGS_UPDATED_EVENT,
  NEN_SHOW_MULTI_STORE,
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
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#06c755] ${
        checked && !disabled ? 'bg-[#06c755]' : 'bg-[#dedede]'
      } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-[#7d7d7d]">
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

function groupSummary(group: FeatureGroup, features: Record<string, boolean>) {
  if (group.id === 'basic') return 'この3つは無効にできません'
  const total = groupFeatureCount(group)
  const enabled = groupEnabledCount(group, features)
  if (enabled === total) return `${total}機能すべて有効`
  if (enabled === 0) return group.id === 'multi-store'
    ? `${total}機能すべて無効（この契約では使いません）`
    : `${total}機能すべて無効`
  return `${total}機能中 ${enabled}つが有効`
}

function FeatureRow({ item, features, onToggle }: {
  item: FeatureItem
  features: Record<string, boolean>
  onToggle: (item: FeatureItem, next: boolean) => void
}) {
  const enabled = itemIsEnabled(item, features)
  return (
    <li className="flex min-h-[62px] items-center justify-between gap-4 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-[#565656]">{item.label}</p>
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
        <p className="mt-0.5 text-[11px] leading-relaxed text-[#777]">{item.note}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <span className={`text-xs font-bold ${enabled && !item.required ? 'text-[#00b84f]' : 'text-[#777]'}`}>
          {item.required ? '必須' : enabled ? 'オン' : 'オフ'}
        </span>
        {item.required && <LockIcon />}
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
    <section className="overflow-hidden rounded-[18px] border border-[#dedede] bg-white">
      <div className="flex min-h-[42px] items-center justify-between gap-4 border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="text-sm font-bold text-[#202020]">{group.label}</h2>
          <p className="text-[10px] text-[#777]">{groupSummary(group, features)}</p>
        </div>
        <button
          type="button"
          aria-disabled={group.id === 'basic'}
          onClick={() => group.id !== 'basic' && onGroupToggle(group, !allEnabled)}
          className="shrink-0 text-[11px] font-bold text-[#0066d6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066d6]"
        >
          グループごと切替
        </button>
      </div>
      <ul className="divide-y divide-[#e8e8e8]">
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
      <div className="overflow-hidden rounded-[22px] border border-[#dedede] bg-white">
        <div className="max-h-[calc(100vh-8rem)] space-y-4 overflow-y-auto px-6 pb-3 pt-6">
          {sections.map((section) => (
            <div key={section.label}>
              <p className="mb-2 text-xs font-bold text-[#777]">{section.label}</p>
              <div className="space-y-0.5 pl-3">
                {section.items.map((item) => {
                  const key = 'href' in item && item.href
                    ? SIDEBAR_FEATURE_BY_HREF[item.href]
                    : 'key' in item ? item.key as FeatureKey : undefined
                  const enabled = !key || features[key] !== false
                  return (
                    <div
                      key={item.label}
                      className={`flex min-h-7 items-center gap-2 text-[13px] font-medium ${
                        enabled ? 'text-[#333]' : 'text-[#999]'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${enabled ? 'bg-[#06c755]' : 'bg-[#dedede]'}`} />
                      <span className="truncate">{item.label}</span>
                      {!enabled && <EyeOffIcon className="ml-auto h-4 w-4 shrink-0 text-[#8b8b8b]" />}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="border-t border-[#ededed] pb-1 pt-3 text-xs">
            <p className="flex items-center gap-2 text-[#777]">
              <EyeOffIcon className="h-4 w-4 shrink-0" />
              この印はメニューに表示されません
            </p>
            <p className="mt-2 font-bold text-[#c94900]">
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
  const [savedFeatures, setSavedFeatures] = useState<Record<string, boolean>>(DEFAULT_FEATURES)
  const [features, setFeatures] = useState<Record<string, boolean>>(DEFAULT_FEATURES)
  const [specializedFeatureKeys, setSpecializedFeatureKeys] = useState<string[]>([])
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
    } catch {
      setError('機能設定を読み込めませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  // 然では機能未実装の多店舗管理を、設計確認用として最下部へ常時仮置きする。
  const showMultiStore = NEN_SHOW_MULTI_STORE
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
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold tracking-tight text-[#202020]">機能設定</h1>
          <p className="mt-1 text-xs leading-relaxed text-[#777]">
            使わない機能をオフにすると、サイドメニューから消えます。データは残るので、あとからオンに戻せば元どおりです。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="適用先：この契約全体"
            className="flex min-h-10 min-w-[260px] items-center rounded-lg border border-[#d9d9d9] bg-white px-4 text-left"
          >
            <span className="mr-3 text-xs text-[#777]">適用先</span>
            <span className="text-sm font-bold text-[#222]">この契約全体</span>
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="ml-auto h-4 w-4 text-[#555]">
              <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => { setFeatures({ ...DEFAULT_FEATURES }); setNotice('') }}
            disabled={loading || saving}
            className="min-h-10 rounded-lg border border-[#d9d9d9] bg-white px-4 text-sm font-bold text-[#444] hover:bg-[#fafafa] disabled:opacity-40"
          >
            初期値に戻す
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#06c755] px-5 text-sm font-bold text-white hover:bg-[#05b34c] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path d="m4 10 3.5 3.5L16 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className="mb-5 flex items-start gap-3 rounded-[16px] bg-[#edf8ff] px-5 py-3.5 text-xs leading-relaxed text-[#3f4b53]">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="mt-px h-4 w-4 shrink-0 text-[#0066d6]">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
          <path d="M12 10.5v6M12 7.5h.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
        <p>オフにしても、その機能で作ったデータ（タグ・配信履歴・予約など）は削除されません。APIも動いたままなので、管理画面から隠れるだけです。</p>
      </div>

      {!selectedAccountId ? (
        <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          先に上部でLINEアカウントを選んでください。
        </p>
      ) : (
        <>
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
