'use client'

/* ① メニュー（owaS3）（settings-v8.tsx から分割。見た目・動きは変えない） */

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import { notifyToast } from '@/components/shared/toast'
import { DelayedSkeleton } from '@/components/shared/skeleton'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Pagination from '@/components/shared/pagination'
import { DragHandle, MoreAction } from '@/components/shared/row-actions'
import SearchField from '@/components/shared/search-field'
import ListRange from '@/components/ui/list-range'
import { bookingApi, type BookingMenu } from '@/lib/api'
import { menuPriceLabel } from '../lib/menu-price'
import { bookingErrorMessage } from '../lib/menu-validation'
import MenuVersionHistory from '../menu-version-history'
import {
  AccountIcon,
  Band,
  MENU_PAGE_SIZE,
  StateCard,
  SkeletonRows,
  sortedMenus,
  type LoadStatus,
} from './shared'
import styles from '../settings.module.css'

export function MenusTabV8({ accountId, menus, status, error, menuCount, canEdit, onReload }: {
  accountId: string
  menus: BookingMenu[]
  status: LoadStatus
  error: string | null
  menuCount: number | undefined
  canEdit: boolean
  onReload: () => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [historyTarget, setHistoryTarget] = useState<BookingMenu | null>(null)
  const [visibilityError, setVisibilityError] = useState<string | null>(null)
  const [updatingVisibility, setUpdatingVisibility] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [reorderBusy, setReorderBusy] = useState(false)
  const [reorderError, setReorderError] = useState<string | null>(null)
  /* 先に画面を変える分（公開・並び）。裏の保存が終わるまでここが勝つ。 */
  const [visOverride, setVisOverride] = useState<Record<string, boolean>>({})
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)
  const menusRef = useRef(menus)
  menusRef.current = menus

  const orderedBase = useMemo(() => {
    const sorted = sortedMenus(menus)
    if (!orderOverride || orderOverride.length !== sorted.length) return sorted
    const byId = new Map(sorted.map((menu) => [menu.id, menu]))
    const applied = orderOverride.map((id) => byId.get(id)).filter((menu): menu is BookingMenu => Boolean(menu))
    return applied.length === sorted.length ? applied : sorted
  }, [menus, orderOverride])

  const shown = useMemo(() => {
    const keyword = query.trim()
    return keyword
      ? orderedBase.filter((menu) => menu.name.toLowerCase().includes(keyword.toLowerCase()))
      : orderedBase
  }, [orderedBase, query])
  const pageCount = Math.max(1, Math.ceil(shown.length / MENU_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const visible = shown.slice((safePage - 1) * MENU_PAGE_SIZE, safePage * MENU_PAGE_SIZE)

  /* 中身の直しはメニュー作成ページ（?menu=<id>、node QqER7）に集約する。 */
  function openMenuForm(menu: BookingMenu) {
    router.push(`/booking/menus/new?menu=${menu.id}`)
  }

  /* 「…」の上へ・下へ。先に並びを変えて裏で保存する。 */
  async function moveMenu(menu: BookingMenu, delta: -1 | 1) {
    if (reorderBusy) return
    const ordered = orderedBase
    const index = ordered.findIndex((item) => item.id === menu.id)
    const nextIndex = index + delta
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return
    const other = ordered[nextIndex]
    const version = menu.version
    const otherVersion = other.version
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1
      || typeof otherVersion !== 'number' || !Number.isInteger(otherVersion) || otherVersion < 1) {
      onReload()
      setReorderError('最新の状態を読み直しました。もう一度お試しください。')
      return
    }
    const nextIds = ordered.map((item) => item.id)
    const moved = nextIds[index]
    nextIds[index] = nextIds[nextIndex]
    nextIds[nextIndex] = moved
    setOrderOverride(nextIds)
    setReorderBusy(true)
    setReorderError(null)
    try {
      await bookingApi.updateMenu(accountId, menu.id, version, { ...menu, sort_order: other.sort_order })
      await bookingApi.updateMenu(accountId, other.id, otherVersion, { ...other, sort_order: menu.sort_order })
      setOrderOverride(null)
      onReload()
      notifyToast(`「${menu.name}」を${delta < 0 ? '上' : '下'}へ移しました。`, {
        actionLabel: '元に戻す',
        onAction: () => {
          const latest = menusRef.current.find((item) => item.id === menu.id) ?? menu
          void moveMenu(latest, delta < 0 ? 1 : -1)
        },
      })
    } catch (cause) {
      setOrderOverride(null)
      onReload()
      notifyToast(bookingErrorMessage(cause, '保存'), {
        actionLabel: 'もう一度',
        onAction: () => {
          const latest = menusRef.current.find((item) => item.id === menu.id) ?? menu
          void moveMenu(latest, delta)
        },
      })
    } finally {
      setReorderBusy(false)
    }
  }

  /* 公開・止める。先に札を変えて裏で保存する。 */
  async function toggleVisibility(menu: BookingMenu, force?: boolean) {
    if (updatingVisibility) return
    const next = force ?? !(visOverride[menu.id] ?? menu.is_active)
    setVisOverride((current) => ({ ...current, [menu.id]: next }))
    setUpdatingVisibility(true)
    setVisibilityError(null)
    try {
      const version = menu.version
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        throw new Error('booking_menu_version_missing')
      }
      await bookingApi.patchMenu(accountId, menu.id, version, { is_active: next })
      setVisOverride((current) => {
        const copy = { ...current }
        delete copy[menu.id]
        return copy
      })
      onReload()
      notifyToast(next ? `「${menu.name}」をお客さまの画面へ出しました。` : `「${menu.name}」の新しい予約を止めました。`, {
        actionLabel: '元に戻す',
        onAction: () => {
          const latest = menusRef.current.find((item) => item.id === menu.id) ?? menu
          void toggleVisibility(latest, !next)
        },
      })
    } catch (cause) {
      setVisOverride((current) => {
        const copy = { ...current }
        delete copy[menu.id]
        return copy
      })
      onReload()
      if (cause instanceof Error && cause.message === 'booking_menu_version_missing') {
        setVisibilityError('最新の状態を読み直しました。もう一度お試しください。')
      } else {
        notifyToast(bookingErrorMessage(cause, '保存'), {
          actionLabel: 'もう一度',
          onAction: () => {
            const latest = menusRef.current.find((item) => item.id === menu.id) ?? menu
            void toggleVisibility(latest, next)
          },
        })
      }
    } finally {
      setUpdatingVisibility(false)
    }
  }

  if (status === 'loading') {
    return (
      <div aria-busy="true">
        <DelayedSkeleton loading skeleton={<SkeletonRows rows={5} />} />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <StateCard
        icon={<AccountIcon />}
        title="予約設定を読み込めませんでした"
        description={error ?? '通信状態を確認して、もう一度お試しください。'}
        action={<Button onClick={onReload}>もう一度試す</Button>}
      />
    )
  }

  const activeCount = menus.filter((menu) => menu.is_active).length

  return (
    <div className={styles.tabStack} data-design="Table">
      <Band tone="hint">上から並んだ順に、お客さまの画面に出ます。つまみで並べ替えます。</Band>

      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <SearchField
            aria-label="メニュー名で探す"
            placeholder="メニュー名で探す"
            value={query}
            onChange={(value) => { setQuery(value); setPage(1) }}
          />
        </div>
        <span className={styles.toolbarSpacer} />
        {canEdit ? (
          <Button variant="primary" href="/booking/menus/new">{<><Plus size={15} aria-hidden="true" />予約メニューを作る</>}</Button>
        ) : (
          /* 閲覧のみ：作るボタンは置かず、場所だけ空ける（下の段の位置を変えない）。 */
          <span className={styles.createSlot} aria-hidden="true" />
        )}
      </div>

      {reorderError ? <p className="text-danger mt-2 text-xs" role="alert">{reorderError}</p> : null}
      {visibilityError ? <p className="text-danger mt-2 text-xs" role="alert">{visibilityError}</p> : null}

      {menus.length === 0 ? (
        <StateCard
          icon={<AccountIcon />}
          title="まだ予約メニューはありません"
          description="メニューと担当スタッフ・開ける時間を決めると、お客さまがLINEから予約できます。"
          action={canEdit ? <Button variant="primary" href="/booking/menus/new">予約メニューを作る</Button> : undefined}
        />
      ) : shown.length === 0 ? (
        <StateCard
          icon={<AccountIcon />}
          title="条件に合うメニューはありません"
          description="検索を外すと、すべて出ます"
          action={<Button onClick={() => { setQuery(''); setPage(1) }}>条件を外す</Button>}
        />
      ) : (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>メニュー</h2>
            <span className={styles.sectionDesc}>
              {menuCount ?? menus.length}件・出しているもの {activeCount}
            </span>
          </div>
          <div className={styles.tableHead} role="row" aria-hidden="true">
            <span className={styles.colOrder} />
            <span className={styles.colName}>メニュー</span>
            <span className={styles.colTime}>時間</span>
            <span className={styles.colPrice}>金額</span>
            <span className={styles.colStaff}>担当</span>
            <span className={styles.colCount}>30日</span>
            <span className={styles.colStatus}>状態</span>
            <span className={styles.colMenu} />
          </div>
          {visible.map((menu) => {
            const orderIndex = shown.findIndex((item) => item.id === menu.id)
            const canMoveUp = orderIndex > 0
            const canMoveDown = orderIndex >= 0 && orderIndex < shown.length - 1
            const staffNames = (menu.assigned_staff ?? []).map((person) => person.display_name)
            const menuItems: ActionMenuItem[] = [
              { id: 'history', label: '版の履歴', onSelect: () => setHistoryTarget(menu) },
              ...(canEdit ? [
                {
                  id: 'move-up',
                  label: '上へ',
                  disabled: reorderBusy || !canMoveUp,
                  disabledReason: !canMoveUp ? 'いちばん上です' : '並び替えを保存中です',
                  onSelect: () => void moveMenu(menu, -1),
                },
                {
                  id: 'move-down',
                  label: '下へ',
                  disabled: reorderBusy || !canMoveDown,
                  disabledReason: !canMoveDown ? 'いちばん下です' : '並び替えを保存中です',
                  onSelect: () => void moveMenu(menu, 1),
                },
                {
                  id: 'visibility',
                  label: (visOverride[menu.id] ?? menu.is_active) ? '止める' : '出す',
                  dividerBefore: true,
                  onSelect: () => void toggleVisibility(menu),
                },
              ] satisfies ActionMenuItem[] : []),
            ]
            return (
              <div key={menu.id} className={styles.menuRow}>
                <span className={styles.colOrder}>
                  {canEdit ? <DragHandle
                    label={`「${menu.name}」を並び替える（↑↓キー）`}
                    disabled={reorderBusy}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' && canMoveUp) { event.preventDefault(); void moveMenu(menu, -1) }
                      if (event.key === 'ArrowDown' && canMoveDown) { event.preventDefault(); void moveMenu(menu, 1) }
                    }}
                    className={styles.grip}
                  /> : <span className={styles.gripSlot} aria-hidden="true" />}
                  <span className={styles.orderNum}>{orderIndex + 1}</span>
                </span>
                <span className={styles.colName}>
                  <span className={styles.nameLine}>
                    <button
                      type="button"
                      className={styles.menuName}
                      onClick={() => openMenuForm(menu)}
                    >
                      {menu.name}
                    </button>
                    {menu.category_label ? <span className={styles.tagChip}>{menu.category_label}</span> : null}
                  </span>
                  {menu.description ? <span className={styles.menuDesc}>{menu.description}</span> : null}
                </span>
                <span className={styles.colTime}>
                  <span className={styles.cellNum}>{menu.duration_minutes}分</span>
                </span>
                <span className={styles.colPrice}>
                  <span className={styles.cellNum}>{menuPriceLabel(menu)}</span>
                </span>
                <span className={styles.colStaff}>
                  {staffNames.length === 0 ? (
                    <span className={styles.cellWarn}>担当なし</span>
                  ) : (
                    <span className={styles.cellText}>{staffNames.join('・')}</span>
                  )}
                </span>
                <span className={styles.colCount}>
                  <span className={styles.cellNum}>{menu.booking_count_30_days ?? 0}件</span>
                </span>
                <span className={styles.colStatus}>
                  <span className={`${styles.statePill} ${(visOverride[menu.id] ?? menu.is_active) ? styles.statePillOn : styles.statePillOff}`}>
                    <span className={styles.stateDot} aria-hidden="true" />
                    {(visOverride[menu.id] ?? menu.is_active) ? '公開中' : '止めている'}
                  </span>
                </span>
                <span className={styles.colMenu}>
                  <MoreAction
                    label={`「${menu.name}」のそのほかの操作`}
                    aria-expanded={openMenuId === menu.id}
                    onClick={() => setOpenMenuId((current) => (current === menu.id ? null : menu.id))}
                    className={styles.rowMenuButton}
                  />
                  <ActionMenu
                    open={openMenuId === menu.id}
                    inline
                    ariaLabel={`「${menu.name}」の操作`}
                    onClose={() => setOpenMenuId(null)}
                    items={[
                      { id: 'edit', label: '中身を編集', onSelect: () => openMenuForm(menu) },
                      ...menuItems,
                    ]}
                  />
                </span>
              </div>
            )
          })}
          <div className="mt-3 flex items-center justify-between gap-3">
            <ListRange
              label="メニュー"
              total={shown.length}
              first={visible.length === 0 ? 0 : (safePage - 1) * MENU_PAGE_SIZE + 1}
              last={(safePage - 1) * MENU_PAGE_SIZE + visible.length}
            />
            <Pagination page={safePage} pageCount={pageCount} onPageChange={setPage} ariaLabel="予約メニューのページ送り" />
          </div>
        </section>
      )}

      {historyTarget ? (
        <MenuVersionHistory
          menuId={historyTarget.id}
          menuName={historyTarget.name}
          currentVersion={historyTarget.version ?? 1}
          accountId={accountId}
          canRevert={canEdit}
          onReverted={(version) => {
            setHistoryTarget((current) => current && current.id === historyTarget.id ? { ...current, version } : current)
            onReload()
          }}
          onClose={() => setHistoryTarget(null)}
        />
      ) : null}

    </div>
  )
}
