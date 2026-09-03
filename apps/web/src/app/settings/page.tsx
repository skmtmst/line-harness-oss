'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import PageHeader from '@/components/shared/page-header'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import {
  DEFAULT_FEATURES,
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
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
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

/**
 * 行の先頭に出す点。動かせる行の目印。
 *
 * 点だけでは動かせない（ドラッグは受けない）。実際に動かすのは右の↑↓で、
 * 点は「この行は並べ替えの対象」という印として置く。
 */
function GripIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 20" className="h-5 w-3 shrink-0 text-[#c4c4c4]">
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

function FeatureRow({ item, features, canMoveUp, canMoveDown, onMove, onToggle }: {
  item: FeatureItem
  features: Record<string, boolean>
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (itemId: string, direction: -1 | 1) => void
  onToggle: (item: FeatureItem, next: boolean) => void
}) {
  const enabled = itemIsEnabled(item, features)
  return (
    <li className="flex min-h-[62px] items-center justify-between gap-4 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5"><GripIcon /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-[#565656]">{item.label}</p>
            {item.badge && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                {item.badge}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[#777]">{item.note}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          aria-label={`${item.label}を上へ`}
          title="上へ移動"
          disabled={!canMoveUp}
          onClick={() => onMove(item.id, -1)}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[#dedede] bg-white text-xs font-bold text-[#565656] hover:bg-[#f7f7f5] disabled:cursor-not-allowed disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`${item.label}を下へ`}
          title="下へ移動"
          disabled={!canMoveDown}
          onClick={() => onMove(item.id, 1)}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[#dedede] bg-white text-xs font-bold text-[#565656] hover:bg-[#f7f7f5] disabled:cursor-not-allowed disabled:opacity-30"
        >
          ↓
        </button>
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-[#dedede]" />
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

function FeatureSection({ group, features, onItemToggle, onGroupToggle, onMove }: {
  group: FeatureGroup
  features: Record<string, boolean>
  onItemToggle: (item: FeatureItem, next: boolean) => void
  onGroupToggle: (group: FeatureGroup, next: boolean) => void
  onMove: (groupId: string, itemId: string, direction: -1 | 1) => void
}) {
  const total = groupFeatureCount(group)
  const allEnabled = total === 0 || groupEnabledCount(group, features) === total
  return (
    <section className="overflow-hidden rounded-[18px] border border-[#dedede] bg-white">
      <div className="flex min-h-[42px] items-center justify-between gap-4 border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="text-sm font-bold text-[#202020]">{group.label}</h2>
          <p className="text-[10px] text-[#777]">{groupSummary(group, features)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-disabled={total === 0}
            onClick={() => total > 0 && onGroupToggle(group, !allEnabled)}
            className={`text-[11px] font-bold text-[#0066d6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066d6] ${total === 0 ? 'cursor-default' : 'cursor-pointer'}`}
          >
            グループごと切替
          </button>
        </div>
      </div>
      <ul className="divide-y divide-[#e8e8e8]">
        {group.items.map((item, index) => (
          <FeatureRow
            key={item.id}
            item={item}
            features={features}
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
      <div className="overflow-hidden rounded-[22px] border border-[#dedede] bg-white">
        <div className="max-h-[calc(100vh-8rem)] space-y-4 overflow-y-auto px-6 pb-3 pt-6">
          {groups.map((group) => (
            <div key={group.id}>
              <p className="mb-2 text-xs font-bold text-[#777]">{group.label}</p>
              <div className="space-y-0.5 pl-3">
                {group.items.map((item) => {
                  const enabled = itemIsEnabled(item, features)
                  return (
                    <div
                      key={item.id}
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
  const [savedItemOrder, setSavedItemOrder] = useState<MenuItemOrder>({})
  const [itemOrder, setItemOrder] = useState<MenuItemOrder>({})
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
      const nextOrder = response.data.sidebarItemOrder ?? {}
      setSavedItemOrder(nextOrder)
      setItemOrder(nextOrder)
      setSpecializedFeatureKeys(response.data.specializedFeatureKeys ?? [])
    } catch {
      setError('機能設定を読み込めませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  /** 並び順を当てたあとの区分。画面も見え方の欄もこれを見る。 */
  const groups = useMemo(() => {
    return visibleFeatureGroups({ specializedFeatureKeys }).map((group) => {
      const order = itemOrder[group.id]
      if (!order || order.length === 0) return group
      const byId = new Map(group.items.map((item) => [item.id, item]))
      const sorted: FeatureItem[] = []
      for (const id of order) {
        const item = byId.get(id)
        if (item && !sorted.includes(item)) sorted.push(item)
      }
      return { ...group, items: [...sorted, ...group.items.filter((item) => !sorted.includes(item))] }
    })
  }, [itemOrder, specializedFeatureKeys])

  const currentOrder = useMemo(() => itemOrderFromGroups(groups), [groups])
  const dirty =
    Object.keys(DEFAULT_FEATURES).some((key) => features[key] !== savedFeatures[key]) ||
    JSON.stringify(currentOrder) !== JSON.stringify(itemOrderFromGroups(
      visibleFeatureGroups({ specializedFeatureKeys }).map((group) => {
        const order = savedItemOrder[group.id]
        if (!order || order.length === 0) return group
        const byId = new Map(group.items.map((item) => [item.id, item]))
        const sorted: FeatureItem[] = []
        for (const id of order) {
          const item = byId.get(id)
          if (item && !sorted.includes(item)) sorted.push(item)
        }
        return { ...group, items: [...sorted, ...group.items.filter((item) => !sorted.includes(item))] }
      }),
    ))

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
      })
      if (!response.success) {
        setError(response.error)
        return
      }
      setSavedFeatures({ ...features })
      setSavedItemOrder(currentOrder)
      setItemOrder(currentOrder)
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
      <PageHeader
        className="mb-5"
        breadcrumb={[{ label: '設定' }, { label: '機能設定' }]}
        title="機能設定"
        description="使わない機能をオフにすると、サイドメニューから消えます。データは残るので、あとからオンに戻せば元どおりです。並び順は↑↓で、同じ区分の中だけ入れ替えられます。"
        actions={(
          <>
          <button
            type="button"
            onClick={() => {
              setFeatures({ ...DEFAULT_FEATURES })
              setItemOrder({})
              setNotice('')
            }}
            disabled={loading || saving}
            className="min-h-10 cursor-pointer rounded-lg border border-[#d9d9d9] bg-white px-4 text-sm font-bold text-[#444] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-40"
          >
            初期値に戻す
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving}
            className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-accent-deep px-5 text-sm font-bold text-white hover:bg-accent-deep/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path d="m4 10 3.5 3.5L16 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {saving ? '保存中…' : '保存'}
          </button>
          </>
        )}
      />

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
              {/*
                区分ごとの印は付けない。区分と項目はサイドメニューと同じ一覧
                （src/lib/menu.ts）から作るので、並びと顔ぶれは
                sidebar-design.test.ts が見ている。ここで二重に縛ると、
                項目を1つ足すたびに2か所直すことになる。
              */}
              <div data-design="機能の一覧" className="space-y-5">
                {groups.map((group) => (
                  <div key={group.id}>
                    <FeatureSection
                      group={group}
                      features={features}
                      onItemToggle={toggleItem}
                      onGroupToggle={toggleGroup}
                      onMove={moveItem}
                    />
                  </div>
                ))}
              </div>
              <SidebarPreview groups={groups} features={features} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
