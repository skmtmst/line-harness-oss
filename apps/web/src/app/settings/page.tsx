'use client'

import Link from 'next/link'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import Notice from '@/components/shared/notice'
import PageHeader from '@/components/shared/page-header'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import { RequiredBadge } from '@/components/shared/form-controls'
import { useAdminTheme } from '@/lib/use-admin-theme'
import {
  itemIsEnabled,
  groupEnabledCount,
  groupFeatureCount,
  type FeatureGroup,
  type FeatureItem,
} from '@/lib/feature-settings'
import ThemePreviewSwitch from '@/components/theme-preview-switch'
import { formatNumber } from '@/lib/format'
import { FeatureSettingsV8 } from './feature-settings-v8'
import {
  groupSummary,
  shortUsageDate,
  useFeatureSettings,
  type FeatureUsage,
  type UsageCategory,
} from './use-feature-settings'

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
      title={`${category.label}：作成 ${formatNumber(created)}、利用中 ${formatNumber(inUse)}`}
    >
      利用中 {formatNumber(inUse)} / 作成 {formatNumber(created)}
    </span>
  )
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
  const count = formatNumber(activity.value)
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
    <li className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2">
      <div className="flex min-w-0 items-start gap-2.5">
        {ordering && <span className="mt-0.5"><GripIcon /></span>}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* 監査 R66: 並び替え中は上下ボタンが増えて行幅が伸びる。狭い幅ではラベルを省略し、操作を下へ回す。 */}
            <p className="truncate text-sm font-bold text-ink" title={item.label}>{item.label}</p>
            {sharedSwitch && (
              <span className="rounded-pill border-hairline whitespace-nowrap border px-1.5 py-0.5 text-micro font-medium text-ink-faint">
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
    <section className="border-hairline overflow-hidden rounded-card border bg-canvas">
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
      <div className="border-hairline bg-canvas overflow-hidden rounded-card border">
        <div className="max-h-[calc(100vh-8rem)] space-y-4 overflow-y-auto px-6 pb-3 pt-6">
          {groups.map((group) => (
            <div key={group.id}>
              <p className="mb-2 text-xs font-medium text-ink-faint">{group.label}</p>
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
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-pill ${enabled ? 'bg-accent' : 'bg-canvas-sunken'}`} />
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

function SettingsPageV7() {
  const {
    selectedAccountId,
    features,
    groups,
    dirty,
    ordering,
    setOrdering,
    loading,
    saving,
    error,
    loadFailed,
    reason,
    setReason,
    impactOpen,
    setImpactOpen,
    impactGroups,
    impactBusy,
    impactError,
    setImpactError,
    resetToDefaultsOpen,
    setResetToDefaultsOpen,
    usageByItemId,
    usageByFeatureId,
    usageFailed,
    groupColumns,
    leaveTarget,
    confirmLeave,
    cancelLeave,
    setSavedFeatures,
    setSavedItemOrder,
    currentOrder,
    load,
    loadUsage,
    toggleItem,
    toggleGroup,
    moveItem,
    discardChanges,
    resetToDefaults,
    featureLabelByKey,
    save,
    confirmImpactSave,
    impactSummary,
  } = useFeatureSettings()

  return (
    <div className="flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      {/*
        U034: 390px・768pxでは右の操作（並び替え・保存など）が見出しを
        押しつぶし、題が1文字ずつ縦に割れていた。共通の PageHeader の形は
        変えず、この画面の見出し帯だけ「収まらないとき操作を次の行へ
        下げる」にする。収まる幅では1行のままで見た目は変わらない。
      */}
      <div data-page-header-wrap>
      <PageHeader
        breadcrumb={[{ label: '設定' }, { label: '機能設定' }]}
        title="機能設定"
        description=""
        actions={(
          <>
          <Button
            variant="secondary"
            onClick={() => setOrdering((current) => !current)}
            disabled={loading || saving || loadFailed}
          >
            {ordering ? '並び替えを閉じる' : '並びを変える'}
          </Button>
          <Button
            variant="secondary"
            onClick={discardChanges}
            disabled={loading || saving || loadFailed || !dirty}
            title={!dirty && !loading ? '変更すると取り消せます' : undefined}
          >
            キャンセル
          </Button>
          <Button
            variant="secondary"
            onClick={() => setResetToDefaultsOpen(true)}
            disabled={loading || saving || loadFailed}
          >
            初期値に戻す
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={loading || saving || loadFailed || !dirty}
            title={!dirty && !loading ? '変更すると保存できます' : undefined} busy={saving}>
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path d="m4 10 3.5 3.5L16 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>機能設定を保存する
          </Button>
          {!loading && !loadFailed && !dirty && <span className="self-center text-xs text-ink-faint">変更すると保存できます</span>}
          </>
        )}
      />
      <style>{`
        [data-page-header-wrap] > div { flex-wrap: wrap; }
        [data-page-header-wrap] > div > div + div { flex-wrap: wrap; max-width: 100%; margin-left: auto; }
      `}</style>
      </div>

      <Notice tone="info" className="mb-4">
        使わない機能をオフにすると、サイドメニューから消えます。オフにしても作ったデータは削除されません。公開中のページや動いている配信・予約は、それぞれの画面で止めてからオフにしてください。並び順はここでは変えません。「並びを変える」から入れ替えてください。
      </Notice>

      {!selectedAccountId ? (
        <p className="border-hairline bg-canvas text-ink-faint rounded-card border p-8 text-center text-sm">
          先に上部でLINEアカウントを選んでください。
        </p>
      ) : (
        <>
          <div aria-live="polite">
            {error && !loadFailed && <Notice tone="danger" message={error} className="mb-4" />}
          </div>

          {dirty && !loadFailed && (
            <div className="border-hairline bg-canvas rounded-card flex flex-col gap-2 border p-4 sm:flex-row sm:items-center">
              <label htmlFor="feature-settings-reason" className="text-ink shrink-0 text-sm font-medium">
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
          ) : loadFailed ? (
            /*
             * 監査 D019: 読み込みに失敗したら初期値のスイッチ一覧を本物の
             * 設定のように出さない。理由と再読み込みだけを出す。
             * 403 は権限の理由のまま（再試行の口も残す）。
             */
            <ListState
              kind="error"
              title={error || '機能設定を読み込めませんでした'}
              onRetry={() => void load()}
            />
          ) : (
            <>
            <div className={ordering ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]' : 'grid gap-4'}>
              {/*
                利用状況の取得自体に失敗したとき。バッジは付かないので、
                無表示のままにせず一覧の先頭で理由とやり直しを出す。
                設定の切替はこの間も触れるままにする。
              */}
              {usageFailed && (
                <div className="border-hairline bg-canvas-sunken text-ink-faint flex items-center gap-2 rounded-card border px-4 py-2 text-xs">
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
              {/*
                監査707: 390pxでは3列ぶんの幅が容器を超え、右側のスイッチ・
                「まとめて切替」が域外に出ていた。基底をgrid-cols-1
                （minmax(0,1fr)で縮小可能）にし、列のdivにもmin-w-0を
                付けて狭幅で1列へ落とす。xl以上は3列のまま。
              */}
              <div
                data-design="機能の一覧"
                className={ordering ? 'min-w-0 space-y-4' : 'grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-3'}
              >
                {(ordering ? [groups] : groupColumns).map((column, columnIndex) => (
                  <div key={columnIndex} className="min-w-0 space-y-3">
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
                <Link href="/settings/manual-links" className="text-action mt-3 inline-block text-sm font-bold">
                  マニュアルの正本表
                </Link>
              </div>}
            </div>

            {/*
              ★V8 移行②: 新しい見た目を担当者が試すための切り替え。
              設定画面のいちばん下に1つだけ置く（このブラウザだけに効く）。
              読み込み中・読み込み失敗の画面には出さない（偽の操作を置かない決まり）。
            */}
            <ThemePreviewSwitch />
            </>
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

      <UnsavedLeaveDialog
        open={leaveTarget !== null}
        subject="この画面で変更した機能の表示・並び順"
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

export default function SettingsPage() {
  const theme = useAdminTheme()
  if (theme === 'v8') return <FeatureSettingsV8 />
  return <SettingsPageV7 />
}
