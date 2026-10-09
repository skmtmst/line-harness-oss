'use client'

/*
 * ★V8 機能設定（Pencil `ywFJT`・1152 `bKipf`・競合 `ziYCN`・状態の見本帳 `bR6a1`）。
 *
 * 動き（読み込み・保存・競合・オフ前の影響確認・離脱の番兵・初期値に戻す・並びを変える）は
 * 今までの V8（app/settings/feature-settings-v8.tsx）と同じ。処理は同じ場所の
 * use-feature-settings.ts（写し）に1つだけ置く。見た目だけを型（SettingsPage）と部品で組み直した。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Check, ChevronDown, ChevronRight, Eye, GitCompare, Lock, RefreshCw, RotateCcw, Save, TriangleAlert } from 'lucide-react'
import Button from '@/components/shared/button'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ReorderList from '@/components/shared/reorder-list'
import { RowMenu } from '@/components/shared/row-actions'
import ListState from '@/components/shared/list-state'
import { SettingCheckbox } from '@/components/shared/checkbox'
import SearchField from '@/components/shared/search-field'
import Notice from '@/components/shared/notice'
import { Field } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import {
  groupEnabledCount,
  groupFeatureCount,
  itemIsEnabled,
  type FeatureGroup,
  type FeatureItem,
  type MenuItemOrder,
} from '@/lib/feature-settings'
import { SbSettingsScreen } from '../sb-frame/settings-screen'
import { applyItemOrder, FEATURE_SETTINGS_CONFLICT_MESSAGE } from './feature-settings-view'
import {
  groupSummary,
  shortUsageDate,
  useFeatureSettings,
  type FeatureUsage,
  type UsageCategory,
} from './use-feature-settings'
import styles from './screen.module.css'
import { permissionDeniedMessage } from '@/components/shared/api-error-message'

const TITLE = '機能設定'
const DESCRIPTION = '使わない機能をオフにすると、左のメニューから消えます。作ったデータは消えません'
const VIEWER_NOTE = '閲覧のみで見ています。機能のオン・オフと並びは、オーナーか管理者に頼んでください。'

/** 区分ごとの利用数（オン/オフを持たない項目用）。行の名前の横に小さく出す。 */
function UsageBadge({ category, onRetry }: { category: UsageCategory; onRetry?: () => void }) {
  const created = category.created.value
  const inUse = category.inUse.value
  if (created === null || inUse === null) {
    return (
      <span className={styles.usage} title={category.inUse.reason ?? category.created.reason ?? '利用状況はまだ分かりません'}>
        利用数は未取得
        {onRetry && <button type="button" onClick={onRetry} aria-label="利用数を読み直す">読み直す</button>}
      </span>
    )
  }
  return (
    <span className={styles.usage} title={`${category.label}：作成 ${created}、利用中 ${inUse}`}>
      利用中 {inUse} / 作成 {created}
    </span>
  )
}

function FeatureUsageBadge({ usage, label, onRetry }: { usage: FeatureUsage; label: string; onRetry?: () => void }) {
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
        {onRetry && <button type="button" onClick={onRetry} aria-label="利用状況を読み直す">読み直す</button>}
      </span>
    )
  }
  if (activity.value === null) {
    return (
      <span className={styles.usage} title={`${title}（${activity.reason ?? lastUsedAt.reason ?? 'この機能の利用は計測していません'}）`}>
        利用状況は未計測
      </span>
    )
  }
  if (activityBasis === 'current') return <span className={styles.usage} title={title}>{activityUnit} {activity.value}</span>
  if (activity.value === 0 && lastUsed) {
    return <span className={styles.usage} title={`${label}：直近90日の${activityUnit}は0・最終利用 ${lastUsed}`}>最終利用 {lastUsed}</span>
  }
  return <span className={styles.usage} title={title}>90日で {activity.value}{activityUnit}</span>
}

function FeatureRow({ item, features, usage, featureUsage, usageRetry, sharedSwitch, canManage, busy, onToggle }: {
  item: FeatureItem
  features: Record<string, boolean>
  usage?: UsageCategory
  featureUsage?: FeatureUsage
  usageRetry?: () => void
  sharedSwitch: boolean
  canManage: boolean
  busy?: boolean
  onToggle: (item: FeatureItem, next: boolean) => void
}) {
  const enabled = itemIsEnabled(item, features)
  return (
    <li className={styles.row}>
      <div className={styles.rowText}>
        <p className={styles.rowName}>
          <span className={styles.rowLabel} title={item.label}>{item.label}</span>
          {sharedSwitch && <span className={styles.rowTag}>同じスイッチ</span>}
          {item.badge && <span className={styles.rowTag}>{item.badge}</span>}
          {featureUsage && <FeatureUsageBadge usage={featureUsage} label={item.label} onRetry={usageRetry} />}
          {!featureUsage && usage && <UsageBadge category={usage} onRetry={usageRetry} />}
        </p>
        <p className={styles.rowNote}>{item.note}</p>
      </div>
      {item.required ? (
        <span className={styles.required} title={`${item.label}は必須機能のため、オフにできません`}>
          <Lock className={styles.requiredIcon} aria-hidden="true" />
          必須
        </span>
      ) : canManage ? (
        <SettingCheckbox
          checked={enabled}
          label={`${item.label}を${enabled ? 'オフ' : 'オン'}にする`}
          disabled={busy}
          onChange={(next) => onToggle(item, next)}
        />
      ) : (
        <span className={styles.stateText}>{enabled ? 'オン' : 'オフ'}</span>
      )}
    </li>
  )
}

/** 既定で開く区分（絵では「メイン」「配信」「設定」が開いている）。 */
/* 絵（ywFJT・bKipf）では、最初に開いているのはメインと配信だけ。 */
const DEFAULT_OPEN = new Set(['basic', 'delivery'])
/** 絵の並び：「設定」の区分はいちばん下（飲食店向けのあと）。ほかは今までの並びのまま。 */
const LAST_GROUP_IDS = ['settings']
function settingsGroupLast<T extends { id: string }>(groups: T[]): T[] {
  return [...groups.filter((group) => !LAST_GROUP_IDS.includes(group.id)), ...groups.filter((group) => LAST_GROUP_IDS.includes(group.id))]
}

function FeatureGroupCard({ group, features, usageByItemId, usageByFeatureId, usageRetry, open, canManage, busy, onOpenChange, onItemToggle, onGroupToggle }: {
  group: FeatureGroup
  features: Record<string, boolean>
  usageByItemId: Map<string, UsageCategory>
  usageByFeatureId: Map<string, FeatureUsage>
  usageRetry?: () => void
  open: boolean
  canManage: boolean
  busy?: boolean
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
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section className={styles.group} aria-label={group.label}>
      <div className={styles.groupHead}>
        <button
          type="button"
          className={styles.groupToggle}
          aria-expanded={open}
          aria-label={`${group.label}を${open ? '畳む' : '開く'}`}
          onClick={() => onOpenChange(!open)}
        >
          <Chevron className={styles.chevron} aria-hidden="true" />
        </button>
        <h2 className={styles.groupTitle}>{group.label}</h2>
        <span className={styles.groupMeta}>{groupSummary(group, features)}</span>
        <span className={styles.spacer} />
        {total > 0 && canManage && (
          <Button
            variant="text"
            disabled={busy}
            onClick={() => onGroupToggle(group, !allEnabled)}
            aria-label={`${group.label}をまとめて${allEnabled ? 'オフ' : 'オン'}にする`}
          >
            まとめて
          </Button>
        )}
      </div>
      {open && (
        <ul className={styles.rows}>
          {group.items.map((item) => (
            <FeatureRow
              key={item.id}
              item={item}
              features={features}
              usage={item.keys.length === 0 ? usageByItemId.get(item.id) : undefined}
              featureUsage={item.keys[0] ? usageByFeatureId.get(item.keys[0]) : undefined}
              usageRetry={usageRetry}
              sharedSwitch={Boolean(item.keys[0]) && (switchCount.get(item.keys[0]) ?? 0) > 1}
              canManage={canManage}
              busy={busy}
              onToggle={onItemToggle}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/** 並び替えの窓（★V8-B `ztgRD`）。下書きの並びを動かし、確定で反映する。 */
export function ReorderDialog({ groups, initialOrder, onCancel, onApply }: {
  groups: FeatureGroup[]
  initialOrder: MenuItemOrder
  onCancel: () => void
  onApply: (order: MenuItemOrder) => void
  moveItemInOrder: (order: MenuItemOrder, groupId: string, itemId: string, direction: -1 | 1) => MenuItemOrder
}) {
  const [draft, setDraft] = useState<MenuItemOrder>(initialOrder)
  const draftGroups = useMemo(() => applyItemOrder(groups, draft), [groups, draft])
  const [groupId, setGroupId] = useState(groups.find((group) => group.id === 'delivery')?.id ?? groups[0]?.id ?? '')
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  const group = draftGroups.find((item) => item.id === groupId)
  return (
    <Dialog
      open
      designNode="ztgRD"
      designWidth={560}
      designTop={140}
      designHeaderPadding="24px 24px 0"
      designContentPadding="4px 24px 0"
      designFooterPadding="10px 24px 24px"
      footerAlign="start"
      footerDivider={false}
      footerLeadFlexible={false}
      confirmIcon={<Check size={14} aria-hidden="true" />}
      title="左のメニューの並びを変える"
      titleHelp={<RowMenu label="並びを変える区分を選ぶ" open={groupMenuOpen} onOpenChange={setGroupMenuOpen} items={groups.map((item) => ({ id: item.id, label: item.label, onSelect: () => { setGroupId(item.id); setGroupMenuOpen(false) } }))} />}
      confirmLabel="この並びにする"
      footerLead={<Button variant="text" onClick={() => setDraft(initialOrder)}><RotateCcw size={14} aria-hidden="true" />元の並びに</Button>}
      onCancel={onCancel}
      onConfirm={() => onApply(draft)}
    >
      <p className={styles.orderDescription}>つまみで動かすか、矢印で1つずつ動かします。区分（メイン・配信…）の中で並べ替えます。</p>
      {group ? <>
        <p className={styles.orderGroupName}>{group.label}</p>
        <ReorderList items={group.items} visibleRows={5} onChange={(ids) => setDraft((current) => ({ ...current, [group.id]: ids }))} />
      </> : null}
    </Dialog>
  )
}

export default function FeatureSettingsScreen() {
  const settings = useFeatureSettings()
  const {
    selectedAccountId,
    features,
    savedFeatures,
    groups,
    dirty,
    loading,
    saving,
    error,
    loadFailed,
    reason,
    setReason,
    setError,
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

  /* 変えられるのはオーナー・管理者だけ（サーバの PUT と同じ境目）。役割が分かるまでは今までどおり出す。 */
  const staffRole = useStaffRole()
  const canManage = staffRole ? canManageRole(staffRole) : true

  const [query, setQuery] = useState('')
  const [compareOpen, setCompareOpen] = useState(false)
  const [reorderOpen, setReorderOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string> | null>(null)
  const conflicted = error === FEATURE_SETTINGS_CONFLICT_MESSAGE
  useEffect(() => { setCompareOpen(false); setReorderOpen(false) }, [selectedAccountId])

  /* 保存ボタンは「保存中 → ✓ 保存しました」でボタンの中だけ変わる。 */
  const [savedTick, setSavedTick] = useState(false)
  const wasSavingRef = useRef(false)
  useEffect(() => {
    if (saving) {
      wasSavingRef.current = true
      return
    }
    if (wasSavingRef.current && !dirty) setSavedTick(true)
    wasSavingRef.current = false
  }, [saving, dirty])
  useEffect(() => {
    if (dirty) setSavedTick(false)
  }, [dirty])

  const filteredGroups = useMemo(() => {
    const q = query.trim()
    if (!q) return settingsGroupLast(groups)
    return settingsGroupLast(groups)
      .map((group) => ({ ...group, items: group.items.filter((item) => item.label.includes(q) || item.note.includes(q)) }))
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

  const reasonRef = useRef<HTMLInputElement>(null)
  const reasonError = error === '変更理由を入力してください' ? error : ''
  const focusReason = () => {
    reasonRef.current?.focus()
    reasonRef.current?.scrollIntoView({ block: 'center' })
  }
  useEffect(() => { if (reasonError) focusReason() }, [reasonError])
  const validateReason = () => {
    if (reason.trim()) return true
    setError('変更理由を入力してください')
    focusReason()
    return false
  }

  const ready = Boolean(selectedAccountId) && !loading && !loadFailed

  /*
   * ★V8 `ziYCN`：ほかの人が先に保存した。題の下に帯を出し、編集中身は残す。
   * 保存は下の帯から押すので、そのままだと帯が画面の外に出る。帯が出たら板のいちばん上へ戻して見せる。
   */
  const conflictRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!conflicted) return
    const band = conflictRef.current
    if (!band) return
    const scrolled: HTMLElement[] = []
    for (let node = band.parentElement; node; node = node.parentElement) scrolled.push(node)
    band.closest<HTMLElement>('[data-page-template]')?.querySelectorAll<HTMLElement>('[data-template-region]').forEach((node) => scrolled.push(node))
    for (const node of scrolled) if (node.scrollTop > 0) node.scrollTo({ top: 0 })
  }, [conflicted])
  const conflictBand = conflicted ? (
    <div ref={conflictRef} className={styles.conflict} role="status" data-design-node="ziYCN">
      <TriangleAlert className={styles.conflictIcon} aria-hidden="true" />
      <div className={styles.conflictText}>
        <p className={styles.conflictTitle}>ほかの人が先に機能設定を保存しました</p>
        <p className={styles.conflictDesc}>あなたが直した所はまだ保存されていません。このまま保存すると、ほかの人の変更が消えます。</p>
      </div>
      <Button variant="secondary" onClick={() => setCompareOpen(true)}><GitCompare className={styles.btnIcon} aria-hidden="true" />違いを比べる</Button>
      <Button variant="primary" onClick={() => void load()}><RefreshCw className={styles.btnIcon} aria-hidden="true" />最新を読み込んで続ける</Button>
    </div>
  ) : null

  return (
    <SbSettingsScreen
      boardId="ywFJT"
      title={TITLE}
      help={DESCRIPTION}
      saveActions={ready && canManage ? (
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
            onClick={() => { if (!validateReason()) return; if (conflicted) setCompareOpen(true); else void save() }}
            disabled={saving || !dirty}
            busy={saving}
            done={savedTick}
            doneLabel="保存しました"
            title={!dirty ? '変更すると保存できます' : undefined}
          >
            {conflicted ? <GitCompare className={styles.btnIcon} aria-hidden="true" /> : <Save className={styles.btnIcon} aria-hidden="true" />}
            {conflicted ? '比べてから保存' : '機能設定を保存'}
          </Button>
        </>
      ) : undefined}
      saveStatus={ready && canManage ? (
        <span className={styles.barLead}>
          <Button variant="secondary" onClick={() => setResetToDefaultsOpen(true)} disabled={saving}>
            <RotateCcw className={styles.btnIcon} aria-hidden="true" />
            初期値に戻す
          </Button>
          {dirty ? <span className={styles.barStatus}>未保存の変更があります</span> : null}
        </span>
      ) : undefined}
    >
      {conflictBand}
      {!canManage && (
        <div className={styles.viewerBand} role="status">
          <Eye className={styles.bandIcon} aria-hidden="true" />
          <span>{VIEWER_NOTE}</span>
        </div>
      )}
      <Notice tone="info">公開中のページや動いている配信・予約は、それぞれの画面で止めてからオフにしてください。並び順は「並びを変える」から入れ替えます。</Notice>

      {!selectedAccountId ? (
        <p className={styles.stateBox}>先に上部でLINEアカウントを選んでください。</p>
      ) : loading ? (
        <div className={styles.stateBox} aria-busy="true" aria-label="機能設定を読み込んでいます">
          <DelayedSkeleton
            loading
            skeleton={(
              <div aria-hidden="true" className={styles.skeleton}>
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className={styles.skeletonRow}>
                    <span className={styles.skeletonGrow}><Skeleton height={14} width="45%" /></span>
                    <Skeleton height={20} width={36} />
                  </div>
                ))}
              </div>
            )}
          />
        </div>
      ) : loadFailed ? (
        <ListState
          kind="error"
          title={error || '設定を読み込めませんでした'}
          action={<Button type="button" variant="secondary" onClick={() => void load()}>もう一度試す</Button>}
        />
      ) : (
        <>
          <div aria-live="polite" className={styles.live}>
            {error && !conflicted && !reasonError && <Notice tone="danger" message={error} />}
          </div>

          <div className={styles.toolbar}>
            <SearchField aria-label="機能の名前で探す" placeholder="機能の名前で探す" value={query} onChange={setQuery} className={styles.search} />
            <span className={styles.spacer} />
            {canManage && (
              <Button variant="secondary" onClick={() => setReorderOpen(true)} disabled={saving}>
                <ArrowUpDown className={styles.btnIcon} aria-hidden="true" />
                並びを変える
              </Button>
            )}
          </div>

          {usageFailed && (
            <p className={styles.warnBand}>
              機能の利用状況を読めませんでした。設定の切替はそのまま使えます。{' '}
              <button type="button" onClick={() => void loadUsage()} className={styles.inlineLink}>利用状況を読み直す</button>
            </p>
          )}

          {filteredGroups.length === 0 ? (
            <ListState
              kind="empty"
              emptyPreset="filtered"
              title="条件に合うものはありません"
              description="札や検索を外すと、すべて出ます"
              action={<Button type="button" variant="secondary" onClick={() => setQuery('')}>条件を外す</Button>}
            />
          ) : (
            <div className={styles.cardCol} data-design="機能の一覧">
              {filteredGroups.map((group) => (
                <FeatureGroupCard
                  key={group.id}
                  group={group}
                  features={features}
                  usageByItemId={usageByItemId}
                  usageByFeatureId={usageByFeatureId}
                  usageRetry={() => void loadUsage()}
                  open={isOpen(group)}
                  canManage={canManage}
                  busy={saving}
                  onOpenChange={(next) => toggleOpen(group.id, next)}
                  onItemToggle={toggleItem}
                  onGroupToggle={toggleGroup}
                />
              ))}
            </div>
          )}

          {/* N-444：変更があるときだけ理由の欄を出す。 */}
          {canManage && dirty && (
            <Field label="変更理由（必須）" htmlFor="feature-settings-reason" error={reasonError || undefined} note="空のままでは保存できません。運用状態の更新履歴に残ります。">
              <TextField
                ref={reasonRef}
                id="feature-settings-reason"
                aria-required="true"
                value={reason}
                onChange={(event) => { setReason(event.target.value); if (reasonError) setError('') }}
                placeholder="例：マイルを使わないのでオフにする"
                maxLength={300}
                disabled={saving}
              />
            </Field>
          )}
        </>
      )}

      <ConfirmDialog
        open={compareOpen}
        title="最新の設定と編集中の違い"
        description="保存済みの値と編集中の値を確認してください。"
        confirmLabel="比べてから保存"
        busy={saving}
        onCancel={() => setCompareOpen(false)}
        onConfirm={() => { if (!validateReason()) { setCompareOpen(false); return }; setCompareOpen(false); void save() }}
      >
        <ul className={styles.compareList}>
          {Object.keys(features).filter((key) => features[key] !== savedFeatures[key]).map((key) => (
            <li key={key}>{featureLabelByKey.get(key) ?? '追加機能'}：保存済み {savedFeatures[key] ? 'オン' : 'オフ'} → 編集中 {features[key] ? 'オン' : 'オフ'}</li>
          ))}
        </ul>
        <p className={styles.compareNote}>並び順も、いま編集中の順番で保存します。</p>
      </ConfirmDialog>

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
        onCancel={() => { if (!saving) setResetToDefaultsOpen(false) }}
        onConfirm={resetToDefaults}
      />

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="この画面で変更した機能の表示・並び順"
        busy={saving}
        onCancel={() => { if (!saving) cancelLeave() }}
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
              <p className={styles.impactName}>{featureLabelByKey.get(group.feature) ?? group.feature}</p>
              <p className={styles.impactText}>{impactSummary(group)}</p>
            </div>
          ))}
        </div>
      </ConfirmDialog>
    </SbSettingsScreen>
  )
}
