'use client'

/* ① メニュー（owaS3）（settings-v8.tsx から分割。見た目・動きは変えない） */

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import { notifyToast } from '@/components/shared/toast'
import { DelayedSkeleton } from '@/components/shared/skeleton'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Pagination from '@/components/shared/pagination'
import { MoreAction } from '@/components/shared/row-actions'
import ReorderHandle, { useReorder } from '@/components/shared/reorder-handle'
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
  const reorderBusyRef = useRef(false)

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

  /* 中身の直しはメニュー作成ページ（?menu=<id>、node QqER7）に集約する。 */
  function openMenuForm(menu: BookingMenu) {
    router.push(`/booking/menus/new?menu=${menu.id}`)
  }

  /*
   * 並び替え（共通の並び替え）。つまみのドラッグ・上下キー・「…」の上へ／下へは
   * どれも persistOrder を通る。先に並びを変えて裏で保存する。
   * 保存は今の API のまま（メニューごとの sort_order の書き換え）。動いた範囲の
   * メニューに、その位置にあった sort_order を振り直す。途中で失敗したら、
   * 書き換えた分を元の sort_order へ戻し、元の位置で理由を出す。
   */
  async function persistOrder(movedId: string, nextIds: string[], undoable = true) {
    if (reorderBusyRef.current) return
    /* 知らせから押し直すときも、読み直した最新の版で計算する。 */
    const ordered = sortedMenus(menusRef.current)
    const byId = new Map(ordered.map((item) => [item.id, item]))
    const moved = byId.get(movedId)
    const changes = ordered
      .map((item, index) => ({ menu: byId.get(nextIds[index]), sortOrder: item.sort_order }))
      .filter((entry): entry is { menu: BookingMenu; sortOrder: number } => Boolean(entry.menu) && entry.menu!.sort_order !== entry.sortOrder)
    if (!moved || nextIds.length !== ordered.length || changes.length === 0) return
    if (changes.some(({ menu }) => typeof menu.version !== 'number' || !Number.isInteger(menu.version) || menu.version < 1)) {
      onReload()
      setReorderError('最新の状態を読み直しました。もう一度お試しください。')
      return
    }
    const fromIndex = ordered.findIndex((item) => item.id === movedId)
    const toIndex = nextIds.indexOf(movedId)
    const previousIds = ordered.map((item) => item.id)
    setOrderOverride(nextIds)
    reorderBusyRef.current = true
    setReorderBusy(true)
    setReorderError(null)
    const written: Array<{ menu: BookingMenu; version: number }> = []
    try {
      for (const { menu, sortOrder } of changes) {
        const res = await bookingApi.updateMenu(accountId, menu.id, menu.version as number, { ...menu, sort_order: sortOrder })
        written.push({ menu, version: res.version })
      }
      setOrderOverride(null)
      onReload()
      notifyToast(`「${moved.name}」を${toIndex < fromIndex ? '上' : '下'}へ移しました。`, undoable ? {
        actionLabel: '元に戻す',
        onAction: () => { void persistOrder(movedId, previousIds, false) },
      } : undefined)
    } catch (cause) {
      /* 書き換えた分を元の sort_order へ戻す（戻せなかった分は読み直しで本当の並びを出す）。 */
      for (const { menu, version } of written.reverse()) {
        try {
          await bookingApi.updateMenu(accountId, menu.id, version, { ...menu, sort_order: menu.sort_order })
        } catch {
          /* 読み直しに任せる */
        }
      }
      setOrderOverride(null)
      onReload()
      notifyToast(bookingErrorMessage(cause, '保存'), {
        actionLabel: 'もう一度',
        onAction: () => { void persistOrder(movedId, nextIds, undoable) },
      })
    } finally {
      reorderBusyRef.current = false
      setReorderBusy(false)
    }
  }

  const reorderDisabledReason = !canEdit
    ? '閲覧のみのため並び替えできません'
    : query.trim()
      ? '検索を外すと動かせます'
      : reorderBusy
        ? '並び替えを保存しています'
        : null
  const reorder = useReorder({
    items: orderedBase,
    idOf: (menu) => menu.id,
    disabledReason: reorderDisabledReason,
    onReorder: ({ id, ids }) => persistOrder(id, ids),
  })
  /* ドラッグ中は置き場所を入れ替えて見せる（検索中は動かせないので、絞った並びのまま）。 */
  const visibleBase = reorder.blocked ? shown : reorder.shown
  const visible = visibleBase.slice((safePage - 1) * MENU_PAGE_SIZE, safePage * MENU_PAGE_SIZE)

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

      {shown.length === 0 ? (
        /* 修正案 D-2：空の一覧。 */
        <EmptyList
          icon={<AccountIcon />}
          title="まだ予約メニューがありません"
          description="メニューと担当・開ける時間を決めて、お客さまが LINE から予約できるようにします。"
          create={{ label: '最初の予約メニューを作る', href: '/booking/menus/new' }}
          canCreate={canEdit}
          filtered={menus.length > 0}
          onClearFilters={() => { setQuery(''); setPage(1) }}
          filteredDescription="検索を外すと、すべて出ます"
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
            const staffNames = (menu.assigned_staff ?? []).map((person) => person.display_name)
            const menuItems: ActionMenuItem[] = [
              { id: 'history', label: '版の履歴', onSelect: () => setHistoryTarget(menu) },
              ...(canEdit ? [
                /* つまみと同じ入口の「上へ／下へ」。検索中・保存中は出さない（つまみも出さない）。 */
                ...reorder.menuItems(menu.id, () => setOpenMenuId(null)),
                {
                  id: 'visibility',
                  label: (visOverride[menu.id] ?? menu.is_active) ? '止める' : '出す',
                  dividerBefore: !reorder.blocked,
                  onSelect: () => void toggleVisibility(menu),
                },
              ] satisfies ActionMenuItem[] : []),
            ]
            return (
              <div key={menu.id} className={styles.menuRow} {...reorder.rowProps(menu.id)}>
                <span className={styles.colOrder}>
                  {/* 動かせない時（閲覧のみ・検索中・保存中）はつまみを出さず、理由を title と読み上げで言う。 */}
                  <ReorderHandle
                    look="icon"
                    label={menu.name}
                    ariaLabel={`「${menu.name}」を並び替える（ドラッグ・↑↓キー）`}
                    className={styles.grip}
                    {...reorder.handle(menu.id)}
                    {...reorder.handleProps(menu.id)}
                  />
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
