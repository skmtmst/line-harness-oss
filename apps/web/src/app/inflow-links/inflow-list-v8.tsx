'use client'

/*
 * ★V8-B 流入と計測の一覧（Pencil「★V8-B 画面の地図」の行：
 * 一覧 `xbHxg`、状態 `URzvC`、1152 `y1ztx`、閲覧のみ `EMUl9`）。
 *
 * v7 の一覧（`page.tsx` 内の `InflowLinksPageInner`）とは別の見せ方。
 * データの口（取得・絞り込み・ページ送り）は `page.tsx` が持ち、
 * ここは置き場と見せ方だけを受け取って描く。v7 を直す必要が出たら
 * `page.tsx` 側も同じ判断を入れる（V8 完成までの二重管理）。
 *
 * - 数の帯は4マスの帯（KPI帯）。取れない数は「—」にする。
 * - 閲覧のみ（`EMUl9`）：帯を出し、作る・追加・チェック・編集は押せない形にする（隠さない）。
 * - 行末の操作は URL 系ボタン1つ＋「…」＋編集ボタン（板 `xbHxg` どおり）。
 * - API が足りない所は作らない（月別の内訳・ブロック数は今の集計のまま）。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  Folder,
  FolderPlus,
  Link2,
  Megaphone,
  MoreHorizontal,
  UserPlus,
} from 'lucide-react'
import { ApiError, api, type AdPlatform } from '@/lib/api'
import type { EntryRoute, EntryRouteGenre, Scenario, Tag, TrafficPool } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import { RowActions } from '@/components/shared/row-actions'
import { loadFailureCopy } from '@/components/shared/api-error-message'
import BulkRoutesDialog from './_components/bulk-routes-dialog'
import GenreModal from './_components/create-genre-modal'
import EditRouteModal from './_components/edit-route-modal'
import ReferralQrModal, { type ReferralQrRoute } from './referral-qr-modal'
import styles from './inflow-list-v8.module.css'

/** `page.tsx` の `Row` と同じ形。絞り込み・並び替え済みの行だけ受け取る。 */
export type InflowListV8Row = {
  source: 'entry_route' | 'tracked_link' | 'orphan'
  entryRouteId: string | null
  refCode: string
  genre: string | null
  name: string
  poolId: string | null
  tagId: string | null
  scenarioId: string | null
  runAccountFriendAddScenarios: boolean | null
  isActive: boolean | null
  stats:
    | {
        refCode: string
        name: string | null
        friendCount: number
        clickCount: number
        latestAt: string | null
      }
    | undefined
}

export type InflowListV8Filter = 'all' | 'has-friends' | 'no-friends' | 'unconfigured'
export type InflowListV8Sort = 'friends-desc' | 'clicks-desc' | 'latest-desc' | 'name'

interface MessageTemplateLike {
  id: string
  name: string
  messageType: string
  messageContent: string
}

export type InflowListV8Model = {
  accountId: string | null
  loading: boolean
  loadFailed: boolean
  loadError: unknown
  reload: () => void
  routeCountAvailable: boolean
  accountRouteCount: number
  activeRouteCount: number
  stoppedRouteCount: number
  genreNames: string[]
  totalFriends: number | null
  summaryAvailable: boolean
  unconfiguredCount: number
  hasFriendsCount: number
  sortedTotal: number
  uncategorizedId: string
  folders: Array<{ id: string; label: string; count: number; editable: boolean }>
  selectedGenre: string
  selectedGenreLabel: string
  onSelectGenre: (id: string) => void
  onAddFolder: () => void
  onEditFolder: (name: string) => void
  search: string
  onSearchChange: (value: string) => void
  filter: InflowListV8Filter
  onFilterChange: (filter: InflowListV8Filter) => void
  unconfiguredFilterCount: number
  sort: InflowListV8Sort
  onSortChange: (sort: InflowListV8Sort) => void
  page: number
  pageCount: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  rows: InflowListV8Row[]
  routes: EntryRoute[]
  pools: TrafficPool[]
  scenarios: Scenario[]
  tags: Tag[]
  templates: MessageTemplateLike[]
  poolMemberNames: Record<string, string[]>
  existingGenres: string[]
  selectedRouteIds: Set<string>
  selectableIds: string[]
  allShownSelected: boolean
  onToggleSelect: (id: string, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  onCopy: (refCode: string, id: string) => void
  copiedId: string | null
  copyFailedId: string | null
  editing: EntryRoute | 'new' | { register: string } | null
  onEditingChange: (editing: EntryRoute | 'new' | { register: string } | null) => void
  editingGenre: EntryRouteGenre | 'new' | null
  onEditingGenreChange: (genre: EntryRouteGenre | 'new' | null) => void
  qrRoute: ReferralQrRoute | null
  onQrRouteChange: (route: ReferralQrRoute | null) => void
  bulkOpen: boolean
  onBulkOpenChange: (open: boolean) => void
  selectedRoutes: EntryRoute[]
  onBulkApplied: (remainingIds: string[]) => void
  onGenreSaved: (genre: EntryRouteGenre, previousName: string | null) => void
  onRouteSaved: (savedRoute: EntryRoute, created: boolean) => void
  formatDate: (iso: string | null) => string
  normalizedSearch: string
}

const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'

function countText(value: number | null, unit: string) {
  return value === null ? '—' : `${formatNumber(value)}${unit}`
}

/** 板 `xbHxg` の「友だちになったら」欄。今の作りで分かる範囲だけ出す。 */
function afterAddLabel(
  row: InflowListV8Row,
  scenarioName: string | null,
  tagName: string | null,
): string {
  if (row.source !== 'entry_route') return '—'
  const parts: string[] = []
  if (scenarioName) parts.push(`シナリオ「${scenarioName}」`)
  if (tagName) parts.push(`タグ「${tagName}」`)
  if (parts.length === 0) return '何も付けない'
  return parts.join('・')
}

function RowMenu({
  row,
  canEdit,
  onEdit,
  onRegister,
  onQr,
  onCopy,
  onToggleActive,
  toggling,
}: {
  row: InflowListV8Row
  canEdit: boolean
  onEdit: () => void
  onRegister: () => void
  onQr: () => void
  onCopy: () => void
  onToggleActive: () => void
  toggling: boolean
}) {
  const stopped = row.isActive === false
  return (
    <RowActions
      edit={
        row.source === 'entry_route'
          ? {
              label: '編集する',
              disabled: !canEdit || toggling,
              onClick: onEdit,
            }
          : row.source === 'orphan'
            ? {
                label: '登録する',
                disabled: !canEdit || toggling,
                onClick: onRegister,
              }
            : undefined
      }
      menuItems={[
        ...(stopped
          ? []
          : [
              {
                id: 'qr',
                label: 'QRコードを表示',
                disabled: !canEdit,
                onSelect: onQr,
              } as const,
            ]),
        {
          id: 'copy',
          label: 'URLをコピー',
          onSelect: onCopy,
        } as const,
        ...(row.source === 'entry_route'
          ? [
              {
                id: 'toggle',
                label: stopped ? '再開する' : '止める',
                disabled: !canEdit || toggling,
                onSelect: onToggleActive,
              } as const,
            ]
          : []),
      ]}
      menuNote={canEdit ? undefined : READONLY_REASON}
      subjectName={row.name}
    />
  )
}

export default function InflowListV8({ model }: { model: InflowListV8Model }) {
  usePageTitle('流入と計測')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const role = useStaffRole()
  // `EMUl9` 閲覧のみ：押せない形にする（隠さない）。
  const canEdit = canManageRole(role)
  const { selectedAccountId } = useAccount()
  const [preset, setPreset] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState('')
  const [platforms, setPlatforms] = useState<AdPlatform[] | null>(null)

  // KPI 帯の4つ目（板 `xbHxg`「広告とつないだ」）。広告タブと同じ口で数える。
  useEffect(() => {
    let cancelled = false
    setPlatforms(null)
    void api.adPlatforms.list(selectedAccountId).then(
      (res) => {
        if (!cancelled && res.success) setPlatforms(res.data)
      },
      () => {
        if (!cancelled) setPlatforms(null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  const connectedPlatforms = platforms?.filter((platform) => platform.isActive) ?? null
  const loadFailure = model.loadError ? loadFailureCopy(model.loadError, '流入経路') : null

  const applyPreset = (value: string) => {
    setPreset(value)
    if (value === 'friends') {
      model.onFilterChange('has-friends')
      model.onSortChange('friends-desc')
    } else if (value === 'unconfigured') {
      model.onFilterChange('unconfigured')
    } else if (value === 'recent') {
      model.onFilterChange('all')
      model.onSortChange('latest-desc')
    } else {
      model.onFilterChange('all')
      model.onSortChange('friends-desc')
    }
  }

  const toggleActive = async (row: InflowListV8Row) => {
    if (!row.entryRouteId || togglingId) return
    setTogglingId(row.entryRouteId)
    setToggleError('')
    try {
      const res = await api.entryRoutes.update(row.entryRouteId, {
        isActive: row.isActive === false,
      })
      if (!res.success) {
        setToggleError('更新できませんでした')
      } else {
        model.reload()
      }
    } catch (cause) {
      setToggleError(
        cause instanceof ApiError && cause.status === 403
          ? 'この操作を行う権限がありません'
          : '通信できませんでした',
      )
    } finally {
      setTogglingId(null)
    }
  }

  const scenarioNameOf = (id: string | null) => model.scenarios.find((s) => s.id === id)?.name ?? null
  const tagNameOf = (id: string | null) => model.tags.find((t) => t.id === id)?.name ?? null
  const poolNameOf = (poolId: string | null) => {
    if (!poolId) return null
    return model.pools.find((p) => p.id === poolId)?.name ?? null
  }

  return (
    <div className={styles.board} data-design-node="xbHxg">
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>流入と計測</h1>
          <p className={styles.headDescription}>
            QRコード・URLごとに、どこから友だちになったかを数えます。友だちになったときに、タグ・メッセージ・シナリオを自動で動かせます。
          </p>
        </div>
        <div className={styles.headActions}>
          <Button variant="secondary" href="/inflow-links?tab=connections">
            広告とのつなぎ
          </Button>
          <Button variant="secondary" href="/inflow-links?tab=script">
            サイトスクリプト
          </Button>
        </div>
      </div>

      {!canEdit ? (
        <Notice
          tone="info"
          message="閲覧のみで見ています。変える操作は管理者に頼んでください。"
          className={styles.readonlyBand}
        />
      ) : null}

      <ul className={styles.kpis} aria-label="流入と計測の概要">
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>
            <Link2 size={13} aria-hidden="true" />
            経路
          </span>
          <p className={styles.kpiValue}>
            {model.routeCountAvailable ? (
              <>
                {formatNumber(model.accountRouteCount)}
                <span className={styles.kpiUnit}>件</span>
              </>
            ) : (
              '—'
            )}
          </p>
          <p className={styles.kpiDetail}>
            {model.routeCountAvailable
              ? (model.genreNames.slice(0, 4).join('・') || 'フォルダはまだありません')
              : model.loading
                ? '読み込んでいます'
                : '読み込めませんでした'}
          </p>
        </li>
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>
            <UserPlus size={13} aria-hidden="true" />
            今月の友だち追加
          </span>
          <p className={styles.kpiValue}>
            {model.summaryAvailable ? (
              <>
                {formatNumber(model.totalFriends ?? 0)}
                <span className={styles.kpiUnit}>人</span>
              </>
            ) : (
              '—'
            )}
          </p>
          <p className={styles.kpiDetail}>
            {model.summaryAvailable ? '累計' : model.loading ? '読み込んでいます' : '取得できません'}
          </p>
        </li>
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>
            <AlertCircle size={13} aria-hidden="true" />
            動きが未設定
          </span>
          <p className={styles.kpiValue}>
            {model.routeCountAvailable ? (
              <>
                {formatNumber(model.unconfiguredCount)}
                <span className={styles.kpiUnit}>件</span>
              </>
            ) : (
              '—'
            )}
          </p>
          <p className={styles.kpiDetail}>友だちになっても何も起きない</p>
        </li>
        <li className={styles.kpi}>
          <span className={styles.kpiLabel}>
            <Megaphone size={13} aria-hidden="true" />
            広告とつないだ
          </span>
          <p className={styles.kpiValue}>
            {connectedPlatforms ? (
              <>
                {formatNumber(connectedPlatforms.length)}
                <span className={styles.kpiUnit}>件</span>
              </>
            ) : (
              '—'
            )}
          </p>
          <p className={styles.kpiDetail}>
            {connectedPlatforms
              ? (connectedPlatforms.map((p) => p.displayName ?? p.name).join('・') || '—')
              : model.loading
                ? '読み込んでいます'
                : '取得できません'}
          </p>
        </li>
      </ul>

      <div className={styles.split}>
        <div className={styles.folderCol}>
          {canEdit ? (
            <Button variant="primary" href="/inflow-links/new" className={styles.createButton}>
              ＋ 流入リンクを作る
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled
              title={READONLY_REASON}
              className={styles.createButton}
            >
              ＋ 流入リンクを作る
            </Button>
          )}
          <h2 className={styles.folderTitle}>フォルダ</h2>
          <ul className={styles.folderList}>
            {model.folders.map((folder) => (
              <li key={folder.id} className={styles.folderRow}>
                <button
                  type="button"
                  className={`${styles.folderItem} ${model.selectedGenre === folder.id ? styles.folderItemActive : ''}`}
                  onClick={() => model.onSelectGenre(folder.id)}
                  aria-current={model.selectedGenre === folder.id ? true : undefined}
                >
                  <Folder size={14} aria-hidden="true" className={styles.folderItemIcon} />
                  <span className={styles.folderItemLabel}>{folder.label}</span>
                  <span className={styles.folderItemCount}>{formatNumber(folder.count)}</span>
                </button>
                {folder.editable && canEdit ? (
                  <button
                    type="button"
                    className={styles.folderEdit}
                    aria-label={`${folder.label}のフォルダを編集`}
                    title={`${folder.label}のフォルダを編集`}
                    onClick={() => model.onEditFolder(folder.label)}
                  >
                    <MoreHorizontal size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <button type="button" className={styles.folderAdd} onClick={model.onAddFolder}>
              <FolderPlus
                size={14}
                aria-hidden="true"
                style={{ verticalAlign: '-2px', marginRight: 4 }}
              />
              フォルダを追加
            </button>
          ) : null}
          <p className={styles.folderNote}>フォルダを消しても、中の経路は未分類に残ります</p>
        </div>

        <div className={styles.listCol}>
          {canEdit && model.unconfiguredCount > 0 ? (
            <Notice
              tone="info"
              message={`友だちになっても何も起きない経路が${formatNumber(model.unconfiguredCount)}件あります。「動きが未設定」で絞って、タグやメッセージを決めてください。`}
            />
          ) : null}
          {toggleError ? (
            <Notice tone="error" message={toggleError} />
          ) : null}

          <div className={styles.toolbar}>
            {canEdit ? (
              <Button variant="primary" href="/inflow-links/new" className={styles.toolbarCreate}>
                ＋ 流入リンクを作る
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                disabled
                title={READONLY_REASON}
                className={styles.toolbarCreate}
              >
                ＋ 流入リンクを作る
              </Button>
            )}
            <span className={styles.folderSelectWrap}>
              <Select
                aria-label="フォルダ"
                value={model.selectedGenre}
                onChange={model.onSelectGenre}
                options={model.folders.map((folder) => ({
                  value: folder.id,
                  label: `フォルダ：${folder.label}`,
                }))}
              />
            </span>
            <span className={styles.searchWrap}>
              <SearchField
                value={model.search}
                onChange={model.onSearchChange}
                placeholder="経路の名前・URLで探す"
                aria-label="経路の名前・URLで探す"
              />
            </span>
            <span className={styles.chipRow}>
              <FilterChip
                selected={model.filter === 'has-friends'}
                count={model.hasFriendsCount}
                onChange={(on) => model.onFilterChange(on ? 'has-friends' : 'all')}
              >
                友だち追加あり
              </FilterChip>
              <FilterChip
                selected={model.filter === 'unconfigured'}
                count={model.unconfiguredFilterCount}
                onChange={(on) => model.onFilterChange(on ? 'unconfigured' : 'all')}
              >
                動きが未設定
              </FilterChip>
            </span>
            {canEdit && model.selectedRouteIds.size > 0 ? (
              <Button variant="secondary" onClick={() => model.onBulkOpenChange(true)}>
                まとめて操作（{formatNumber(model.selectedRouteIds.size)}件選択中）
              </Button>
            ) : null}
            <span className={styles.toolbarSpacer} />
            <Select
              aria-label="よく使う絞り込み"
              value={preset}
              onChange={applyPreset}
              options={[
                { value: '', label: 'よく使う絞り込み' },
                { value: 'friends', label: '友だち追加が多い順' },
                { value: 'unconfigured', label: '動きが未設定だけ' },
                { value: 'recent', label: '最近追加された順' },
              ]}
            />
            <PageSizeSelect
              value={model.pageSize}
              options={[10, 20, 50]}
              onChange={model.onPageSizeChange}
            />
          </div>

          {model.loading ? (
            <ListState kind="loading" title="流入経路を読み込んでいます" />
          ) : model.loadFailed ? (
            <ListState
              kind="error"
              title={loadFailure?.title}
              description={loadFailure?.description}
              error={model.loadError ?? undefined}
              onRetry={loadFailure?.retryable ? model.reload : undefined}
            />
          ) : model.rows.length === 0 ? (
            model.normalizedSearch !== '' || model.filter !== 'all' ? (
              <ListState
                kind="empty"
                title="条件に合う流入経路がありません"
                description="検索や絞り込みの条件を変えてください。"
              />
            ) : (
              <ListState
                kind="empty"
                title={
                  model.selectedGenre
                    ? `「${model.selectedGenreLabel}」にはまだリンクがありません`
                    : 'まだ流入経路がありません'
                }
                description={
                  model.selectedGenre
                    ? '上の「＋ 流入リンクを作る」から作ると、ここに出ます。'
                    : '左側の「フォルダを追加」から最初のフォルダを作ってください。'
                }
              />
            )
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <colgroup>
                    <col style={{ width: 36 }} />
                    <col />
                    <col style={{ width: 88 }} />
                    <col style={{ width: 168 }} />
                    <col style={{ width: 96 }} />
                    <col style={{ width: 76 }} />
                    <col style={{ width: 108 }} />
                    <col style={{ width: 108 }} />
                    <col style={{ width: 168 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">
                        <Checkbox
                          aria-label="表示中の登録済み経路をすべて選ぶ"
                          checked={model.allShownSelected}
                          indeterminate={
                            !model.allShownSelected &&
                            model.selectableIds.some((id) => model.selectedRouteIds.has(id))
                          }
                          disabled={model.selectableIds.length === 0 || !canEdit}
                          title={
                            !canEdit
                              ? READONLY_REASON
                              : model.selectableIds.length === 0
                                ? 'まとめて操作できる登録済みの経路がありません'
                                : undefined
                          }
                          onCheckedChange={model.onSelectAll}
                        />
                      </th>
                      <th scope="col">流入元名</th>
                      <th scope="col">追加先</th>
                      <th scope="col">友だちになったら</th>
                      <th scope="col" className={styles.numeric}>
                        友だち追加
                      </th>
                      <th scope="col" className={styles.numeric}>
                        クリック
                      </th>
                      <th scope="col">最新追加</th>
                      <th scope="col">発行URL</th>
                      <th scope="col">
                        <span className="sr-only">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.rows.map((row) => {
                      const editTarget =
                        row.source === 'entry_route'
                          ? (model.routes.find((e) => e.id === row.entryRouteId) ?? null)
                          : null
                      const stopped = row.isActive === false
                      const poolName = poolNameOf(row.poolId)
                      return (
                        <tr key={row.refCode}>
                          <td>
                            {row.entryRouteId ? (
                              <Checkbox
                                aria-label={`${row.name}をまとめて操作の対象にする`}
                                checked={model.selectedRouteIds.has(row.entryRouteId)}
                                disabled={!canEdit}
                                title={!canEdit ? READONLY_REASON : undefined}
                                onCheckedChange={(checked) =>
                                  model.onToggleSelect(row.entryRouteId!, checked)
                                }
                              />
                            ) : (
                              <span className="sr-only">
                                まとめて操作は登録済みの流入経路だけに使えます
                              </span>
                            )}
                          </td>
                          <td>
                            {row.source === 'entry_route' && row.entryRouteId ? (
                              <Link
                                href={`/inflow-links/detail?id=${row.entryRouteId}`}
                                className={styles.cellName}
                                title={row.name}
                              >
                                {row.name}
                              </Link>
                            ) : (
                              <span className={styles.cellNamePlain} title={row.name}>
                                {row.name}
                              </span>
                            )}
                            <span className={styles.cellSub} title={row.refCode}>
                              {row.refCode}
                            </span>
                            {stopped ? (
                              <span className={`${styles.statePill} ${styles.statePillStopped}`}>
                                <span className={styles.statePillDot} aria-hidden="true" />
                                停止中
                              </span>
                            ) : row.source === 'orphan' ? (
                              <span
                                className={`${styles.statePill} ${styles.statePillOrphan}`}
                                title="外部で発行されたREFです。流入実績だけを集計しています。"
                              >
                                <span className={styles.statePillDot} aria-hidden="true" />
                                未登録
                              </span>
                            ) : (
                              <span className={`${styles.statePill} ${styles.statePillActive}`}>
                                <span className={styles.statePillDot} aria-hidden="true" />
                                計測済
                              </span>
                            )}
                          </td>
                          <td>
                            <span
                              className={`${styles.cellEllipsis} ${poolName ? '' : styles.cellMuted}`}
                              title={poolName ?? '追加先が設定されていません。'}
                            >
                              {poolName ?? (row.source === 'tracked_link' ? '—' : '未設定')}
                            </span>
                          </td>
                          <td>
                            <span
                              className={styles.cellEllipsis}
                              title={afterAddLabel(
                                row,
                                scenarioNameOf(row.scenarioId),
                                tagNameOf(row.tagId),
                              )}
                            >
                              {afterAddLabel(
                                row,
                                scenarioNameOf(row.scenarioId),
                                tagNameOf(row.tagId),
                              )}
                            </span>
                          </td>
                          <td className={styles.numeric}>
                            <span className={styles.cellValue}>
                              {model.summaryAvailable
                                ? countText(row.stats?.friendCount ?? 0, '人')
                                : '—'}
                            </span>
                          </td>
                          <td className={styles.numeric}>
                            <span className={styles.cellValue}>
                              {model.summaryAvailable
                                ? (row.stats?.clickCount == null
                                    ? '—'
                                    : formatNumber(row.stats.clickCount))
                                : '—'}
                            </span>
                          </td>
                          <td>
                            <span className={`${styles.cellEllipsis} ${styles.cellMuted}`}>
                              {model.summaryAvailable
                                ? model.formatDate(row.stats?.latestAt ?? null)
                                : '—'}
                            </span>
                          </td>
                          <td>
                            {stopped ? (
                              <span className={`${styles.urlButton} ${styles.urlButtonStopped}`}>
                                停止中
                              </span>
                            ) : (
                              <button
                                type="button"
                                className={styles.urlButton}
                                onClick={() => model.onCopy(row.refCode, row.refCode)}
                                aria-label={`${row.name}のURLをコピー`}
                                title={
                                  model.copyFailedId === row.refCode
                                    ? 'コピーに失敗しました。もう一度押してください'
                                    : undefined
                                }
                              >
                                {model.copyFailedId === row.refCode
                                  ? 'コピー失敗'
                                  : model.copiedId === row.refCode
                                    ? '済み'
                                    : 'コピー'}
                              </button>
                            )}
                          </td>
                          <td>
                            <div className={styles.rowActions}>
                              {editTarget ? (
                                <Button
                                  variant="secondary"
                                  disabled={!canEdit}
                                  title={!canEdit ? READONLY_REASON : undefined}
                                  onClick={() => model.onEditingChange(editTarget)}
                                  aria-label={`${row.name}のリンクを編集`}
                                >
                                  編集
                                </Button>
                              ) : row.source === 'orphan' ? (
                                <Button
                                  variant="secondary"
                                  disabled={!canEdit}
                                  title={
                                    !canEdit
                                      ? READONLY_REASON
                                      : '未登録 ref を entry_routes に登録します。流入実績はそのまま引き継がれます。'
                                  }
                                  onClick={() =>
                                    model.onEditingChange({ register: row.refCode })
                                  }
                                  aria-label={`${row.name}を登録する`}
                                >
                                  登録する
                                </Button>
                              ) : (
                                <span className={styles.cellMuted}>—</span>
                              )}
                              <RowMenu
                                row={row}
                                canEdit={canEdit}
                                onEdit={() => {
                                  if (editTarget) model.onEditingChange(editTarget)
                                }}
                                onRegister={() =>
                                  model.onEditingChange({ register: row.refCode })
                                }
                                onQr={() =>
                                  model.onQrRouteChange({
                                    refCode: row.refCode,
                                    name: row.name,
                                    genre: row.genre,
                                    isActive: row.isActive,
                                    id: row.entryRouteId ?? undefined,
                                  })
                                }
                                onCopy={() => model.onCopy(row.refCode, row.refCode)}
                                onToggleActive={() => void toggleActive(row)}
                                toggling={togglingId === row.entryRouteId}
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className={styles.tableNote}>
                行の「…」から QRコードを表示・URLをコピー・リンクを編集・止める・フォルダへ移す。左のチェックで、まとめて操作できます。
              </p>
              <div className={styles.pagerRow}>
                <span className={styles.pagerCount}>全 {formatNumber(model.sortedTotal)} 件</span>
                <Pagination
                  page={model.page}
                  pageCount={model.pageCount}
                  onPageChange={model.onPageChange}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {model.editing ? (
        <EditRouteModal
          route={
            model.editing === 'new' ||
            (typeof model.editing === 'object' && 'register' in model.editing)
              ? null
              : model.editing
          }
          initialRefCode={
            typeof model.editing === 'object' &&
            model.editing !== null &&
            'register' in model.editing
              ? model.editing.register
              : undefined
          }
          initialGenre={
            model.editing === 'new' && model.selectedGenre !== model.uncategorizedId
              ? model.selectedGenre
              : undefined
          }
          pools={model.pools}
          scenarios={model.scenarios}
          templates={model.templates}
          tags={model.tags}
          existingGenres={model.existingGenres}
          poolMemberNames={model.poolMemberNames}
          accountId={model.accountId}
          onClose={() => model.onEditingChange(null)}
          onSaved={model.onRouteSaved}
        />
      ) : null}
      {model.editingGenre ? (
        <GenreModal
          genre={model.editingGenre === 'new' ? null : model.editingGenre}
          onClose={() => model.onEditingGenreChange(null)}
          onSaved={model.onGenreSaved}
        />
      ) : null}
      {model.qrRoute ? (
        <ReferralQrModal route={model.qrRoute} onClose={() => model.onQrRouteChange(null)} />
      ) : null}
      {model.bulkOpen ? (
        <BulkRoutesDialog
          targets={model.selectedRoutes}
          genreOptions={model.existingGenres}
          onApplied={model.onBulkApplied}
          onClose={() => model.onBulkOpenChange(false)}
        />
      ) : null}
    </div>
  )
}
