'use client'

import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import ListState from '@/components/shared/list-state'
import StickyBar from '@/components/shared/sticky-bar'
import Toggle from '@/components/shared/toggle'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { ADMIN_THEME_CHANGED_EVENT } from '@/lib/events'
import {
  groupEnabledCount,
  groupFeatureCount,
  itemIsEnabled,
  type FeatureGroup,
  type FeatureItem,
  type MenuItemOrder,
} from '@/lib/feature-settings'
import { applyItemOrder } from './feature-settings-view'
import { SettingsShellV8 } from './settings-nav-v8'
import {
  groupSummary,
  shortUsageDate,
  useFeatureSettings,
  type FeatureUsage,
  type UsageCategory,
} from './use-feature-settings'
import styles from './settings-v8.module.css'

/**
 * 機能設定の V8 画面（★V8-B `ywFJT`）。
 * 左の設定メニュー＋機能名の検索＋区分ごとの開閉カード＋下部追従の保存帯。
 * 動き（保存・競合・影響確認・離脱の番兵）は useFeatureSettings に寄せ、V7 と同じ。
 */

const THEME_STORAGE_KEY = 'lh-admin-theme'

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="12" height="12">
      <path d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GripIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 20" width="12" height="18" className={styles.grip}>
      {[6, 10, 14].map((y) => (
        <g key={y}>
          <circle cx="4" cy={y} r="1.4" fill="currentColor" />
          <circle cx="8" cy={y} r="1.4" fill="currentColor" />
        </g>
      ))}
    </svg>
  )
}

/** 区分ごとの利用数バッジ（オン/オフを持たない項目用）。 */
function UsageBadge({ category, onRetry }: { category: UsageCategory; onRetry?: () => void }) {
  const created = category.created.value
  const inUse = category.inUse.value
  if (created === null || inUse === null) {
    return (
      <span
        className={styles.usage}
        title={category.inUse.reason ?? category.created.reason ?? '利用状況を取得できません'}
      >
        利用数は未取得
        {onRetry && (
          <button type="button" onClick={onRetry} aria-label="利用数を読み直す">
            読み直す
          </button>
        )}
      </span>
    )
  }
  return (
    <span
      className={`${styles.usage} ${styles.usageInfo}`}
      title={`${category.label}：作成 ${created}、利用中 ${inUse}`}
    >
      利用中 {inUse} / 作成 {created}
    </span>
  )
}

function FeatureUsageBadge({ usage, label, onRetry }: {
  usage: FeatureUsage
  label: string
  onRetry?: () => void
}) {
  const { activity, activityBasis, activityUnit, lastUsedAt } = usage
  const lastUsed = lastUsedAt.value ? shortUsageDate(lastUsedAt.value) : null
  const title = `${label}：${[
    lastUsed ? `最終利用 ${lastUsed}` : null,
    lastUsedAt.reason && !lastUsed ? lastUsedAt.reason : null,
    activity.reason ?? null,
  ].filter(Boolean).join('・') || '利用状況'}`
  if (activity.state === 'failed') {
    return (
      <span className={styles.usage} title={title}>
        利用状況は取得失敗
        {onRetry && (
          <button type="button" onClick={onRetry} aria-label="利用状況を読み直す">
            読み直す
          </button>
        )}
      </span>
    )
  }
  if (activity.value === null) {
    return (
      <span
        className={styles.usage}
        title={`${title}（${activity.reason ?? lastUsedAt.reason ?? 'この機能の利用は計測していません'}）`}
      >
        利用状況は未計測
      </span>
    )
  }
  if (activityBasis === 'current') {
    return <span className={`${styles.usage} ${styles.usageInfo}`} title={title}>{activityUnit} {activity.value}</span>
  }
  if (activity.value === 0 && lastUsed) {
    return (
      <span className={styles.usage} title={`${label}：直近90日の${activityUnit}は0・最終利用 ${lastUsed}`}>
        最終利用 {lastUsed}
      </span>
    )
  }
  return <span className={`${styles.usage} ${styles.usageInfo}`} title={title}>90日で {activity.value}{activityUnit}</span>
}

function FeatureRowV8({ item, features, usage, featureUsage, usageRetry, sharedSwitch, onToggle }: {
  item: FeatureItem
  features: Record<string, boolean>
  usage?: UsageCategory
  featureUsage?: FeatureUsage
  usageRetry?: () => void
  sharedSwitch: boolean
  onToggle: (item: FeatureItem, next: boolean) => void
}) {
  const enabled = itemIsEnabled(item, features)
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <p className={styles.rowLabel}>
          {item.label}
          {sharedSwitch && <span className={styles.sameSwitch}>同じスイッチ</span>}
          {item.badge && <span className={styles.itemBadge}>{item.badge}</span>}
          {featureUsage && <FeatureUsageBadge usage={featureUsage} label={item.label} onRetry={usageRetry} />}
          {!featureUsage && usage && <UsageBadge category={usage} onRetry={usageRetry} />}
        </p>
        <p className={styles.rowNote}>{item.note}</p>
      </div>
      <div className={styles.rowSide}>
        {item.required ? (
          <span className={styles.requiredBadge} title={`${item.label}は必須機能のため、オフにできません`}>
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

/** 既定で開く区分（板では「メイン」「配信」が開いている）。 */
const DEFAULT_OPEN = new Set(['basic', 'delivery'])

function FeatureCardV8({ group, features, usageByItemId, usageByFeatureId, usageRetry, open, onOpenChange, onItemToggle, onGroupToggle }: {
  group: FeatureGroup
  features: Record<string, boolean>
  usageByItemId: Map<string, UsageCategory>
  usageByFeatureId: Map<string, FeatureUsage>
  usageRetry?: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
  onItemToggle: (item: FeatureItem, next: boolean) => void
  onGroupToggle: (group: FeatureGroup, next: boolean) => void
}) {
  const total = groupFeatureCount(group)
  const enabled = groupEnabledCount(group, features)
  const allEnabled = total === 0 || enabled === total
  const switchCount = new Map<string, number>()
  for (const item of group.items) {
    const key = item.keys[0]
    if (key) switchCount.set(key, (switchCount.get(key) ?? 0) + 1)
  }
  return (
    <section className={styles.card}>
      <div className={`${styles.cardHead} ${open ? '' : styles.cardHeadCollapsed}`}>
        <button
          type="button"
          className={styles.chevron}
          aria-expanded={open}
          aria-label={`${group.label}を${open ? '畳む' : '開く'}`}
          onClick={() => onOpenChange(!open)}
        >
          {open ? '▾' : '▸'}
        </button>
        <h2 className={styles.cardTitle}>{group.label}</h2>
        <span className={styles.cardMeta}>{groupSummary(group, features)}</span>
        {total > 0 && (
          <button
            type="button"
            className={styles.cardHeadAction}
            onClick={() => onGroupToggle(group, !allEnabled)}
          >
            {allEnabled ? '全部オフ' : 'まとめてオン'}
          </button>
        )}
      </div>
      {open && (
        <ul className={styles.rows}>
          {group.items.map((item) => (
            <FeatureRowV8
              key={item.id}
              item={item}
              features={features}
              usage={item.keys.length === 0 ? usageByItemId.get(item.id) : undefined}
              featureUsage={item.keys[0] ? usageByFeatureId.get(item.keys[0]) : undefined}
              usageRetry={usageRetry}
              sharedSwitch={Boolean(item.keys[0]) && (switchCount.get(item.keys[0]) ?? 0) > 1}
              onToggle={onItemToggle}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/** 並び替えダイアログ（★V8-B `ztgRD`）。下書きの並びを動かし、確定で反映する。 */
export function ReorderDialog({ groups, initialOrder, onCancel, onApply, moveItemInOrder }: {
  groups: FeatureGroup[]
  initialOrder: MenuItemOrder
  onCancel: () => void
  onApply: (order: MenuItemOrder) => void
  moveItemInOrder: (order: MenuItemOrder, groupId: string, itemId: string, direction: -1 | 1) => MenuItemOrder
}) {
  const [draft, setDraft] = useState<MenuItemOrder>(initialOrder)
  const draftGroups = useMemo(() => applyItemOrder(groups, draft), [groups, draft])
  /* 手書きの窓にも共通の窓の振る舞い（Esc で閉じる・Tab の閉じ込め）を付ける。 */
  const panelRef = useOverlayFocus(true, onCancel)
  return (
    <div className={styles.dialogOverlay} role="presentation" onClick={onCancel}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="左のメニューの並びを変える"
        className={styles.dialog}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.dialogHead}>
          <p className={styles.dialogTitle}>左のメニューの並びを変える</p>
          <p className={styles.dialogDesc}>
            上下のボタンで同じ区分の中だけを入れ替えます。「この並びにする」を押すまで左のメニューは変わりません。
          </p>
        </div>
        <div className={styles.dialogBody}>
          {draftGroups.map((group) => (
            <div key={group.id}>
              <p className={styles.orderGroupLabel}>{group.label}</p>
              {group.items.map((item, index) => (
                <div key={item.id} className={styles.orderRow}>
                  <GripIcon />
                  <span className={styles.orderRowLabel}>{item.label}</span>
                  <button
                    type="button"
                    className={styles.moveBtn}
                    aria-label={`${item.label}を上へ`}
                    disabled={index === 0}
                    onClick={() => setDraft((current) => moveItemInOrder(current, group.id, item.id, -1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.moveBtn}
                    aria-label={`${item.label}を下へ`}
                    disabled={index === group.items.length - 1}
                    onClick={() => setDraft((current) => moveItemInOrder(current, group.id, item.id, 1))}
                  >
                    ↓
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className={styles.dialogFoot}>
          <span className={styles.dialogFootLead}>
            <button type="button" onClick={() => setDraft(initialOrder)}>
              元の並びに戻す
            </button>
          </span>
          <Button variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button variant="primary" onClick={() => onApply(draft)}>
            この並びにする
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 画面の見た目（試作）。このブラウザだけに効く切り替え。 */
function ThemeChoiceCard() {
  const [theme, setTheme] = useState<'v7' | 'v8' | null>(null)
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'v8' ? 'v8' : 'v7')
  }, [])
  const apply = (next: 'v7' | 'v8') => {
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // 保存できなくても、この画面だけの切り替えは効かせる
    }
    setTheme(next)
    window.dispatchEvent(new Event(ADMIN_THEME_CHANGED_EVENT))
  }
  return (
    <div className={styles.themeCard}>
      <p className={styles.themeTitle}>画面の見た目（試作）</p>
      <p className={styles.themeDesc}>
        新しい画面の見た目をこのブラウザだけで試せます。保存や送信の動きはどちらでも同じです。
      </p>
      <div className={styles.themeSegment} role="group" aria-label="画面の見た目">
        <button type="button" aria-pressed={theme === 'v7'} onClick={() => apply('v7')}>
          いまの見た目
        </button>
        <button type="button" aria-pressed={theme === 'v8'} onClick={() => apply('v8')}>
          新しい見た目（試す）
        </button>
      </div>
    </div>
  )
}

export function FeatureSettingsV8() {
  const settings = useFeatureSettings()
  const {
    selectedAccountId,
    features,
    groups,
    dirty,
    loading,
    saving,
    error,
    loadFailed,
    reason,
    setReason,
    itemOrder,
    setItemOrder,
    moveItemInOrder,
    discardChanges,
    resetToDefaults,
    resetToDefaultsOpen,
    setResetToDefaultsOpen,
    save,
    usageByItemId,
    usageByFeatureId,
    usageFailed,
    loadUsage,
    load,
    toggleItem,
    toggleGroup,
    impactOpen,
    setImpactOpen,
    impactGroups,
    impactBusy,
    impactError,
    setImpactError,
    confirmImpactSave,
    impactSummary,
    featureLabelByKey,
    leaveTarget,
    confirmLeave,
    cancelLeave,
    setSavedFeatures,
    setSavedItemOrder,
    currentOrder,
  } = settings

  const [query, setQuery] = useState('')
  const [reorderOpen, setReorderOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string> | null>(null)

  const filteredGroups = useMemo(() => {
    const q = query.trim()
    if (!q) return groups
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => item.label.includes(q) || item.note.includes(q),
        ),
      }))
      .filter((group) => group.items.length > 0)
  }, [groups, query])

  const isOpen = (group: FeatureGroup) => {
    if (query.trim()) return true
    return (openGroups ?? DEFAULT_OPEN).has(group.id)
  }
  const toggleOpen = (groupId: string, next: boolean) => {
    setOpenGroups((current) => {
      const base = new Set(current ?? DEFAULT_OPEN)
      if (next) base.add(groupId)
      else base.delete(groupId)
      return base
    })
  }

  /** 3列へ流し込む（列ごとにカードの塊）。 */
  const columns = useMemo(() => {
    const cols: FeatureGroup[][] = [[], [], []]
    filteredGroups.forEach((group, index) => {
      cols[index % 3].push(group)
    })
    return cols.filter((col) => col.length > 0)
  }, [filteredGroups])

  return (
    <SettingsShellV8
      title="機能設定"
      description="左のメニューに出す機能と、その並びを決めます。"
    >
      <p className={`${styles.band} ${styles.bandInfo}`}>
        使わない機能をオフにすると、左のメニューから消えます。消しても中のデータは残ります。
        並び順は「並びを変える」から入れ替えてください。
      </p>

      {!selectedAccountId ? (
        <p className={`${styles.card} ${styles.stateBox}`}>
          先に上部でLINEアカウントを選んでください。
        </p>
      ) : loading ? (
        <div className={`${styles.card} ${styles.stateBox}`}>
          読み込み中…
        </div>
      ) : loadFailed ? (
        <ListState
          kind="error"
          title={error || '機能設定を読み込めませんでした'}
          onRetry={() => void load()}
        />
      ) : (
        <>
          <div aria-live="polite">
            {error && <p role="alert" className={`${styles.band} ${styles.bandDanger}`}>{error}</p>}
          </div>

          <div className={styles.toolbar}>
            <span className={styles.toolbarSearch}>
              <input
                type="search"
                aria-label="機能の名前で探す"
                placeholder="機能の名前で探す"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </span>
            <Button variant="secondary" onClick={() => setReorderOpen(true)} disabled={saving}>
              並びを変える
            </Button>
          </div>

          {usageFailed && (
            <p className={`${styles.band} ${styles.bandWarn}`}>
              機能の利用状況を読めませんでした。設定の切替はそのまま使えます。{' '}
              <button type="button" onClick={() => void loadUsage()} className={styles.inlineLink}>
                利用状況を読み直す
              </button>
            </p>
          )}

          {filteredGroups.length === 0 ? (
            <ListState
              kind="empty"
              title="当てはまる機能がありません"
              description="探す言葉を変えてください。"
            />
          ) : (
            <div className={styles.cards}>
              {columns.map((column, columnIndex) => (
                <div key={columnIndex} className={styles.cardCol}>
                  {column.map((group) => (
                    <FeatureCardV8
                      key={group.id}
                      group={group}
                      features={features}
                      usageByItemId={usageByItemId}
                      usageByFeatureId={usageByFeatureId}
                      usageRetry={() => void loadUsage()}
                      open={isOpen(group)}
                      onOpenChange={(next) => toggleOpen(group.id, next)}
                      onItemToggle={toggleItem}
                      onGroupToggle={toggleGroup}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className={styles.reasonBand}>
            <label htmlFor="feature-settings-reason">
              変更理由（必須）
            </label>
            <input
              id="feature-settings-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例: 使っていない配信機能を止めるため"
              maxLength={300}
              disabled={saving}
            />
            <p className={styles.reasonHint}>保存の記録に残ります。空のままでは保存できません。</p>
          </div>

          <ThemeChoiceCard />
        </>
      )}

      {selectedAccountId && !loading && !loadFailed && (
        <StickyBar
          destructive={(
            <Button
              variant="danger"
              onClick={() => setResetToDefaultsOpen(true)}
              disabled={saving}
            >
              初期値に戻す
            </Button>
          )}
          status={dirty ? '未保存の変更があります' : undefined}
          actions={(
            <>
              <Button
                variant="secondary"
                onClick={discardChanges}
                disabled={saving || !dirty}
                title={!dirty ? '変更すると取り消せます' : undefined}
              >
                キャンセル
              </Button>
              <Button
                variant="primary"
                onClick={() => void save()}
                disabled={saving || !dirty}
                busy={saving}
                title={!dirty ? '変更すると保存できます' : undefined}
              >
                機能設定を保存
              </Button>
            </>
          )}
        />
      )}

      {reorderOpen && (
        <ReorderDialog
          groups={groups}
          initialOrder={itemOrder}
          moveItemInOrder={moveItemInOrder}
          onCancel={() => setReorderOpen(false)}
          onApply={(order) => {
            setItemOrder(order)
            setReorderOpen(false)
          }}
        />
      )}

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

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="この画面で変更した機能の表示・並び順"
        busy={saving}
        onCancel={() => {
          if (!saving) cancelLeave()
        }}
        onConfirm={() => {
          setSavedFeatures({ ...features })
          setSavedItemOrder(currentOrder)
          confirmLeave()
        }}
      />

      <ConfirmDialog
        open={impactOpen}
        title="オフにする前に確認"
        description="止まる仕事があります。オフにしてもデータは削除されず、再度オンにすると再開できます。公開中のページや動いている配信・予約は、それぞれの画面で止めてからオフにしてください。"
        confirmLabel="確認して保存する"
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
        <div>
          {impactGroups.map((group) => (
            <div key={group.feature} className={styles.impactGroup}>
              <p className={styles.impactName}>
                {featureLabelByKey.get(group.feature) ?? group.feature}
              </p>
              <p className={styles.impactText}>
                {impactSummary(group)}
              </p>
            </div>
          ))}
        </div>
      </ConfirmDialog>
    </SettingsShellV8>
  )
}
